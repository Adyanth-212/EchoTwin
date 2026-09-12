"""Only runs against the dedicated, ephemeral compose.maintenance-test database."""
import json
import os
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import Mock, patch

import httpx
from fastapi.testclient import TestClient
from sqlalchemy import text
from app import config, db
from app.main import app
from app.maintenance import notifications, store
from app.maintenance.settings import Settings
from app.maintenance.worker import LOCK_ID, run_cycle


@unittest.skipUnless(os.getenv("MAINTENANCE_INTEGRATION_TESTS") == "1" and config.POSTGRES_DB == "maintenance_test", "requires isolated maintenance_test database")
class MaintenanceDatabaseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        db.init_db()
        store.init_schema()

    def setUp(self):
        with db.engine.begin() as connection:
            connection.execute(text("TRUNCATE maintenance_notifications,maintenance_incidents,maintenance_snapshots,sensor_readings,cv_events RESTART IDENTITY CASCADE"))
            connection.execute(text("UPDATE maintenance_worker_state SET heartbeat_at=NULL,last_review_at=NULL,last_request_at=NULL,review_requested=FALSE,error=NULL"))
        self.now = datetime.now(timezone.utc)
        self.settings = Settings(use_llm=False)
        self.client = TestClient(app)
        self.snapshot = {"room_id": "corridor_a", "sensors": {}, "cameras": {}}
        self.finding = {"key": "threshold:temperature", "title": "Sustained heat", "severity": "critical", "action": "inspect", "evidence": {"temperature": 38}}

    def record(self, findings=None, now=None):
        store.record_findings(self.snapshot, [self.finding] if findings is None else findings, now or self.now)
        return store.incident_rows()[0] if store.incident_rows() else None

    def test_persistent_deduplication_acknowledgement_and_resolution(self):
        first = self.record()
        self.record(now=self.now + timedelta(seconds=180))
        self.assertEqual(len(store.incident_rows()), 1)
        response = self.client.post("/maintenance/incidents/{0}/acknowledge".format(first["id"]), json={"note": "Checking wiring"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "acknowledged")
        with patch("app.maintenance.notifications.httpx.post") as post:
            notifications.dispatch(store.incident_rows()[0], self.settings, self.now)
            post.assert_not_called()
        self.assertEqual(store.incident_rows()[0]["notifications"], [])
        self.client.post("/maintenance/incidents/{0}/resolve".format(first["id"]), json={})
        self.record()
        self.assertEqual(len(store.incident_rows()), 1, "persistent fault must not immediately reopen")
        self.record([])
        self.record(now=self.now + timedelta(minutes=5))
        self.assertEqual(len(store.incident_rows()), 2)
        self.assertEqual(store.incident_rows()[0]["recurrence_count"], 2)

    def test_third_distinct_occurrence_suggests_deeper_inspection(self):
        for index in range(3):
            item = self.record(now=self.now + timedelta(minutes=index))
            if index < 2:
                self.client.post("/maintenance/incidents/{0}/resolve".format(item["id"]), json={})
                self.record([])
        self.assertEqual(item["action"], "deeper_inspection")

    def test_severity_change_refreshes_advice(self):
        item = self.record([{**self.finding, "severity": "warning"}])
        with db.engine.begin() as connection:
            connection.execute(text("UPDATE maintenance_incidents SET advice='{}'::jsonb,advice_at=now() WHERE id=:id"), {"id": item["id"]})
        updated = self.record()
        self.assertEqual(updated["id"], item["id"])
        self.assertEqual(updated["severity"], "critical")
        self.assertIsNone(updated["advice"])
        self.assertIsNone(updated["advice_at"])

    def test_dry_run_and_cooldown_never_contact_provider(self):
        item = self.record()
        with patch("app.maintenance.notifications.httpx.post") as post:
            notifications.dispatch(item, self.settings, self.now)
            notifications.dispatch(item, self.settings, self.now + timedelta(hours=1))
            post.assert_not_called()
        self.assertEqual(len(store.incident_rows()[0]["notifications"]), 1)
        self.assertEqual(store.incident_rows()[0]["notifications"][0]["status"], "dry_run")
        other = {**self.finding, "key": "threshold:surface_temp"}
        second = self.record([self.finding, other], self.now + timedelta(seconds=1))
        notifications.dispatch(second, self.settings, self.now + timedelta(seconds=1))
        self.assertEqual(store.incident_rows()[0]["notifications"], [])
        notifications.dispatch(second, self.settings, self.now + timedelta(seconds=901))
        self.assertEqual(store.incident_rows()[0]["notifications"][0]["status"], "dry_run")

    @patch("app.maintenance.notifications.provider_settings", return_value=("AC" + "0" * 32, "test", "+15005550006", "+15005550009"))
    @patch("app.maintenance.notifications.httpx.post", side_effect=httpx.ReadTimeout("uncertain"))
    def test_ambiguous_call_is_never_retried(self, post, credentials):
        item = self.record()
        settings = Settings(notification_mode="twilio", use_llm=False)
        notifications.dispatch(item, settings, self.now)
        notifications.dispatch(item, settings, self.now + timedelta(hours=1))
        self.assertEqual(post.call_count, 1)
        self.assertEqual(store.incident_rows()[0]["notifications"][0]["status"], "unknown")

    @patch("app.maintenance.notifications.provider_settings", return_value=("AC" + "0" * 32, "test", "+15005550006", "+15005550009"))
    @patch("app.maintenance.notifications.httpx.get")
    @patch("app.maintenance.notifications.httpx.post")
    def test_call_submission_and_completion_are_not_acknowledgement(self, post, get, credentials):
        post.return_value = Mock(status_code=201)
        post.return_value.json.return_value = {"sid": "CA" + "0" * 32}
        notifications.dispatch(self.record(), Settings(notification_mode="twilio"), self.now)
        self.assertEqual(store.incident_rows()[0]["notifications"][0]["status"], "submitted")
        get.return_value.json.return_value = {"status": "completed"}
        notifications.reconcile(self.now)
        self.assertEqual(store.incident_rows()[0]["notifications"][0]["status"], "completed")
        self.assertEqual(store.incident_rows()[0]["status"], "open")

    def test_worker_cycle_persists_missing_channels_and_review_state(self):
        run_cycle(self.settings)
        self.assertEqual(len(store.incident_rows()), 10)
        self.assertTrue(all(item["severity"] == "warning" for item in store.incident_rows()))
        state = self.client.get("/maintenance/status").json()
        self.assertTrue(state["running"])
        self.assertEqual(state["mode"], "dry_run")
        self.assertEqual(len(state["snapshots"]), 1)
        self.assertEqual(self.client.post("/maintenance/review").status_code, 200)
        self.assertEqual(self.client.post("/maintenance/review").status_code, 429)

    def test_sample_and_arrival_times_are_separate(self):
        with db.engine.begin() as connection:
            connection.execute(text("""INSERT INTO sensor_readings(time,node_id,room_id,sensor,value)
                VALUES (:time,'node_1','corridor_a','temperature',25)"""), {"time": self.now - timedelta(seconds=90)})
        metrics = store.collect("corridor_a", datetime.now(timezone.utc), self.settings)["sensors"]["temperature"]
        self.assertFalse(metrics["fresh"])
        self.assertGreaterEqual(metrics["sample_age_seconds"], 90)
        self.assertIsNotNone(metrics["received_at"])

    def test_review_ignores_arrivals_after_its_cutoff(self):
        with db.engine.begin() as connection:
            for offset, value in ((-1, 25), (0.2, 38)):
                fields = {"sample": self.now - timedelta(seconds=2 if offset < 0 else 1),
                          "arrival": self.now + timedelta(seconds=offset), "value": value}
                connection.execute(text("""INSERT INTO sensor_readings(time,received_at,node_id,room_id,sensor,value)
                    VALUES (:sample,:arrival,'node_1','corridor_a','temperature',:value)"""), fields)
                connection.execute(text("""INSERT INTO cv_events(time,received_at,room_id,camera_id,occupancy)
                    VALUES (:sample,:arrival,'corridor_a','cam1',:value)"""), fields)
        snapshot = store.collect("corridor_a", self.now, self.settings)
        metric = snapshot["sensors"]["temperature"]
        self.assertTrue(metric["fresh"])
        self.assertEqual(metric["latest"], 25)
        self.assertEqual(metric["count"], 1)
        self.assertTrue(snapshot["cameras"]["cam1"]["fresh"])
        self.assertEqual(snapshot["cameras"]["cam1"]["occupancy"], 25)

    @patch("app.maintenance.worker.notifications.dispatch")
    def test_stale_critical_incident_cannot_dispatch_during_urgent_tick(self, dispatch):
        self.record()
        run_cycle(self.settings, full=False)
        dispatch.assert_not_called()

    def test_two_workers_cannot_hold_leadership(self):
        with db.engine.connect() as first, db.engine.connect() as second:
            self.assertTrue(first.execute(text("SELECT pg_try_advisory_lock(:id)"), {"id": LOCK_ID}).scalar_one())
            try:
                self.assertFalse(second.execute(text("SELECT pg_try_advisory_lock(:id)"), {"id": LOCK_ID}).scalar_one())
            finally:
                first.execute(text("SELECT pg_advisory_unlock(:id)"), {"id": LOCK_ID})


if __name__ == "__main__":
    unittest.main()
