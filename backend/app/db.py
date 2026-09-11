import psycopg2

from app import config


def get_connection():
    connection = psycopg2.connect(
        host=config.POSTGRES_HOST,
        port=config.POSTGRES_PORT,
        dbname=config.POSTGRES_DB,
        user=config.POSTGRES_USER,
        password=config.POSTGRES_PASSWORD,
    )
    return connection


def init_db():
    connection = get_connection()
    cursor = connection.cursor()
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS sensor_readings (
            id SERIAL PRIMARY KEY,
            node_id TEXT NOT NULL,
            room_id TEXT NOT NULL,
            sensor TEXT NOT NULL,
            value DOUBLE PRECISION NOT NULL,
            reading_time TIMESTAMPTZ NOT NULL
        )
        """
    )
    connection.commit()
    cursor.close()
    connection.close()

    # TODO(Aditya): convert sensor_readings into a TimescaleDB hypertable
    # (SELECT create_hypertable(...)) once the schema is finalized, so the
    # trend early-warning feature can query it efficiently.


def insert_sensor_reading(node_id, room_id, sensor, value, reading_time):
    connection = get_connection()
    cursor = connection.cursor()
    cursor.execute(
        """
        INSERT INTO sensor_readings (node_id, room_id, sensor, value, reading_time)
        VALUES (%s, %s, %s, %s, %s)
        """,
        (node_id, room_id, sensor, value, reading_time),
    )
    connection.commit()
    cursor.close()
    connection.close()
