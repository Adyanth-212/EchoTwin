import datetime

import paho.mqtt.client as mqtt
from pydantic import ValidationError

from app import config, db
from app.schemas.mqtt import MQTTMessage


def on_connect(client, userdata, flags, reason_code, properties=None):
    print("MQTT listener connected, reason code:", reason_code)
    client.subscribe(config.MQTT_TOPIC)


def on_message(client, userdata, msg):
    raw_payload = msg.payload.decode("utf-8")

    try:
        message = MQTTMessage.model_validate_json(raw_payload)
    except ValidationError as error:
        print("Rejected malformed MQTT message on topic", msg.topic)
        print(error)
        return

    room_id = config.NODE_ID_TO_ROOM_ID.get(message.node_id)
    if room_id is None:
        print("Unknown node_id, no room mapping configured:", message.node_id)
        return

    reading_time = datetime.datetime.fromisoformat(
        message.timestamp.replace("Z", "+00:00")
    )
    db.insert_sensor_reading(
        message.node_id, room_id, message.sensor, message.value, reading_time
    )

    # TODO(Aditya): fusion/anomaly logic goes here.
    # This is where a new sensor reading should feed into:
    #   1. The Isolation Forest anomaly model (ml/) to get is_anomaly/score/top_features
    #   2. The trend early-warning linear extrapolation over recent TimescaleDB rows
    #   3. Combining the above into a room "status" (green/yellow/red)
    # Once computed, build a WSMessage (app/schemas/ws.py) and broadcast it
    # with app.ws_manager.manager.broadcast(...). Not implemented yet —
    # this listener currently only validates and persists raw readings.


def start_mqtt_listener():
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
    client.on_connect = on_connect
    client.on_message = on_message
    client.connect(config.MQTT_BROKER_HOST, config.MQTT_BROKER_PORT, 60)
    client.loop_start()
    return client
