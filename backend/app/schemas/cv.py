from datetime import datetime, timezone

from pydantic import BaseModel, Field


class CVEvent(BaseModel):
    room_id: str = Field(pattern=r"^[a-z0-9]+(?:_[a-z0-9]+)*$")
    camera_id: str
    occupancy: int = Field(ge=0)
    unusual_activity: bool = False
    confidence: float | None = Field(default=None, ge=0, le=1)
    timestamp: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc)
    )
