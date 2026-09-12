from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import text

from app.db import engine
from app.schemas.mqtt import SensorName


router = APIRouter(prefix="/history", tags=["history"])

Bucket = Literal["raw", "1m", "5m", "15m", "1h", "6h", "1d"]

BUCKET_INTERVALS = {
    "1m": "1 minute",
    "5m": "5 minutes",
    "15m": "15 minutes",
    "1h": "1 hour",
    "6h": "6 hours",
    "1d": "1 day",
}


def normalize_time_range(start_time, end_time):
    resolved_end = end_time or datetime.now(timezone.utc)
    resolved_start = start_time or resolved_end - timedelta(hours=24)

    if resolved_start.tzinfo is None or resolved_end.tzinfo is None:
        raise HTTPException(
            status_code=422,
            detail="The from and to timestamps must include a timezone.",
        )

    resolved_start = resolved_start.astimezone(timezone.utc)
    resolved_end = resolved_end.astimezone(timezone.utc)

    if resolved_start >= resolved_end:
        raise HTTPException(
            status_code=422,
            detail="The from timestamp must be earlier than the to timestamp.",
        )

    return resolved_start, resolved_end


def history_metadata(room_id, start_time, end_time, bucket, points):
    return {
        "room_id": room_id,
        "from": start_time.isoformat(),
        "to": end_time.isoformat(),
        "bucket": bucket,
        "point_count": len(points),
        "points": points,
    }


@router.get("/rooms")
def history_rooms():
    with engine.connect() as connection:
        rows = connection.execute(
            text(
                """
                SELECT DISTINCT room_id
                FROM (
                    SELECT room_id FROM sensor_readings
                    UNION
                    SELECT room_id FROM cv_events
                    UNION
                    SELECT room_id FROM room_status
                ) rooms_with_data
                ORDER BY room_id
                """
            )
        ).fetchall()

    return {"rooms": [row.room_id for row in rows]}


@router.get("/sensors")
def sensor_history(
    room_id: str = Query(pattern=r"^[a-z0-9]+(?:_[a-z0-9]+)*$"),
    sensor: SensorName | None = None,
    start_time: datetime | None = Query(default=None, alias="from"),
    end_time: datetime | None = Query(default=None, alias="to"),
    bucket: Bucket = "raw",
    limit: int = Query(default=1000, ge=1, le=5000),
):
    start_time, end_time = normalize_time_range(start_time, end_time)
    parameters = {
        "room_id": room_id,
        "start_time": start_time,
        "end_time": end_time,
        "limit": limit,
    }
    sensor_filter = ""
    if sensor is not None:
        sensor_filter = "AND sensor = :sensor"
        parameters["sensor"] = sensor

    if bucket == "raw":
        query = text(
            """
            SELECT time, node_id, sensor, value
            FROM (
                SELECT time, node_id, sensor, value
                FROM sensor_readings
                WHERE room_id = :room_id
                  AND time >= :start_time
                  AND time <= :end_time
                  """
            + sensor_filter
            + """
                ORDER BY time DESC
                LIMIT :limit
            ) recent
            ORDER BY time, sensor
            """
        )
    else:
        parameters["bucket_interval"] = BUCKET_INTERVALS[bucket]
        query = text(
            """
            SELECT *
            FROM (
                SELECT
                    time_bucket(
                        CAST(:bucket_interval AS INTERVAL), time
                    ) AS time,
                    node_id,
                    sensor,
                    AVG(value) AS value,
                    MIN(value) AS min_value,
                    MAX(value) AS max_value,
                    COUNT(*) AS sample_count
                FROM sensor_readings
                WHERE room_id = :room_id
                  AND time >= :start_time
                  AND time <= :end_time
                  """
            + sensor_filter
            + """
                GROUP BY time_bucket(
                             CAST(:bucket_interval AS INTERVAL), time
                         ), node_id, sensor
                ORDER BY time DESC
                LIMIT :limit
            ) recent
            ORDER BY time, sensor
            """
        )

    with engine.connect() as connection:
        rows = connection.execute(query, parameters).fetchall()

    points = []
    for row in rows:
        is_raw = bucket == "raw"
        value = float(row.value)
        points.append(
            {
                "timestamp": row.time.isoformat(),
                "node_id": row.node_id,
                "sensor": row.sensor,
                "value": value,
                "min_value": value if is_raw else float(row.min_value),
                "max_value": value if is_raw else float(row.max_value),
                "sample_count": 1 if is_raw else int(row.sample_count),
            }
        )

    return history_metadata(room_id, start_time, end_time, bucket, points)


@router.get("/cv-events")
def cv_history(
    room_id: str = Query(pattern=r"^[a-z0-9]+(?:_[a-z0-9]+)*$"),
    camera_id: str | None = None,
    start_time: datetime | None = Query(default=None, alias="from"),
    end_time: datetime | None = Query(default=None, alias="to"),
    bucket: Bucket = "raw",
    limit: int = Query(default=1000, ge=1, le=5000),
):
    start_time, end_time = normalize_time_range(start_time, end_time)
    parameters = {
        "room_id": room_id,
        "start_time": start_time,
        "end_time": end_time,
        "limit": limit,
    }
    camera_filter = ""
    if camera_id is not None:
        camera_filter = "AND camera_id = :camera_id"
        parameters["camera_id"] = camera_id

    if bucket == "raw":
        query = text(
            """
            SELECT time, camera_id, occupancy, unusual_activity, confidence
            FROM (
                SELECT time, camera_id, occupancy,
                       unusual_activity, confidence
                FROM cv_events
                WHERE room_id = :room_id
                  AND time >= :start_time
                  AND time <= :end_time
                  """
            + camera_filter
            + """
                ORDER BY time DESC
                LIMIT :limit
            ) recent
            ORDER BY time, camera_id
            """
        )
    else:
        parameters["bucket_interval"] = BUCKET_INTERVALS[bucket]
        query = text(
            """
            SELECT *
            FROM (
                SELECT
                    time_bucket(
                        CAST(:bucket_interval AS INTERVAL), time
                    ) AS time,
                    camera_id,
                    AVG(occupancy) AS occupancy,
                    MAX(occupancy) AS max_occupancy,
                    BOOL_OR(unusual_activity) AS unusual_activity,
                    AVG(confidence) AS confidence,
                    COUNT(*) AS sample_count
                FROM cv_events
                WHERE room_id = :room_id
                  AND time >= :start_time
                  AND time <= :end_time
                  """
            + camera_filter
            + """
                GROUP BY time_bucket(
                             CAST(:bucket_interval AS INTERVAL), time
                         ), camera_id
                ORDER BY time DESC
                LIMIT :limit
            ) recent
            ORDER BY time, camera_id
            """
        )

    with engine.connect() as connection:
        rows = connection.execute(query, parameters).fetchall()

    points = []
    for row in rows:
        is_raw = bucket == "raw"
        confidence = None
        if row.confidence is not None:
            confidence = float(row.confidence)
        points.append(
            {
                "timestamp": row.time.isoformat(),
                "camera_id": row.camera_id,
                "occupancy": (
                    int(row.occupancy)
                    if is_raw
                    else float(row.occupancy)
                ),
                "max_occupancy": (
                    int(row.occupancy)
                    if is_raw
                    else int(row.max_occupancy)
                ),
                "unusual_activity": bool(row.unusual_activity),
                "confidence": confidence,
                "sample_count": 1 if is_raw else int(row.sample_count),
            }
        )

    return history_metadata(room_id, start_time, end_time, bucket, points)
