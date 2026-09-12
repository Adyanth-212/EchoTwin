import argparse
import json
import signal
import threading
import time
from datetime import datetime, timezone

from sqlalchemy import text
from app.db import engine
from app.maintenance import advice, notifications, store
from app.maintenance.evaluator import evaluate
from app.maintenance.settings import Settings

LOCK_ID = 83471032


def run_cycle(settings, full=True):
    now = datetime.now(timezone.utc)
    snapshots = {}
    current_findings = {}
    for room in settings.rooms:
        snapshot = store.collect(room, now, settings)
        snapshots[room] = snapshot
        findings = evaluate(snapshot, settings)
        current_findings[room] = {finding["key"]: finding for finding in findings}
        store.record_findings(snapshot, findings, now, urgent=not full)
    # Persist incidents before contacting any external model/provider.
    # Limit LLM work to one incident per tick so it cannot starve urgent checks.
    llm_budget = 1
    for incident in store.incident_rows(limit=500):
        if incident["room_id"] not in snapshots or incident["status"] == "resolved" or not incident["condition_active"]:
            continue
        current = current_findings[incident["room_id"]].get(incident["condition_key"])
        if current and current["severity"] == "critical":
            notifications.dispatch(incident, settings, now)
        if incident["advice"] is None and llm_budget:
            explanation, source = advice.explain(incident, snapshots[incident["room_id"]], settings)
            with engine.begin() as connection:
                connection.execute(text("UPDATE maintenance_incidents SET advice=CAST(:advice AS JSONB),advice_source=:source,advice_at=:now WHERE id=:id"),
                                   {"advice": json.dumps(explanation), "source": source, "now": now, "id": incident["id"]})
            llm_budget -= 1
    if settings.notification_mode == "twilio":
        notifications.reconcile(now)
    with engine.begin() as connection:
        connection.execute(text("""UPDATE maintenance_worker_state SET heartbeat_at=:now,
            last_review_at=CASE WHEN :full THEN :now ELSE last_review_at END,error=NULL,mode=:mode WHERE id=1"""),
            {"now": datetime.now(timezone.utc), "full": full, "mode": settings.notification_mode})


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--once", action="store_true", help="One full review then exit (same persistent deduplication)")
    args = parser.parse_args()
    settings = Settings.from_env()
    store.init_schema()
    stop = threading.Event()
    for signum in (signal.SIGTERM, signal.SIGINT):
        signal.signal(signum, lambda *_: stop.set())
    with engine.connect() as lock:
        acquired = lock.execute(text("SELECT pg_try_advisory_lock(:id)"), {"id": LOCK_ID}).scalar_one()
        lock.commit()
        if not acquired:
            raise SystemExit("Another maintenance worker owns the database lock")
        try:
            # Recover an interrupted dispatch without ever redialing it.
            with engine.begin() as connection:
                connection.execute(text("UPDATE maintenance_notifications SET status='unknown',detail='Worker interrupted during dispatch; inspect provider records. No automatic retry.' WHERE status='dispatching'"))
            last_full = -float("inf")
            while not stop.is_set():
                started = time.monotonic()
                # A lost lock connection must stop this process rather than run a second leader.
                lock.execute(text("SELECT 1"))
                lock.commit()
                with engine.begin() as connection:
                    requested = connection.execute(text("UPDATE maintenance_worker_state SET review_requested=FALSE WHERE id=1 AND review_requested=TRUE RETURNING id")).first() is not None
                full = requested or started - last_full >= settings.review_seconds
                try:
                    run_cycle(settings, full)
                    if full:
                        last_full = started
                    print("Maintenance review complete (full=" + str(full) + ", mode=" + settings.notification_mode + ")", flush=True)
                except Exception as error:
                    with engine.begin() as connection:
                        connection.execute(text("UPDATE maintenance_worker_state SET heartbeat_at=now(),error=:error WHERE id=1"), {"error": type(error).__name__ + ": maintenance review failed; inspect worker logs/configuration"})
                    print("Maintenance review failed: " + type(error).__name__, flush=True)
                    if args.once:
                        raise
                if args.once:
                    break
                stop.wait(max(1, settings.urgent_seconds - (time.monotonic() - started)))
        finally:
            lock.execute(text("SELECT pg_advisory_unlock(:id)"), {"id": LOCK_ID})
            lock.commit()


if __name__ == "__main__":
    main()
