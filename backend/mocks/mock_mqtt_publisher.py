# Publishes fake sensor readings matching schemas/mqtt_and_ws.md section 1,
# on a regular interval, so backend work can proceed without real ESP32
# hardware.
#
# Usage: python mock_mqtt_publisher.py

import datetime
import json
import random
import time

import paho.mqtt.client as mqtt

BROKER_HOST = "localhost"
BROKER_PORT = 1883
NODE_ID = "esp32_1"
PUBLISH_INTERVAL_SECONDS = 5

SENSOR_RANGES = {
    "temperature": (20.0, 28.0),
    "humidity": (30.0, 60.0),
    "eco2": (400.0, 800.0),
    "tvoc": (0.0, 200.0),
    "aqi": (1.0, 3.0),
    "surface_temp": (20.0, 30.0),
    "vibration_magnitude": (0.0, 2.0),
    "vibration_trip": (0.0, 1.0),
}


def build_message(sensor_name):
    low, high = SENSOR_RANGES[sensor_name]
    if sensor_name == "vibration_trip":
        value = 1 if random.random() < 0.05 else 0
    else:
        value = round(random.uniform(low, high), 2)
    timestamp = datetime.datetime.now(datetime.timezone.utc).isoformat()
    message = {
        "node_id": NODE_ID,
        "sensor": sensor_name,
        "value": value,
        "timestamp": timestamp,
    }
    return message


def main():
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
    client.connect(BROKER_HOST, BROKER_PORT, 60)
    client.loop_start()

    print("Publishing mock MQTT readings for node", NODE_ID)
    try:
        while True:
            for sensor_name in SENSOR_RANGES:
                message = build_message(sensor_name)
                topic = "echotwin/sensors/" + NODE_ID
                payload = json.dumps(message)
                client.publish(topic, payload)
                print("Published:", payload)
            time.sleep(PUBLISH_INTERVAL_SECONDS)
    except KeyboardInterrupt:
        print("Stopping mock publisher.")
    finally:
        client.loop_stop()
        client.disconnect()


if __name__ == "__main__":
    main()
