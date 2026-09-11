from fastapi import FastAPI

from app import db
from app.mqtt_listener import start_mqtt_listener
from app.routes.ws import router as ws_router

app = FastAPI(title="EchoTwin backend")
app.include_router(ws_router)

mqtt_client = None


@app.on_event("startup")
def on_startup():
    global mqtt_client
    db.init_db()
    mqtt_client = start_mqtt_listener()


@app.on_event("shutdown")
def on_shutdown():
    if mqtt_client is not None:
        mqtt_client.loop_stop()


@app.get("/health")
def health():
    return {"status": "ok"}


# TODO(Aditya): add REST endpoints for the dashboard to fetch historical
# readings (for the trend chart) and the anomaly-explanation history, once
# the fusion logic in app/mqtt_listener.py is implemented.
