# Matches schemas/mqtt_and_ws.md section 1 exactly. Do not change this
# shape without updating that file and every other consumer listed there.

from typing import Literal

from pydantic import BaseModel

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
    timestamp: str
