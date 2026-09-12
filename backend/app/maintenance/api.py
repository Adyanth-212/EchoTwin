"""Optional sidecar API: no MQTT subscriber and no changes to the demo server."""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from sqlalchemy import text

from app.db import engine
from app.maintenance.store import init_schema
from app.routes.maintenance import router


@asynccontextmanager
async def lifespan(app):
    # Existing sensor/CV tables belong to the main backend. It must be set up first.
    init_schema()
    yield


app = FastAPI(title="EchoTwin maintenance", lifespan=lifespan)
app.include_router(router)


@app.get("/health")
def health():
    with engine.connect() as connection:
        connection.execute(text("SELECT 1"))
    return {"status": "ok", "service": "maintenance"}
