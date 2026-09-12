CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE IF NOT EXISTS rooms (
    room_id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sensor_readings (
    id BIGSERIAL,
    time TIMESTAMPTZ NOT NULL,
    node_id TEXT NOT NULL,
    room_id TEXT NOT NULL,
    sensor TEXT NOT NULL,
    value DOUBLE PRECISION NOT NULL,
    raw_data JSONB,
    PRIMARY KEY (time, id)
);

SELECT create_hypertable(
    'sensor_readings',
    'time',
    if_not_exists => TRUE
);

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
);

SELECT create_hypertable(
    'cv_events',
    'time',
    if_not_exists => TRUE
);

CREATE TABLE IF NOT EXISTS room_status (
    room_id TEXT PRIMARY KEY,
    updated_at TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL,
    source TEXT NOT NULL,
    sensors JSONB NOT NULL,
    anomaly JSONB NOT NULL,
    trend JSONB NOT NULL,
    suggestions JSONB NOT NULL DEFAULT '[]'::jsonb
);
