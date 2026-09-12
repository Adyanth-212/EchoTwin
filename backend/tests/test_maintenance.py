import unittest
from datetime import datetime, timedelta, timezone
from dataclasses import replace
from unittest.mock import Mock, patch
import json

from app.maintenance.evaluator import SENSORS, summarize, evaluate
from app.maintenance.settings import Settings
from app.maintenance.advice import explain

NOW = datetime(2026, 9, 13, tzinfo=timezone.utc)
NORMAL = dict(zip(SENSORS, (25, 45, 600, 100, 2, 30, 0.05, 0)))


def series(overrides=None, duration=180, step=1):
    values = {**NORMAL, **(overrides or {})}
    return [{"sensor": sensor, "time": NOW - timedelta(seconds=age), "value": value, "received_at": NOW - timedelta(seconds=age)}
            for age in range(duration, -1, -step) for sensor, value in values.items()]


def snapshot(rows, settings=Settings()):
    latest = {}
    for row in sorted(rows, key=lambda item: item["time"]):
        latest[row["sensor"]] = row
    return {"sensors": summarize(rows, latest, NOW, settings), "cameras": {}, "anomaly": {}}


class MaintenanceEvidenceTests(unittest.TestCase):
    def test_single_spike_does_not_open_threshold_incident(self):
        rows = series()
        rows.append({"sensor": "temperature", "value": 45, "time": NOW, "received_at": NOW})
        findings = evaluate(snapshot(rows), Settings())
        self.assertFalse(any(item["key"].startswith("threshold:") for item in findings))

    def test_critical_requires_continuous_samples(self):
        self.assertEqual(evaluate(snapshot(series({"temperature": 36}, duration=31)), Settings())[0]["severity"], "critical")
        rows = [row for row in series({"temperature": 36}) if (NOW - row["time"]).total_seconds() in (0, 180)]
        self.assertFalse(any(item["key"].startswith("threshold:") for item in evaluate(snapshot(rows), Settings())))

    def test_missing_data_does_not_look_like_repeated_zero(self):
        findings = evaluate(snapshot([]), Settings())
        self.assertEqual(len(findings), 8)
        self.assertTrue(all(item["key"].startswith("missing:") for item in findings))

    def test_unchanged_fresh_data_is_fresh(self):
        result = snapshot(series())["sensors"]
        self.assertTrue(all(value["fresh"] for value in result.values()))
        self.assertEqual(evaluate(snapshot(series()), Settings()), [])

    def test_future_and_stale_samples_are_not_diagnostic(self):
        for shift in (-60, 60):
            rows = series({"temperature": 40})
            for row in rows:
                row["time"] += timedelta(seconds=shift)
            findings = evaluate(snapshot(rows), Settings())
            self.assertTrue(any(item["key"] == "missing:temperature" for item in findings))
            self.assertFalse(any(item["key"] == "threshold:temperature" for item in findings))

    def test_long_warning_and_combined_rule(self):
        result = evaluate(snapshot(series({"temperature": 31})), Settings())
        self.assertTrue(any(item["key"] == "threshold:temperature" and item["severity"] == "warning" for item in result))
        result = evaluate(snapshot(series({"temperature": 31, "vibration_magnitude": 3}, duration=35)), Settings())
        self.assertTrue(any(item["key"] == "combined:heat_vibration" and item["severity"] == "critical" for item in result))

    def test_trend_uses_window_and_ignores_data_gaps(self):
        rows = series()
        for row in rows:
            if row["sensor"] == "temperature":
                row["value"] = 29 - (NOW - row["time"]).total_seconds() / 60
        metrics = snapshot(rows)["sensors"]["temperature"]
        self.assertAlmostEqual(metrics["threshold_eta_minutes"], 1)
        rows = [row for row in rows if (NOW - row["time"]).total_seconds() % 60 == 0]
        self.assertIsNone(snapshot(rows)["sensors"]["temperature"]["threshold_eta_minutes"])

    def test_receipt_timestamp_and_old_rows(self):
        rows = series()
        rows[-1]["received_at"] = NOW - timedelta(seconds=50)
        self.assertFalse(snapshot(rows)["sensors"]["vibration_trip"]["fresh"])
        rows[-1]["received_at"] = None
        self.assertTrue(snapshot(rows)["sensors"]["vibration_trip"]["fresh"])

    def test_duplicate_samples_do_not_inflate_coverage(self):
        rows = series(duration=0) * 200
        self.assertEqual(snapshot(rows)["sensors"]["temperature"]["count"], 1)

    @patch("app.maintenance.advice.httpx.post", side_effect=RuntimeError("offline"))
    @patch("app.config.TAILSCALE_OLLAMA_URL", "http://ollama.test")
    def test_model_failure_still_produces_guidance(self, post):
        incident = {"action": "deeper_inspection", "title": "Repeated heat", "severity": "warning", "recurrence_count": 3, "evidence": {}}
        result, source = explain(incident, {}, Settings())
        self.assertEqual(source, "rules")
        self.assertIn("technician", " ".join(result["inspection_steps"]))

    def test_default_mode_cannot_call(self):
        self.assertEqual(Settings().notification_mode, "dry_run")

    @patch("app.config.TAILSCALE_OLLAMA_URL", "http://ollama.test")
    @patch("app.maintenance.advice.httpx.post")
    def test_structured_advice_preserves_known_limits(self, post):
        post.return_value = Mock()
        post.return_value.json.return_value = {"response": json.dumps({"summary": "Check the reading", "inspection_steps": ["Verify calibration"], "missing_information": []})}
        incident = {"action": "inspect", "title": "Heat", "severity": "warning", "recurrence_count": 1, "evidence": {}}
        result, source = explain(incident, {}, Settings())
        self.assertEqual(source, "ollama")
        self.assertTrue(result["missing_information"])
        payload = post.call_args.kwargs["json"]
        self.assertFalse(payload["think"])
        self.assertEqual(payload["format"]["type"], "object")

    def test_invalid_cadence_and_window_are_rejected(self):
        for settings in ({"MAINTENANCE_SAMPLE_SECONDS": "nan"},
                         {"MAINTENANCE_WINDOW_SECONDS": "15"},
                         {"MAINTENANCE_ROOMS": ""}):
            with patch.dict("os.environ", settings, clear=True):
                with self.assertRaises(ValueError):
                    Settings.from_env()


if __name__ == "__main__":
    unittest.main()
