import os

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

# Fixed node_id -> room_id mapping. One sensor node per room in the
# current hackathon build. Add entries here as more nodes come online.
NODE_ID_TO_ROOM_ID = {
    "node_1": "corridor_a",
}
