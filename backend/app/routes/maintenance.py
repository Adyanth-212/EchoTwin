from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import text
from app.db import engine
from app.maintenance.settings import Settings
from app.maintenance.store import incident_rows

router = APIRouter(prefix="/maintenance", tags=["maintenance"])


class Action(BaseModel):
    note: str = Field(default="", max_length=1000)


@router.get("/status")
def status():
    with engine.connect() as connection:
        row = connection.execute(text("SELECT * FROM maintenance_worker_state WHERE id=1")).mappings().first()
        snapshots = [dict(row) for row in connection.execute(text("SELECT * FROM maintenance_snapshots ORDER BY room_id")).mappings()]
    state = dict(row) if row else {}
    settings = Settings.from_env()
    heartbeat = state.get("heartbeat_at")
    state["running"] = heartbeat is not None and (datetime.now(timezone.utc) - heartbeat).total_seconds() < max(90, settings.urgent_seconds * 3)
    state["review_seconds"] = settings.review_seconds
    state["window_seconds"] = settings.window_seconds
    state["snapshots"] = snapshots
    return state


@router.get("/incidents")
def incidents(room_id: str | None = None, limit: int = Query(default=50, ge=1, le=200)):
    return {"incidents": incident_rows(room_id, limit)}


def transition(incident_id, action, payload):
    with engine.begin() as connection:
        incident = connection.execute(text("SELECT * FROM maintenance_incidents WHERE id=:id FOR UPDATE"), {"id": incident_id}).mappings().first()
        if not incident:
            raise HTTPException(404, "Incident not found")
        if incident["status"] == "resolved" or incident["status"] == action:
            return dict(incident)
        column = "acknowledged_at" if action == "acknowledged" else "resolved_at"
        row = connection.execute(text("UPDATE maintenance_incidents SET status=:status," + column + "=now(),operator_note=:note WHERE id=:id RETURNING *"),
                                 {"status": action, "note": payload.note, "id": incident_id}).mappings().one()
        return dict(row)


@router.post("/incidents/{incident_id}/acknowledge")
def acknowledge(incident_id: int, payload: Action):
    return transition(incident_id, "acknowledged", payload)


@router.post("/incidents/{incident_id}/resolve")
def resolve(incident_id: int, payload: Action):
    return transition(incident_id, "resolved", payload)


@router.post("/review")
def request_review():
    with engine.begin() as connection:
        row = connection.execute(text("""UPDATE maintenance_worker_state SET review_requested=TRUE,last_request_at=now()
            WHERE id=1 AND (last_request_at IS NULL OR last_request_at < now()-INTERVAL '15 seconds') RETURNING id""")).first()
    if row is None:
        raise HTTPException(429, "A review was recently requested; wait 15 seconds")
    return {"status": "queued", "detail": "The running worker will process this request"}
