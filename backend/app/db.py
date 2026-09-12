import json

from sqlalchemy import create_engine, text

from app import config


engine = create_engine(config.DATABASE_URL, pool_pre_ping=True)


SCHEMA_STATEMENTS = [
    "CREATE EXTENSION IF NOT EXISTS timescaledb",
    """
    CREATE TABLE IF NOT EXISTS rooms (
        room_id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS sensor_readings (
        id BIGSERIAL,
        time TIMESTAMPTZ NOT NULL,
        node_id TEXT NOT NULL,
        room_id TEXT NOT NULL,
        sensor TEXT NOT NULL,
        value DOUBLE PRECISION NOT NULL,
        raw_data JSONB,
        PRIMARY KEY (time, id)
    )
    """,
    """
    SELECT create_hypertable(
        'sensor_readings', 'time', if_not_exists => TRUE
    )
    """,
    """
    CREATE INDEX IF NOT EXISTS sensor_readings_room_sensor_time_idx
    ON sensor_readings (room_id, sensor, time DESC)
    """,
    """
    CREATE TABLE IF NOT EXISTS cv_events (
        id BIGSERIAL,
        time TIMESTAMPTZ NOT NULL,
        room_id TEXT NOT NULL,
        camera_id TEXT NOT NULL,
        occupancy INTEGER NOT NULL,
        unusual_activity BOOLEAN DEFAULT FALSE,
        confidence DOUBLE PRECISION,
        raw_data JSONB,
        PRIMARY KEY (time, id)
    )
    """,
    """
    SELECT create_hypertable(
        'cv_events', 'time', if_not_exists => TRUE
    )
    """,
    """
    CREATE INDEX IF NOT EXISTS cv_events_room_camera_time_idx
    ON cv_events (room_id, camera_id, time DESC)
    """,
    """
    CREATE TABLE IF NOT EXISTS room_status (
        room_id TEXT PRIMARY KEY,
        updated_at TIMESTAMPTZ NOT NULL,
        status TEXT NOT NULL,
        source TEXT NOT NULL,
        sensors JSONB NOT NULL,
        anomaly JSONB NOT NULL,
        trend JSONB NOT NULL,
        suggestions JSONB NOT NULL DEFAULT '[]'::jsonb
    )
    """,
]


def init_db():
    with engine.begin() as connection:
        for statement in SCHEMA_STATEMENTS:
            connection.execute(text(statement))


def insert_sensor_reading(message, room_id, raw_payload):
    with engine.begin() as connection:
        connection.execute(
            text(
                """
                INSERT INTO sensor_readings
                    (time, node_id, room_id, sensor, value, raw_data)
                VALUES
                    (:time, :node_id, :room_id, :sensor, :value,
                     CAST(:raw_data AS JSONB))
                """
            ),
            {
                "time": message.timestamp,
                "node_id": message.node_id,
                "room_id": room_id,
                "sensor": message.sensor,
                "value": message.value,
                "raw_data": json.dumps(raw_payload),
            },
        )
