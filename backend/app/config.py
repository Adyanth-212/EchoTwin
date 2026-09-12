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

TAILSCALE_OLLAMA_URL = os.environ.get("TAILSCALE_OLLAMA_URL", "")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "llama3.1:8b")
OLLAMA_TIMEOUT_SECONDS = float(os.environ.get("OLLAMA_TIMEOUT_SECONDS", "2.5"))

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
    "esp32_1": "corridor_a",
}
