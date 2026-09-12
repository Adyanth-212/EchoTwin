import os
from urllib.parse import quote_plus

from dotenv import load_dotenv

load_dotenv()

POSTGRES_HOST = os.environ.get("POSTGRES_HOST", "localhost")
POSTGRES_PORT = os.environ.get("POSTGRES_PORT", "5432")
POSTGRES_DB = os.environ.get("POSTGRES_DB", "echotwin")
POSTGRES_USER = os.environ.get("POSTGRES_USER", "echotwin")
POSTGRES_PASSWORD = os.environ.get("POSTGRES_PASSWORD", "changeme")

MQTT_BROKER_HOST = os.environ.get("MQTT_BROKER_HOST", "localhost")
MQTT_BROKER_PORT = int(os.environ.get("MQTT_BROKER_PORT", "1883"))
MQTT_TOPIC = "echotwin/sensors/#"
SENSOR_TIMESTAMP_MAX_AGE_SECONDS = int(
    os.environ.get("SENSOR_TIMESTAMP_MAX_AGE_SECONDS", "300")
)
SENSOR_TIMESTAMP_FUTURE_TOLERANCE_SECONDS = int(
    os.environ.get("SENSOR_TIMESTAMP_FUTURE_TOLERANCE_SECONDS", "60")
)

TAILSCALE_OLLAMA_URL = os.environ.get("TAILSCALE_OLLAMA_URL", "")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "qwen3:8b")
OLLAMA_TIMEOUT_SECONDS = float(os.environ.get("OLLAMA_TIMEOUT_SECONDS", "20"))

DEFAULT_CORS_ORIGINS = ",".join(
    [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]
)
CORS_ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.environ.get(
        "CORS_ALLOWED_ORIGINS", DEFAULT_CORS_ORIGINS
    ).split(",")
    if origin.strip()
]

DATABASE_URL = os.environ.get("DATABASE_URL")
if not DATABASE_URL:
    DATABASE_URL = (
        "postgresql+psycopg2://"
        + quote_plus(POSTGRES_USER)
        + ":"
        + quote_plus(POSTGRES_PASSWORD)
        + "@"
        + POSTGRES_HOST
        + ":"
        + POSTGRES_PORT
        + "/"
        + POSTGRES_DB
    )

# Fixed node_id -> room_id mapping. One sensor node per room in the
# current hackathon build. Add entries here as more nodes come online.
NODE_ID_TO_ROOM_ID = {
    "node_1": "corridor_a",
}
