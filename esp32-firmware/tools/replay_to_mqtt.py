"""Replay offline EchoTwin JSONL records through the locked MQTT contract."""

import argparse
import json
import math
import time
from datetime import datetime
from pathlib import Path


MQTT_FIELD_MAP = {
    "aht21_temperature_c": "temperature",
    "aht21_relative_humidity_pct": "humidity",
    "ens160_eco2_ppm": "eco2",
    "ens160_tvoc_ppb": "tvoc",
    "ens160_aqi": "aqi",
    "mlx90614_object_temperature_c": "surface_temp",
    "vibration_rms_mps2": "vibration_magnitude",
    "sw420_trip_state": "vibration_trip",
}

ALLOWED_MQTT_SENSORS = set(MQTT_FIELD_MAP.values())


def is_publishable_number(value):
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(float(value))
    )


def map_record_to_messages(record, node_id=None):
    """Map one capture record to exact four-field MQTT payload objects."""
    timestamp = record.get("host_timestamp")
    if not isinstance(timestamp, str) or not timestamp:
        raise ValueError("record is missing host_timestamp")
    effective_node_id = node_id if node_id else record.get("node_id")
    if not isinstance(effective_node_id, str) or not effective_node_id:
        raise ValueError("record is missing node_id and no --node-id was supplied")

    messages = []
    for field, sensor_name in MQTT_FIELD_MAP.items():
        value = record.get(field)
        if not is_publishable_number(value):
            continue
        message = {
            "node_id": effective_node_id,
            "sensor": sensor_name,
            "value": value,
            "timestamp": timestamp,
        }
        messages.append(message)
    return messages


def parse_timestamp(value):
    normalized = value[:-1] + "+00:00" if value.endswith("Z") else value
    return datetime.fromisoformat(normalized)


def load_jsonl(path):
    records = []
    with path.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            if not line.strip():
                continue
            try:
                record = json.loads(line)
                if not isinstance(record, dict):
                    raise ValueError("record is not an object")
                parse_timestamp(record.get("host_timestamp", ""))
                records.append(record)
            except (json.JSONDecodeError, TypeError, ValueError) as error:
                print("[REPLAY SKIP] line {0}: {1}".format(line_number, error))
    return records


def parse_args(argv=None):
    parser = argparse.ArgumentParser(
        description="Replay an EchoTwin JSONL capture through the locked MQTT schema."
    )
    parser.add_argument("capture", type=Path)
    parser.add_argument("--broker-host", required=True)
    parser.add_argument("--port", type=int, default=1883)
    parser.add_argument(
        "--node-id", default=None,
        help="Optional node_id override; otherwise preserve each recorded node_id",
    )
    parser.add_argument(
        "--replay-speed", type=float, default=1.0,
        help="Timeline speed multiplier, for example 2.0 for twice as fast",
    )
    args = parser.parse_args(argv)
    if args.port <= 0 or args.port > 65535:
        parser.error("--port must be between 1 and 65535")
    if args.replay_speed <= 0:
        parser.error("--replay-speed must be greater than zero")
    return args


def main(argv=None):
    args = parse_args(argv)
    try:
        import paho.mqtt.client as mqtt
    except ImportError as error:
        raise SystemExit(
            "paho-mqtt is required. Install tools/requirements.txt before replay."
        ) from error

    records = load_jsonl(args.capture.expanduser().resolve())
    if not records:
        raise SystemExit("No replayable records were found.")

    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
    print("[REPLAY] Connecting to {0}:{1}; data is recorded, not live.".format(
        args.broker_host, args.port
    ))
    client.connect(args.broker_host, args.port, keepalive=30)
    client.loop_start()
    previous_timestamp = None
    published_count = 0
    try:
        for record in records:
            current_timestamp = parse_timestamp(record["host_timestamp"])
            if previous_timestamp is not None:
                delay = (current_timestamp - previous_timestamp).total_seconds()
                if delay > 0:
                    time.sleep(delay / args.replay_speed)
            previous_timestamp = current_timestamp

            messages = map_record_to_messages(record, args.node_id)
            for message in messages:
                if message["sensor"] not in ALLOWED_MQTT_SENSORS:
                    raise RuntimeError("attempted to publish a non-contract sensor name")
                topic = "echotwin/sensors/" + message["node_id"]
                payload = json.dumps(message, separators=(",", ":"))
                result = client.publish(topic, payload, qos=0, retain=False)
                result.wait_for_publish()
                published_count += 1
                print("[REPLAY] {0} {1}".format(topic, payload))
    except KeyboardInterrupt:
        print("\n[REPLAY] Stopped by Ctrl+C.")
    finally:
        client.loop_stop()
        client.disconnect()

    print("[REPLAY] Complete; published {0} recorded sensor messages.".format(
        published_count
    ))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
