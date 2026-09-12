import json
from datetime import datetime, timezone

from sqlalchemy import text

from app.anomaly import evaluate_anomaly
from app.db import engine
from app.rules import evaluate_rules
from app.schemas.ws import AnomalyInfo, SensorReadings, TrendInfo, WSMessage
from app.trend import evaluate_trend
from app.ws_manager import manager


SENSOR_NAMES = {
    "temperature",
    "humidity",
    "eco2",
    "tvoc",
    "aqi",
    "surface_temp",
    "vibration_magnitude",
    "vibration_trip",
}


def build_room_status(room_id, source):
    now = datetime.now(timezone.utc)

    with engine.connect() as connection:
        sensor_rows = connection.execute(
            text(
                """
                SELECT DISTINCT ON (sensor) sensor, value
                FROM sensor_readings
                WHERE room_id = :room_id
                ORDER BY sensor, time DESC
                """
            ),
            {"room_id": room_id},
        ).fetchall()

        cv_row = connection.execute(
            text(
                """
                SELECT occupancy, unusual_activity
                FROM cv_events
                WHERE room_id = :room_id
                ORDER BY time DESC
                LIMIT 1
                """
            ),
            {"room_id": room_id},
        ).fetchone()

    sensor_values = {name: None for name in SENSOR_NAMES}
    latest_values = {}
    for row in sensor_rows:
        latest_values[row.sensor] = float(row.value)

    for name in SENSOR_NAMES:
        if name not in latest_values:
            continue
        if name == "vibration_trip":
            sensor_values[name] = bool(latest_values[name])
        else:
            sensor_values[name] = latest_values[name]

    if sensor_values["temperature"] is None:
        sensor_values["temperature"] = latest_values.get("temperature_backup")
    if sensor_values["humidity"] is None:
        sensor_values["humidity"] = latest_values.get("humidity_backup")

    sensor_values["occupancy_count"] = cv_row.occupancy if cv_row else None

    status, suggestions = evaluate_rules(sensor_values)
    is_anomaly, anomaly_score, top_features = evaluate_anomaly(sensor_values)
    trend = evaluate_trend(room_id)

    if cv_row and cv_row.unusual_activity:
        if status == "green":
            status = "yellow"
        suggestions.append("Unusual camera activity detected — inspect this space.")

    if is_anomaly:
        if status == "green":
            status = "yellow"
        suggestions.append(
            "Unusual multi-sensor pattern detected — inspect this space."
        )

    minutes = trend["time_to_threshold_minutes"]
    if minutes is not None and minutes <= 15 and status == "green":
        status = "yellow"
        suggestions.append(
            "A sensor is trending toward its warning threshold within 15 minutes."
        )

    message = WSMessage(
        room_id=room_id,
        timestamp=now.isoformat(),
        status=status,
        source=source,
        sensors=SensorReadings(**sensor_values),
        anomaly=AnomalyInfo(
            is_anomaly=is_anomaly,
            score=anomaly_score,
            top_features=top_features,
        ),
        trend=TrendInfo(**trend),
    )

    payload = message.model_dump(mode="json")
    with engine.begin() as connection:
        connection.execute(
            text(
                """
                INSERT INTO room_status
                    (room_id, updated_at, status, source, sensors,
                     anomaly, trend, suggestions)
                VALUES
                    (:room_id, :updated_at, :status, :source,
                     CAST(:sensors AS JSONB), CAST(:anomaly AS JSONB),
                     CAST(:trend AS JSONB), CAST(:suggestions AS JSONB))
                ON CONFLICT (room_id) DO UPDATE SET
                    updated_at = EXCLUDED.updated_at,
                    status = EXCLUDED.status,
                    source = EXCLUDED.source,
                    sensors = EXCLUDED.sensors,
                    anomaly = EXCLUDED.anomaly,
                    trend = EXCLUDED.trend,
                    suggestions = EXCLUDED.suggestions
                """
            ),
            {
                "room_id": room_id,
                "updated_at": now,
                "status": status,
                "source": source,
                "sensors": json.dumps(payload["sensors"]),
                "anomaly": json.dumps(payload["anomaly"]),
                "trend": json.dumps(payload["trend"]),
                "suggestions": json.dumps(suggestions),
            },
        )

    manager.broadcast_from_sync(message)
    return message, suggestions
