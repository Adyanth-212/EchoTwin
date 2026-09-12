"""Characterize an EchoTwin baseline capture without inventing calibration."""

import argparse
import csv
import json
import math
from datetime import datetime, timezone
from pathlib import Path

from serial_logger import MEASUREMENT_FIELDS, flatten_record


def percentile(values, percentage):
    if not values:
        return None
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    position = (len(ordered) - 1) * percentage / 100.0
    lower = int(math.floor(position))
    upper = int(math.ceil(position))
    if lower == upper:
        return ordered[lower]
    fraction = position - lower
    return ordered[lower] + (ordered[upper] - ordered[lower]) * fraction


def calculate_statistics(values):
    clean = [float(value) for value in values if math.isfinite(float(value))]
    if not clean:
        return None
    count = len(clean)
    mean = sum(clean) / count
    variance = sum((value - mean) ** 2 for value in clean) / count
    return {
        "sample_count": count,
        "mean": mean,
        "median": percentile(clean, 50),
        "standard_deviation": math.sqrt(variance),
        "minimum": min(clean),
        "maximum": max(clean),
        "percentile_5": percentile(clean, 5),
        "percentile_25": percentile(clean, 25),
        "percentile_75": percentile(clean, 75),
        "percentile_95": percentile(clean, 95),
    }


def parse_csv_value(value):
    if value is None or value.strip() == "":
        return None
    stripped = value.strip()
    lowered = stripped.lower()
    if lowered == "true":
        return True
    if lowered == "false":
        return False
    try:
        if all(character not in stripped.lower() for character in (".", "e")):
            return int(stripped)
        return float(stripped)
    except ValueError:
        return stripped


def load_capture(path):
    records = []
    invalid_rows = []
    if path.suffix.lower() == ".jsonl":
        with path.open("r", encoding="utf-8") as handle:
            for line_number, line in enumerate(handle, start=1):
                if not line.strip():
                    continue
                try:
                    value = json.loads(line)
                    if not isinstance(value, dict):
                        raise ValueError("record is not an object")
                    records.append(flatten_record(value))
                except (json.JSONDecodeError, ValueError) as error:
                    invalid_rows.append({"row": line_number, "reason": str(error)})
    elif path.suffix.lower() == ".csv":
        with path.open("r", encoding="utf-8", newline="") as handle:
            reader = csv.DictReader(handle)
            for row_number, row in enumerate(reader, start=2):
                if None in row:
                    invalid_rows.append({"row": row_number, "reason": "extra CSV columns"})
                    continue
                records.append({key: parse_csv_value(value) for key, value in row.items()})
    else:
        raise ValueError("capture must use the .jsonl or .csv extension")
    return records, invalid_rows


def field_values(records, field):
    values = []
    missing_count = 0
    invalid_count = 0
    for record in records:
        if field not in record or record[field] is None:
            missing_count += 1
            continue
        value = record[field]
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            invalid_count += 1
            continue
        number = float(value)
        if not math.isfinite(number):
            invalid_count += 1
            continue
        values.append(number)
    return values, missing_count, invalid_count


def detect_sw420_stuck(high_count, low_count, transition_count):
    total = high_count + low_count
    if total <= 0:
        return None
    return transition_count == 0 and (high_count == 0 or low_count == 0)


def sum_field(records, field):
    values, unused_missing, unused_invalid = field_values(records, field)
    return int(sum(values))


def rounded(value):
    if value is None:
        return None
    return round(value, 6)


def build_report(records, invalid_rows, source_path):
    measurements = {}
    for field in MEASUREMENT_FIELDS:
        values, missing_count, invalid_count = field_values(records, field)
        measurements[field] = {
            "statistics": calculate_statistics(values),
            "missing_count": missing_count,
            "invalid_count": invalid_count,
        }

    acceleration_baseline = {}
    for axis in ("x", "y", "z"):
        field = "mpu6050_acceleration_" + axis + "_mps2"
        statistics = measurements[field]["statistics"]
        acceleration_baseline[axis + "_mps2"] = (
            rounded(statistics["mean"]) if statistics else None
        )
    magnitude_stats = measurements["acceleration_magnitude_mps2"]["statistics"]
    acceleration_baseline["magnitude_mps2"] = (
        rounded(magnitude_stats["mean"]) if magnitude_stats else None
    )

    gyro_bias = {}
    for axis in ("x", "y", "z"):
        field = "mpu6050_gyroscope_" + axis + "_rad_s"
        statistics = measurements[field]["statistics"]
        gyro_bias[axis + "_rad_s"] = rounded(statistics["mean"]) if statistics else None

    vibration_stats = measurements["vibration_rms_mps2"]["statistics"]
    vibration = {
        "metric": "1-second rolling RMS of gravity-compensated dynamic acceleration",
        "unit": "m/s^2",
        "noise_floor_p95_mps2": None,
        "recommended_warning_threshold_mps2": None,
        "recommended_anomaly_threshold_mps2": None,
        "threshold_method": "warning=max(P95, mean+3sigma); anomaly=max(observed maximum, mean+5sigma)",
    }
    if vibration_stats:
        vibration["noise_floor_p95_mps2"] = rounded(vibration_stats["percentile_95"])
        vibration["recommended_warning_threshold_mps2"] = rounded(max(
            vibration_stats["percentile_95"],
            vibration_stats["mean"] + 3 * vibration_stats["standard_deviation"],
        ))
        vibration["recommended_anomaly_threshold_mps2"] = rounded(max(
            vibration_stats["maximum"],
            vibration_stats["mean"] + 5 * vibration_stats["standard_deviation"],
        ))

    high_count = sum_field(records, "sw420_high_count")
    low_count = sum_field(records, "sw420_low_count")
    transition_count = sum_field(records, "sw420_transition_count")
    event_count = sum_field(records, "sw420_event_count")
    sw_stuck = detect_sw420_stuck(high_count, low_count, transition_count)
    sw420 = {
        "high_count": high_count,
        "low_count": low_count,
        "transition_count": transition_count,
        "event_count": event_count,
        "appears_stuck": sw_stuck,
        "interpretation": (
            "No raw transitions were observed; check wiring and adjust the physical potentiometer."
            if sw_stuck else
            "Both raw levels or at least one transition were observed. Confirm the configured active level physically."
        ) if sw_stuck is not None else "No SW-420 observations were available.",
    }

    generated = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    return {
        "report_type": "baseline_characterization_not_absolute_calibration",
        "generated_at": generated,
        "source_capture": str(source_path),
        "record_count": len(records),
        "invalid_rows": invalid_rows,
        "measurements": measurements,
        "stationary_mpu_acceleration_baseline": acceleration_baseline,
        "stationary_gyroscope_bias_estimate": gyro_bias,
        "vibration_characterization": vibration,
        "sw420_diagnostics": sw420,
        "environmental_baseline_fields": {
            "AHT21": ["aht21_temperature_c", "aht21_relative_humidity_pct"],
            "ENS160": ["ens160_eco2_ppm", "ens160_tvoc_ppb", "ens160_aqi"],
            "MLX90614": [
                "mlx90614_ambient_temperature_c",
                "mlx90614_object_temperature_c",
            ],
        },
        "limitations": [
            "This report characterizes the recorded baseline; it is not traceable absolute calibration.",
            "Absolute temperature, humidity, and air-quality calibration requires trusted reference equipment.",
            "No sensor offsets or correction factors are inferred from an unreferenced capture.",
            "Vibration thresholds are installation-specific and are not laboratory-grade calibration.",
        ],
        "recommended_corrections": None,
    }


def format_number(value):
    if value is None:
        return "n/a"
    return "{0:.6g}".format(value)


def markdown_report(report):
    lines = [
        "# EchoTwin calibration summary",
        "",
        "Generated: " + report["generated_at"],
        "",
        "Source: `" + report["source_capture"] + "`",
        "",
        "Records analyzed: " + str(report["record_count"]),
        "",
        "> This is baseline characterization, not absolute calibration. Absolute temperature, humidity, and air-quality calibration requires trusted reference equipment. No offsets or corrections are invented by this analysis.",
        "",
        "## Numeric measurements",
        "",
        "| Field | N | Mean | Median | Std dev | Min | Max | P5 | P25 | P75 | P95 | Missing | Invalid |",
        "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for field, result in report["measurements"].items():
        stats = result["statistics"]
        if stats is None:
            values = ["0"] + ["n/a"] * 9
        else:
            values = [
                str(stats["sample_count"]),
                format_number(stats["mean"]),
                format_number(stats["median"]),
                format_number(stats["standard_deviation"]),
                format_number(stats["minimum"]),
                format_number(stats["maximum"]),
                format_number(stats["percentile_5"]),
                format_number(stats["percentile_25"]),
                format_number(stats["percentile_75"]),
                format_number(stats["percentile_95"]),
            ]
        values.extend([str(result["missing_count"]), str(result["invalid_count"])])
        lines.append("| " + field + " | " + " | ".join(values) + " |")

    accel = report["stationary_mpu_acceleration_baseline"]
    gyro = report["stationary_gyroscope_bias_estimate"]
    vibration = report["vibration_characterization"]
    sw420 = report["sw420_diagnostics"]
    lines.extend([
        "",
        "## Stationary MPU-6050 characterization",
        "",
        "- Acceleration baseline X/Y/Z: {0}, {1}, {2} m/s²".format(
            format_number(accel["x_mps2"]), format_number(accel["y_mps2"]),
            format_number(accel["z_mps2"]),
        ),
        "- Acceleration magnitude baseline: " + format_number(accel["magnitude_mps2"]) + " m/s²",
        "- Gyroscope bias X/Y/Z: {0}, {1}, {2} rad/s".format(
            format_number(gyro["x_rad_s"]), format_number(gyro["y_rad_s"]),
            format_number(gyro["z_rad_s"]),
        ),
        "- Vibration RMS noise floor (P95): " + format_number(vibration["noise_floor_p95_mps2"]) + " m/s²",
        "- Suggested warning threshold: " + format_number(vibration["recommended_warning_threshold_mps2"]) + " m/s²",
        "- Suggested anomaly threshold: " + format_number(vibration["recommended_anomaly_threshold_mps2"]) + " m/s²",
        "- Threshold method: " + vibration["threshold_method"],
        "",
        "## SW-420 diagnostics",
        "",
        "- HIGH samples: " + str(sw420["high_count"]),
        "- LOW samples: " + str(sw420["low_count"]),
        "- Raw transitions: " + str(sw420["transition_count"]),
        "- Debounced events: " + str(sw420["event_count"]),
        "- Appears stuck: " + str(sw420["appears_stuck"]),
        "- Interpretation: " + sw420["interpretation"],
        "",
        "## Environmental baselines",
        "",
        "AHT21, ENS160, and MLX90614 baseline statistics are listed in the numeric table above. Treat ENS160 startup readings cautiously and use trusted references for absolute checks.",
        "",
        "## Invalid and missing data",
        "",
        "Malformed input rows: " + str(len(report["invalid_rows"])),
        "",
        "Per-field missing and invalid counts are included in the table. Generated thresholds are only recommendations from this installation's recorded baseline.",
        "",
    ])
    return "\n".join(lines)


def parse_args(argv=None):
    default_output = Path(__file__).resolve().parent.parent / "calibration"
    parser = argparse.ArgumentParser(description="Analyze EchoTwin JSONL or CSV captures.")
    parser.add_argument("capture", type=Path)
    parser.add_argument("--output-dir", default=str(default_output))
    return parser.parse_args(argv)


def main(argv=None):
    args = parse_args(argv)
    capture_path = args.capture.expanduser().resolve()
    output_dir = Path(args.output_dir).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    records, invalid_rows = load_capture(capture_path)
    if not records:
        raise SystemExit("No valid records were found in " + str(capture_path))
    report = build_report(records, invalid_rows, capture_path)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    stem = timestamp + "_" + capture_path.stem + "_calibration"
    json_path = output_dir / (stem + ".json")
    markdown_path = output_dir / (stem + ".md")
    with json_path.open("w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=2)
        handle.write("\n")
    with markdown_path.open("w", encoding="utf-8") as handle:
        handle.write(markdown_report(report))
    print("Baseline characterization complete (not absolute calibration).")
    print("JSON: " + str(json_path))
    print("Markdown: " + str(markdown_path))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
