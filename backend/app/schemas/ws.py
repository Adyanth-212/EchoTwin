# Matches schemas/mqtt_and_ws.md section 2 exactly. Do not change this
# shape without updating that file and every other consumer listed there.

from typing import List, Literal, Optional

from pydantic import BaseModel

RoomStatus = Literal["green", "yellow", "red"]
UpdateSource = Literal["sensor", "cv", "fusion"]


class SensorReadings(BaseModel):
    temperature: Optional[float] = None
    humidity: Optional[float] = None
    eco2: Optional[float] = None
    tvoc: Optional[float] = None
    aqi: Optional[float] = None
    surface_temp: Optional[float] = None
    vibration_magnitude: Optional[float] = None
    vibration_trip: Optional[bool] = None
    occupancy_count: Optional[int] = None


class AnomalyInfo(BaseModel):
    is_anomaly: bool = False
    score: Optional[float] = None
    top_features: List[str] = []


class TrendInfo(BaseModel):
    metric: Optional[str] = None
    time_to_threshold_minutes: Optional[float] = None


class WSMessage(BaseModel):
    room_id: str
    timestamp: str
    status: RoomStatus
    source: UpdateSource
    sensors: SensorReadings
    anomaly: AnomalyInfo
    trend: TrendInfo
