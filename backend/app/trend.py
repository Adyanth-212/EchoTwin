from collections import defaultdict

import numpy as np
from sqlalchemy import text

from app.db import engine


THRESHOLDS = {
    "temperature": 30,
    "eco2": 1000,
    "tvoc": 300,
    "aqi": 4,
    "surface_temp": 40,
    "vibration_magnitude": 2.5,
}


def evaluate_trend(room_id):
    with engine.connect() as connection:
        rows = connection.execute(
            text(
                """
                SELECT sensor, value, time
                FROM (
                    SELECT sensor, value, time,
                           ROW_NUMBER() OVER (
                               PARTITION BY sensor ORDER BY time DESC
                           ) AS row_number
                    FROM sensor_readings
                    WHERE room_id = :room_id
                      AND sensor = ANY(:sensors)
                ) recent
                WHERE row_number <= 20
                ORDER BY sensor, time
                """
            ),
            {"room_id": room_id, "sensors": list(THRESHOLDS)},
        ).fetchall()

    readings = defaultdict(list)
    for row in rows:
        readings[row.sensor].append((row.time, float(row.value)))

    best_metric = None
    best_minutes = None

    for metric, samples in readings.items():
        if len(samples) < 4:
            continue

        start = samples[0][0]
        minute_offsets = np.array(
            [(sample_time - start).total_seconds() / 60 for sample_time, _ in samples]
        )
        values = np.array([value for _, value in samples])

        if minute_offsets[-1] - minute_offsets[0] < 0.5:
            continue

        slope, intercept = np.polyfit(minute_offsets, values, 1)
        if slope <= 0:
            continue

        threshold = THRESHOLDS[metric]
        current_offset = minute_offsets[-1]
        threshold_offset = (threshold - intercept) / slope
        minutes = threshold_offset - current_offset

        if minutes <= 0 or minutes > 24 * 60:
            continue

        if best_minutes is None or minutes < best_minutes:
            best_metric = metric
            best_minutes = minutes

    if best_minutes is None:
        return {"metric": None, "time_to_threshold_minutes": None}

    return {
        "metric": best_metric,
        "time_to_threshold_minutes": round(float(best_minutes), 1),
    }
