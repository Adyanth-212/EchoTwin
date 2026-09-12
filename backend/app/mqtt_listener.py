import json

import paho.mqtt.client as mqtt
from pydantic import ValidationError

from app import config, db
from app.fusion import build_room_status
from app.schemas.mqtt import MQTTMessage
from app.timestamp_validation import sensor_timestamp_rejection_reason


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

    timestamp_error = sensor_timestamp_rejection_reason(message.timestamp)
    if timestamp_error is not None:
        print(
            "Rejected sensor reading from",
            message.node_id,
            "because",
            timestamp_error,
        )
        return

    room_id = config.NODE_ID_TO_ROOM_ID.get(message.node_id)
    if room_id is None:
        print("Unknown node_id, no room mapping configured:", message.node_id)
        return

    db.insert_sensor_reading(message, room_id, json.loads(raw_payload))
    build_room_status(room_id, "sensor")


def start_mqtt_listener():
    client = mqtt.Client(
        mqtt.CallbackAPIVersion.VERSION2,
        client_id="echotwin-backend",
    )
    client.on_connect = on_connect
    client.on_message = on_message
    client.connect(config.MQTT_BROKER_HOST, config.MQTT_BROKER_PORT, 60)
    client.loop_start()
    return client


def stop_mqtt_listener(client):
    if client is None:
        return
    client.loop_stop()
    client.disconnect()
