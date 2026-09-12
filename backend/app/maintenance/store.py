import json
from datetime import timedelta

from sqlalchemy import text
from app.db import engine


def init_schema():
    statements = [
        # Existing rows intentionally keep NULL arrival times; do not invent them.
        "ALTER TABLE sensor_readings ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ",
        "ALTER TABLE sensor_readings ALTER COLUMN received_at SET DEFAULT now()",
        "ALTER TABLE cv_events ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ",
        "ALTER TABLE cv_events ALTER COLUMN received_at SET DEFAULT now()",
        """CREATE TABLE IF NOT EXISTS maintenance_incidents (
            id BIGSERIAL PRIMARY KEY, room_id TEXT NOT NULL, condition_key TEXT NOT NULL,
            title TEXT NOT NULL, severity TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open'
                CHECK (status IN ('open','acknowledged','resolved')),
            condition_active BOOLEAN NOT NULL DEFAULT TRUE,
            opened_at TIMESTAMPTZ NOT NULL, last_seen_at TIMESTAMPTZ NOT NULL,
            acknowledged_at TIMESTAMPTZ, resolved_at TIMESTAMPTZ,
            recurrence_count INTEGER NOT NULL DEFAULT 1, action TEXT NOT NULL,
            evidence JSONB NOT NULL, advice JSONB, advice_source TEXT NOT NULL DEFAULT 'rules',
            advice_at TIMESTAMPTZ, operator_note TEXT NOT NULL DEFAULT ''
        )""",
        """CREATE UNIQUE INDEX IF NOT EXISTS maintenance_one_active
            ON maintenance_incidents(room_id, condition_key) WHERE status <> 'resolved'""",
        """CREATE TABLE IF NOT EXISTS maintenance_notifications (
            id BIGSERIAL PRIMARY KEY, incident_id BIGINT NOT NULL REFERENCES maintenance_incidents(id),
            mode TEXT NOT NULL, status TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL, message TEXT NOT NULL,
            provider_sid TEXT, detail TEXT, UNIQUE(incident_id, mode)
        )""",
        """CREATE TABLE IF NOT EXISTS maintenance_worker_state (
            id INTEGER PRIMARY KEY CHECK (id=1), heartbeat_at TIMESTAMPTZ,
            last_review_at TIMESTAMPTZ, review_requested BOOLEAN NOT NULL DEFAULT FALSE,
            last_request_at TIMESTAMPTZ, error TEXT, mode TEXT NOT NULL DEFAULT 'dry_run'
        )""",
        "INSERT INTO maintenance_worker_state(id) VALUES (1) ON CONFLICT DO NOTHING",
        """CREATE TABLE IF NOT EXISTS maintenance_snapshots (
            room_id TEXT PRIMARY KEY, reviewed_at TIMESTAMPTZ NOT NULL, evidence JSONB NOT NULL
        )""",
    ]
    with engine.begin() as connection:
        for statement in statements:
            connection.execute(text(statement))


def collect(room_id, now, settings):
    from app.maintenance.evaluator import summarize
    from app.anomaly import evaluate_anomaly
    with engine.connect() as connection:
        rows = connection.execute(text("""SELECT time, sensor, value FROM sensor_readings
            WHERE room_id=:room AND time>=:start AND time<=:now ORDER BY time"""),
            {"room": room_id, "start": now - timedelta(seconds=settings.window_seconds), "now": now}).mappings().all()
        latest = connection.execute(text("""SELECT DISTINCT ON (sensor) sensor, time, value, received_at
            FROM sensor_readings WHERE room_id=:room ORDER BY sensor,time DESC,id DESC"""), {"room": room_id}).mappings().all()
        cameras = connection.execute(text("""SELECT DISTINCT ON (camera_id) camera_id,time,received_at,occupancy
            FROM cv_events WHERE room_id=:room ORDER BY camera_id,time DESC,id DESC"""), {"room": room_id}).mappings().all()
    metrics = summarize(rows, {row["sensor"]: row for row in latest}, now, settings)
    camera_lookup = {row["camera_id"]: row for row in cameras}
    camera_metrics = {}
    for name in settings.cameras:
        row = camera_lookup.get(name)
        age = (now - row["time"]).total_seconds() if row else None
        receipt_age = (now - row["received_at"]).total_seconds() if row and row["received_at"] else None
        fresh = age is not None and 0 <= age <= settings.camera_stale_seconds
        if receipt_age is not None:
            fresh = fresh and 0 <= receipt_age <= settings.camera_stale_seconds
        camera_metrics[name] = {"fresh": fresh, "sample_age_seconds": age, "receipt_age_seconds": receipt_age, "occupancy": row["occupancy"] if row else None}
    anomaly = {"is_anomaly": False, "score": None, "top_features": []}
    if all(metric["fresh"] and metric["coverage"] >= 0.5 and metric["sample_span_seconds"] >= settings.warning_persistence for metric in metrics.values()):
        flagged, score, features = evaluate_anomaly({name: metric["mean"] for name, metric in metrics.items()})
        anomaly = {"is_anomaly": flagged, "score": score, "top_features": features, "basis": "five-minute means; synthetic training baseline"}
    return {"room_id": room_id, "reviewed_at": now.isoformat(), "window_seconds": settings.window_seconds,
            "sensors": metrics, "cameras": camera_metrics, "anomaly": anomaly}


def record_findings(snapshot, findings, now, urgent=False):
    room = snapshot["room_id"]
    with engine.begin() as connection:
        if not urgent:
            connection.execute(text("""INSERT INTO maintenance_snapshots VALUES (:room,:now,CAST(:evidence AS JSONB))
                ON CONFLICT(room_id) DO UPDATE SET reviewed_at=EXCLUDED.reviewed_at,evidence=EXCLUDED.evidence"""),
                {"room": room, "now": now, "evidence": json.dumps(snapshot)})
            connection.execute(text("""UPDATE maintenance_incidents SET condition_active=FALSE
                WHERE room_id=:room AND NOT (condition_key = ANY(:keys))"""), {"room": room, "keys": [item["key"] for item in findings]})
        for finding in findings:
            if urgent and finding["severity"] != "critical":
                continue
            previous = connection.execute(text("""SELECT * FROM maintenance_incidents
                WHERE room_id=:room AND condition_key=:key ORDER BY id DESC LIMIT 1 FOR UPDATE"""),
                {"room": room, "key": finding["key"]}).mappings().first()
            # A manually resolved condition must clear before it can generate a new incident.
            if previous and previous["status"] == "resolved" and previous["condition_active"]:
                continue
            fields = {"room": room, "key": finding["key"], "now": now, "title": finding["title"],
                      "severity": finding["severity"], "evidence": json.dumps(finding["evidence"]), "action": finding["action"]}
            if previous and previous["status"] != "resolved":
                fields["id"] = previous["id"]
                connection.execute(text("""UPDATE maintenance_incidents SET last_seen_at=:now,condition_active=TRUE,
                    evidence=CAST(:evidence AS JSONB),
                    advice=CASE WHEN severity<>:severity THEN NULL ELSE advice END,
                    advice_at=CASE WHEN severity<>:severity THEN NULL ELSE advice_at END,
                    severity=:severity,title=:title WHERE id=:id"""), fields)
            else:
                count = connection.execute(text("""SELECT count(*) FROM maintenance_incidents WHERE room_id=:room
                    AND condition_key=:key AND opened_at>:since"""), {**fields, "since": now - timedelta(hours=24)}).scalar_one()
                fields["recurrence"] = count + 1
                if count >= 2 and finding["action"] != "inspect_connection":
                    fields["action"] = "deeper_inspection"
                connection.execute(text("""INSERT INTO maintenance_incidents
                    (room_id,condition_key,title,severity,opened_at,last_seen_at,evidence,action,recurrence_count)
                    VALUES (:room,:key,:title,:severity,:now,:now,CAST(:evidence AS JSONB),:action,:recurrence)"""), fields)


def incident_rows(room_id=None, limit=50):
    with engine.connect() as connection:
        return [dict(row) for row in connection.execute(text("""SELECT i.*,
            COALESCE((SELECT jsonb_agg(n ORDER BY n.id) FROM maintenance_notifications n WHERE n.incident_id=i.id),'[]'::jsonb) AS notifications
            FROM maintenance_incidents i WHERE (:room IS NULL OR room_id=:room)
            ORDER BY (status <> 'resolved') DESC, opened_at DESC, i.id DESC LIMIT :limit"""), {"room": room_id, "limit": limit}).mappings()]
