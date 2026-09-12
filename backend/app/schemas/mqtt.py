# Matches schemas/mqtt_and_ws.md section 1 exactly. Do not change this
# shape without updating that file and every other consumer listed there.

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, field_validator

SensorName = Literal[
    "temperature",
    "humidity",
    "eco2",
    "tvoc",
    "aqi",
    "surface_temp",
    "vibration_magnitude",
    "vibration_trip",
    "temperature_backup",
    "humidity_backup",
]


class MQTTMessage(BaseModel):
    node_id: str
    sensor: SensorName
    value: float
    timestamp: datetime

    @field_validator("timestamp")
    @classmethod
    def timestamp_must_include_timezone(cls, value):
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("timestamp must include a timezone")
        return value
