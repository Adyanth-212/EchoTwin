import asyncio
import json
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app import config, db
from app.fusion import build_room_status
from app.mqtt_listener import start_mqtt_listener, stop_mqtt_listener
from app.ollama_client import get_ai_advice
from app.routes.history import router as history_router
from app.routes.maintenance import router as maintenance_router
from app.maintenance.store import init_schema as init_maintenance_schema
from app.routes.ws import router as ws_router
from app.schemas.cv import CVEvent
from app.ws_manager import manager


@asynccontextmanager
async def lifespan(app):
    manager.set_loop(asyncio.get_running_loop())
    db.init_db()
    init_maintenance_schema()
    mqtt_client = start_mqtt_listener()
    yield
    stop_mqtt_listener(mqtt_client)


app = FastAPI(title="EchoTwin backend", version="0.3.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)
app.include_router(history_router)
app.include_router(maintenance_router)
app.include_router(ws_router)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/db-health")
def db_health():
    try:
        with db.engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        return {"database": "connected"}
    except Exception as error:
        return {"database": "error", "detail": str(error)}


@app.get("/sensor-readings")
def sensor_readings(limit: int = 20):
    safe_limit = min(max(limit, 1), 500)
    with db.engine.connect() as connection:
        rows = connection.execute(
            text(
                """
                SELECT time, node_id, room_id, sensor, value
                FROM sensor_readings
                ORDER BY time DESC
                LIMIT :limit
                """
            ),
            {"limit": safe_limit},
        ).fetchall()
    return [dict(row._mapping) for row in rows]


@app.post("/cv")
def receive_cv(event: CVEvent):
    raw_data = event.model_dump(mode="json")
    with db.engine.begin() as connection:
        connection.execute(
            text(
                """
                INSERT INTO cv_events
                    (time, room_id, camera_id, occupancy,
                     unusual_activity, confidence, raw_data)
                VALUES
                    (:time, :room_id, :camera_id, :occupancy,
                     :unusual_activity, :confidence, CAST(:raw_data AS JSONB))
                """
            ),
            {
                "time": event.timestamp,
                "room_id": event.room_id,
                "camera_id": event.camera_id,
                "occupancy": event.occupancy,
                "unusual_activity": event.unusual_activity,
                "confidence": event.confidence,
                "raw_data": json.dumps(raw_data),
            },
        )

    build_room_status(event.room_id, "cv")
    return {
        "status": "saved",
        "room_id": event.room_id,
        "occupancy": event.occupancy,
    }


@app.get("/cv-events")
def cv_events(limit: int = 20):
    safe_limit = min(max(limit, 1), 500)
    with db.engine.connect() as connection:
        rows = connection.execute(
            text(
                """
                SELECT time, room_id, camera_id, occupancy,
                       unusual_activity, confidence
                FROM cv_events
                ORDER BY time DESC
                LIMIT :limit
                """
            ),
            {"limit": safe_limit},
        ).fetchall()
    return [dict(row._mapping) for row in rows]


def serialize_room_status(row):
    return {
        "room_id": row.room_id,
        "timestamp": row.updated_at.isoformat(),
        "status": row.status,
        "source": row.source,
        "sensors": row.sensors,
        "anomaly": row.anomaly,
        "trend": row.trend,
        "suggestions": row.suggestions,
    }


@app.get("/room-status")
def room_statuses():
    with db.engine.connect() as connection:
        rows = connection.execute(
            text("SELECT * FROM room_status ORDER BY room_id")
        ).fetchall()
    return [serialize_room_status(row) for row in rows]


def fetch_room_status(room_id):
    with db.engine.connect() as connection:
        row = connection.execute(
            text("SELECT * FROM room_status WHERE room_id = :room_id"),
            {"room_id": room_id},
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Room not found")
    return serialize_room_status(row)


@app.get("/room-status/{room_id}")
def single_room_status(room_id: str):
    return fetch_room_status(room_id)


@app.get("/room-status/{room_id}/ai-advice")
def room_ai_advice(room_id: str, question: str | None = Query(default=None, max_length=1000)):
    status = fetch_room_status(room_id)
    advice = get_ai_advice(status, question=question)

    if advice is None:
        return {
            "room_id": room_id,
            "source": "rules",
            "advice": status["suggestions"] or [
                "No rule-based alerts in the latest stored readings. "
                "Keep monitoring; the language model is currently unavailable."
            ],
        }

    return {"room_id": room_id, "source": "ollama", "advice": advice}
