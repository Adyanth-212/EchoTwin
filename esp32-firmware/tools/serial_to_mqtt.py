"""Capture EchoTwin Serial records locally and publish them to MQTT live."""

import argparse
import csv
import json
import sys
import time
from pathlib import Path

from replay_to_mqtt import map_record_to_messages
from serial_logger import (
    CSV_FIELDS,
    StructuredRecordError,
    build_output_paths,
    flatten_record,
    live_summary,
    parse_serial_line,
    utc_timestamp,
)


def build_publish_batch(record, node_id):
    """Return exact topic/payload pairs for one structured Serial record."""
    return [
        (
            "echotwin/sensors/" + message["node_id"],
            json.dumps(message, separators=(",", ":")),
        )
        for message in map_record_to_messages(record, node_id)
    ]


class LiveMqttPublisher:
    """Non-blocking MQTT publisher; Serial capture remains authoritative."""

    def __init__(self, host, port, node_id):
        try:
            import paho.mqtt.client as mqtt
        except ImportError as error:
            raise SystemExit(
                "paho-mqtt is required. Install tools/requirements.txt first."
            ) from error

        self.mqtt = mqtt
        self.host = host
        self.port = port
        self.node_id = node_id
        self.connected = False
        self.stopping = False
        self.acknowledged_count = 0
        self.client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
        self.client.on_connect = self._on_connect
        self.client.on_disconnect = self._on_disconnect
        self.client.on_publish = self._on_publish
        self.client.reconnect_delay_set(min_delay=1, max_delay=10)

    def _on_connect(self, client, userdata, flags, reason_code, properties=None):
        self.connected = reason_code == 0
        if self.connected:
            print("[MQTT CONNECTED] {0}:{1}".format(self.host, self.port))
        else:
            print("[MQTT CONNECT FAILED] reason=" + str(reason_code), file=sys.stderr)

    def _on_disconnect(
        self, client, userdata, disconnect_flags, reason_code, properties=None
    ):
        was_connected = self.connected
        self.connected = False
        if not self.stopping and (was_connected or reason_code != 0):
            print(
                "[MQTT DISCONNECTED] reason={0}; Serial capture continues".format(
                    reason_code
                ),
                file=sys.stderr,
            )

    def _on_publish(self, client, userdata, mid, reason_code, properties=None):
        self.acknowledged_count += 1

    def start(self):
        print("[MQTT CONNECTING] {0}:{1}".format(self.host, self.port))
        self.client.connect_async(self.host, self.port, keepalive=30)
        self.client.loop_start()

    def stop(self):
        self.stopping = True
        try:
            self.client.disconnect()
        finally:
            self.client.loop_stop()

    def publish_record(self, record):
        if not self.connected:
            return 0
        queued = 0
        for topic, payload in build_publish_batch(record, self.node_id):
            result = self.client.publish(topic, payload, qos=1, retain=False)
            if result.rc == self.mqtt.MQTT_ERR_SUCCESS:
                queued += 1
            else:
                print(
                    "[MQTT ERROR] topic={0} rc={1}; sample remains local".format(
                        topic, result.rc
                    ),
                    file=sys.stderr,
                )
        return queued


def run_bridge(args):
    try:
        import serial
    except ImportError as error:
        raise SystemExit(
            "pyserial is required. Install tools/requirements.txt first."
        ) from error

    output_dir = Path(args.output_dir).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    jsonl_path, csv_path = build_output_paths(output_dir, args.label)
    publisher = LiveMqttPublisher(args.broker_host, args.broker_port, args.node_id)
    publisher.start()

    valid_count = invalid_count = dropped_count = mqtt_queued_count = 0
    last_sample_id = None
    stop_at = time.monotonic() + args.duration if args.duration > 0 else None
    connection = None

    print("[LIVE] Serial {0} at {1} baud".format(args.port, args.baud))
    print("[LIVE] Local JSONL: " + str(jsonl_path))
    print("[LIVE] Local CSV:   " + str(csv_path))
    print("[LIVE] MQTT topic: echotwin/sensors/" + args.node_id)

    try:
        with jsonl_path.open("a", encoding="utf-8", newline="") as jsonl_file, \
                csv_path.open("a", encoding="utf-8", newline="") as csv_file:
            csv_writer = csv.DictWriter(
                csv_file, fieldnames=CSV_FIELDS, extrasaction="ignore"
            )
            if csv_file.tell() == 0:
                csv_writer.writeheader()
                csv_file.flush()

            while stop_at is None or time.monotonic() < stop_at:
                if connection is None or not connection.is_open:
                    try:
                        connection = serial.Serial(
                            port=args.port, baudrate=args.baud, timeout=1
                        )
                        print("[SERIAL CONNECTED] " + args.port)
                    except (serial.SerialException, OSError) as error:
                        print("[SERIAL WAITING] {0}; retrying".format(error), file=sys.stderr)
                        time.sleep(2)
                        continue

                try:
                    raw_line = connection.readline()
                    if not raw_line:
                        continue
                    try:
                        record = parse_serial_line(
                            raw_line.decode("utf-8", errors="replace")
                        )
                    except StructuredRecordError as error:
                        invalid_count += 1
                        print("[SERIAL INVALID] " + str(error), file=sys.stderr)
                        continue
                    if record is None:
                        continue
                    if record["node_id"] != args.node_id:
                        invalid_count += 1
                        print(
                            "[SERIAL INVALID] node_id {0}; expected {1}".format(
                                record["node_id"], args.node_id
                            ),
                            file=sys.stderr,
                        )
                        continue

                    sample_id = record["sample_id"]
                    if last_sample_id is not None and sample_id > last_sample_id + 1:
                        dropped_count += sample_id - last_sample_id - 1
                    last_sample_id = sample_id

                    stored_record = dict(record)
                    stored_record["host_timestamp"] = utc_timestamp()
                    stored_record["capture_label"] = args.label
                    json.dump(stored_record, jsonl_file, separators=(",", ":"))
                    jsonl_file.write("\n")
                    jsonl_file.flush()
                    csv_writer.writerow(flatten_record(stored_record))
                    csv_file.flush()
                    valid_count += 1

                    queued = publisher.publish_record(stored_record)
                    mqtt_queued_count += queued
                    print(
                        "[LIVE] {0} | mqtt={1} queued={2} total_queued={3} acked={4}".format(
                            live_summary(
                                stored_record, valid_count, invalid_count, dropped_count
                            ),
                            "connected" if publisher.connected else "offline",
                            queued,
                            mqtt_queued_count,
                            publisher.acknowledged_count,
                        )
                    )
                except (serial.SerialException, OSError) as error:
                    print("[SERIAL DISCONNECTED] {0}; retrying".format(error), file=sys.stderr)
                    try:
                        connection.close()
                    except Exception:
                        pass
                    connection = None
    except KeyboardInterrupt:
        print("\n[LIVE] Stopped by Ctrl+C.")
    finally:
        if connection is not None:
            try:
                connection.close()
            except Exception:
                pass
        publisher.stop()

    print(
        "[LIVE COMPLETE] valid={0} invalid={1} dropped={2} mqtt_queued={3} "
        "mqtt_acked={4}".format(
            valid_count,
            invalid_count,
            dropped_count,
            mqtt_queued_count,
            publisher.acknowledged_count,
        )
    )
    print("JSONL: " + str(jsonl_path))
    print("CSV:   " + str(csv_path))
    return 0


def parse_args(argv=None):
    default_output = Path(__file__).resolve().parent.parent / "data"
    parser = argparse.ArgumentParser(
        description="Capture USB Serial data locally and publish allowed MQTT readings live."
    )
    parser.add_argument("--port", required=True)
    parser.add_argument("--baud", type=int, default=115200)
    parser.add_argument("--broker-host", required=True)
    parser.add_argument("--broker-port", type=int, default=1883)
    parser.add_argument("--duration", type=float, default=0)
    parser.add_argument("--node-id", default="node_1")
    parser.add_argument("--label", default="live_mqtt")
    parser.add_argument("--output-dir", default=str(default_output))
    args = parser.parse_args(argv)
    if args.baud <= 0:
        parser.error("--baud must be greater than zero")
    if args.broker_port <= 0 or args.broker_port > 65535:
        parser.error("--broker-port must be between 1 and 65535")
    if args.duration < 0:
        parser.error("--duration cannot be negative")
    return args


def main(argv=None):
    return run_bridge(parse_args(argv))


if __name__ == "__main__":
    raise SystemExit(main())
