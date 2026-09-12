"""Offline EchoTwin Serial capture utility."""

import argparse
import csv
import json
import math
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path


SERIAL_PREFIX = "[SERIAL_DATA]"

MEASUREMENT_FIELDS = [
    "aht21_temperature_c",
    "aht21_relative_humidity_pct",
    "ens160_eco2_ppm",
    "ens160_tvoc_ppb",
    "ens160_aqi",
    "mlx90614_ambient_temperature_c",
    "mlx90614_object_temperature_c",
    "mpu6050_acceleration_x_mps2",
    "mpu6050_acceleration_y_mps2",
    "mpu6050_acceleration_z_mps2",
    "mpu6050_gyroscope_x_rad_s",
    "mpu6050_gyroscope_y_rad_s",
    "mpu6050_gyroscope_z_rad_s",
    "acceleration_magnitude_mps2",
    "vibration_rms_mps2",
    "vibration_peak_mps2",
    "vibration_stddev_mps2",
    "sw420_raw_state",
    "sw420_trip_state",
    "sw420_event_count",
    "sw420_high_count",
    "sw420_low_count",
    "sw420_transition_count",
    "sw420_active_state",
]

STATUS_FIELDS = [
    "aht21_ready",
    "ens160_ready",
    "mlx90614_ready",
    "mpu6050_ready",
    "mpu_window_samples",
    "sw420_ready",
    "sw420_calibrated",
    "dht22_enabled",
    "wifi_connected",
    "mqtt_connected",
    "ntp_synchronized",
]

CSV_FIELDS = [
    "host_timestamp",
    "capture_label",
    "schema_version",
    "node_id",
    "sample_id",
    "device_uptime_ms",
]
CSV_FIELDS.extend(["status." + name for name in STATUS_FIELDS])
CSV_FIELDS.extend(MEASUREMENT_FIELDS)


class StructuredRecordError(ValueError):
    """Raised when a prefixed Serial record is malformed."""


def _is_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def validate_record(record):
    if not isinstance(record, dict):
        raise StructuredRecordError("JSON value must be an object")

    if not isinstance(record.get("schema_version"), (str, int)):
        raise StructuredRecordError("schema_version must be a string or integer")
    if not isinstance(record.get("node_id"), str) or not record.get("node_id"):
        raise StructuredRecordError("node_id must be a non-empty string")

    for field in ("sample_id", "device_uptime_ms"):
        value = record.get(field)
        if not isinstance(value, int) or isinstance(value, bool) or value < 0:
            raise StructuredRecordError(field + " must be a non-negative integer")

    status = record.get("status")
    if not isinstance(status, dict):
        raise StructuredRecordError("status must be an object")

    for field in MEASUREMENT_FIELDS:
        if field not in record:
            continue
        value = record[field]
        if value is not None:
            if not _is_number(value) or not math.isfinite(float(value)):
                raise StructuredRecordError(field + " must be a finite number or null")
    return record


def parse_serial_line(line):
    """Return a validated record, None for debug text, or raise for bad data."""
    text = line.strip()
    if not text.startswith(SERIAL_PREFIX):
        return None
    payload = text[len(SERIAL_PREFIX):]
    if not payload:
        raise StructuredRecordError("missing JSON after prefix")
    try:
        record = json.loads(payload)
    except json.JSONDecodeError as error:
        raise StructuredRecordError("malformed JSON: " + str(error)) from error
    return validate_record(record)


def flatten_record(record, parent_key="", separator="."):
    """Flatten nested objects for one CSV row."""
    flattened = {}
    for key, value in record.items():
        full_key = key if not parent_key else parent_key + separator + key
        if isinstance(value, dict):
            flattened.update(flatten_record(value, full_key, separator))
        elif isinstance(value, (list, tuple)):
            flattened[full_key] = json.dumps(value, separators=(",", ":"))
        else:
            flattened[full_key] = value
    return flattened


def utc_timestamp():
    value = datetime.now(timezone.utc).isoformat(timespec="milliseconds")
    return value.replace("+00:00", "Z")


def safe_label(value):
    cleaned = re.sub(r"[^A-Za-z0-9_-]+", "_", value.strip())
    return cleaned.strip("_") or "capture"


def compact_value(record, key, decimals=2):
    value = record.get(key)
    if not _is_number(value):
        return "null"
    return ("{:." + str(decimals) + "f}").format(value)


def live_summary(record, valid_count, invalid_count, dropped_count):
    parts = [
        "sample=" + str(record.get("sample_id")),
        "AHT21=" + compact_value(record, "aht21_temperature_c") + "C/" +
        compact_value(record, "aht21_relative_humidity_pct") + "%",
        "eCO2=" + compact_value(record, "ens160_eco2_ppm", 0) + "ppm",
        "surface=" + compact_value(record, "mlx90614_object_temperature_c") + "C",
        "vib_rms=" + compact_value(record, "vibration_rms_mps2", 4) + "m/s^2",
        "SW=" + str(record.get("sw420_raw_state")) + "/trip=" +
        str(record.get("sw420_trip_state")) + "/events=" +
        str(record.get("sw420_event_count")) + "/trans=" +
        str(record.get("sw420_transition_count")) + "/H=" +
        str(record.get("sw420_high_count")) + "/L=" +
        str(record.get("sw420_low_count")),
        "valid=" + str(valid_count),
        "invalid=" + str(invalid_count),
        "dropped=" + str(dropped_count),
    ]
    return " | ".join(parts)


def build_output_paths(output_dir, label):
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    base_name = timestamp + "_" + safe_label(label)
    return output_dir / (base_name + ".jsonl"), output_dir / (base_name + ".csv")


def capture(args):
    try:
        import serial
    except ImportError as error:
        raise SystemExit(
            "pyserial is required. Install tools/requirements.txt before capture."
        ) from error

    output_dir = Path(args.output_dir).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    jsonl_path, csv_path = build_output_paths(output_dir, args.label)

    valid_count = 0
    invalid_count = 0
    dropped_count = 0
    last_sample_id = None
    started = time.monotonic()
    stop_at = started + args.duration if args.duration > 0 else None
    connection = None

    with jsonl_path.open("a", encoding="utf-8", newline="") as jsonl_file, \
            csv_path.open("a", encoding="utf-8", newline="") as csv_file:
        csv_writer = csv.DictWriter(csv_file, fieldnames=CSV_FIELDS,
                                    extrasaction="ignore")
        if csv_file.tell() == 0:
            csv_writer.writeheader()
            csv_file.flush()

        print("Offline capture: {0} at {1} baud".format(args.port, args.baud))
        print("Writing {0} and {1}".format(jsonl_path, csv_path))

        try:
            while stop_at is None or time.monotonic() < stop_at:
                if connection is None or not connection.is_open:
                    try:
                        connection = serial.Serial(
                            port=args.port,
                            baudrate=args.baud,
                            timeout=1,
                        )
                        print("Connected to " + args.port)
                    except (serial.SerialException, OSError) as error:
                        print("Serial unavailable; retrying: " + str(error), file=sys.stderr)
                        time.sleep(2)
                        continue

                try:
                    raw_line = connection.readline()
                    if not raw_line:
                        continue
                    line = raw_line.decode("utf-8", errors="replace")
                    try:
                        record = parse_serial_line(line)
                    except StructuredRecordError as error:
                        invalid_count += 1
                        print("Malformed structured record: " + str(error), file=sys.stderr)
                        continue
                    if record is None:
                        continue
                    if record["node_id"] != args.node_id:
                        invalid_count += 1
                        print(
                            "Unexpected node_id {0}; expected {1}".format(
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
                    print(live_summary(stored_record, valid_count,
                                       invalid_count, dropped_count))
                except (serial.SerialException, OSError) as error:
                    print("ESP32 disconnected; reconnecting: " + str(error),
                          file=sys.stderr)
                    try:
                        connection.close()
                    except Exception:
                        pass
                    connection = None
        except KeyboardInterrupt:
            print("\nCapture stopped by Ctrl+C.")
        finally:
            if connection is not None:
                try:
                    connection.close()
                except Exception:
                    pass

    print("Capture complete: valid={0}, invalid={1}, dropped={2}".format(
        valid_count, invalid_count, dropped_count
    ))
    print("JSONL: " + str(jsonl_path))
    print("CSV:   " + str(csv_path))
    return 0


def parse_args(argv=None):
    default_output = Path(__file__).resolve().parent.parent / "data"
    parser = argparse.ArgumentParser(
        description="Capture EchoTwin [SERIAL_DATA] records without a network."
    )
    parser.add_argument("--port", required=True, help="Serial port, for example COM10")
    parser.add_argument("--baud", type=int, default=115200)
    parser.add_argument(
        "--duration", type=float, default=0,
        help="Capture seconds; 0 continues until Ctrl+C",
    )
    parser.add_argument("--node-id", default="node_1")
    parser.add_argument("--label", default="capture")
    parser.add_argument("--output-dir", default=str(default_output))
    args = parser.parse_args(argv)
    if args.baud <= 0:
        parser.error("--baud must be greater than zero")
    if args.duration < 0:
        parser.error("--duration cannot be negative")
    return args


def main(argv=None):
    return capture(parse_args(argv))


if __name__ == "__main__":
    raise SystemExit(main())
