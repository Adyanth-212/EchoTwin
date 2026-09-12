"""Pure evidence calculations: no model-driven severity or notification decisions."""
import math
from statistics import mean

from app.rules import evaluate_rules

SENSORS = ("temperature", "humidity", "eco2", "tvoc", "aqi", "surface_temp", "vibration_magnitude", "vibration_trip")
UNITS = {"temperature": "C", "humidity": "%", "eco2": "ppm estimated", "tvoc": "ppb", "aqi": "index 1-5", "surface_temp": "C", "vibration_magnitude": "m/s2", "vibration_trip": "boolean"}
UPPER_WARNINGS = {"temperature": 30, "eco2": 1000, "tvoc": 300, "aqi": 4, "surface_temp": 40, "vibration_magnitude": 2.5}


def consecutive_seconds(samples, predicate, gap_limit):
    """Only a continuously observed trailing run counts; a data gap breaks it."""
    if not samples or not predicate(samples[-1]["value"]):
        return 0
    start = end = samples[-1]["time"]
    for sample in reversed(samples[:-1]):
        if (start - sample["time"]).total_seconds() > gap_limit or not predicate(sample["value"]):
            break
        start = sample["time"]
    return (end - start).total_seconds()


def summarize(rows, latest, now, settings):
    result = {}
    for sensor in SENSORS:
        # Duplicate same-time publications do not increase persistence or coverage.
        samples = sorted({row["time"]: row for row in rows if row["sensor"] == sensor and row["time"] <= now and math.isfinite(row["value"])}.values(), key=lambda row: row["time"])
        last = latest.get(sensor)
        sample_age = (now - last["time"]).total_seconds() if last else None
        received_at = last.get("received_at") if last else None
        receipt_age = (now - received_at).total_seconds() if received_at else None
        fresh = sample_age is not None and 0 <= sample_age <= settings.sensor_stale_seconds
        if receipt_age is not None:
            fresh = fresh and 0 <= receipt_age <= settings.sensor_stale_seconds
        values = [row["value"] for row in samples]
        metrics = {
            "unit": UNITS[sensor], "latest": last["value"] if last and math.isfinite(last["value"]) else None,
            "sample_at": last["time"].isoformat() if last else None,
            "received_at": received_at.isoformat() if received_at else None,
            "sample_age_seconds": round(sample_age, 1) if sample_age is not None else None,
            "receipt_age_seconds": round(receipt_age, 1) if receipt_age is not None else None,
            "fresh": fresh and last is not None and math.isfinite(last["value"]),
            "count": len(values), "mean": round(mean(values), 4) if values else None,
            "min": min(values) if values else None, "max": max(values) if values else None,
            "coverage": round(min(1, len(values) * settings.expected_sample_seconds / settings.window_seconds), 3),
            "warning_seconds": 0, "critical_seconds": 0,
            "sample_span_seconds": (samples[-1]["time"] - samples[0]["time"]).total_seconds() if len(samples) > 1 else 0,
            "slope_per_minute": None,
            "threshold_eta_minutes": None,
        }
        gap = min(settings.sensor_stale_seconds, max(3, settings.expected_sample_seconds * 3))
        if metrics["fresh"]:
            metrics["warning_seconds"] = consecutive_seconds(samples, lambda v: evaluate_rules({sensor: v})[0] in ("yellow", "red"), gap)
            metrics["critical_seconds"] = consecutive_seconds(samples, lambda v: evaluate_rules({sensor: v})[0] == "red", gap)
            if len(samples) >= 4:
                span = (samples[-1]["time"] - samples[0]["time"]).total_seconds()
                max_gap = max((b["time"] - a["time"]).total_seconds() for a, b in zip(samples, samples[1:]))
                if span >= 30 and max_gap <= gap:
                    xs = [(row["time"] - samples[0]["time"]).total_seconds() / 60 for row in samples]
                    xbar, ybar = mean(xs), mean(values)
                    denominator = sum((x - xbar) ** 2 for x in xs)
                    slope = sum((x - xbar) * (y - ybar) for x, y in zip(xs, values)) / denominator
                    metrics["slope_per_minute"] = round(slope, 5)
                    limit = UPPER_WARNINGS.get(sensor)
                    if limit and slope > 0 and metrics["latest"] < limit:
                        eta = (limit - metrics["latest"]) / slope
                        if 0 < eta <= 15:
                            metrics["threshold_eta_minutes"] = round(eta, 2)
        result[sensor] = metrics
    return result


def evaluate(snapshot, settings):
    findings = []
    for sensor, metric in snapshot["sensors"].items():
        if not metric["fresh"]:
            findings.append({"key": "missing:" + sensor, "severity": "warning", "title": sensor + " is not reporting fresh data", "evidence": {sensor: metric}, "action": "inspect_connection"})
        elif metric["critical_seconds"] >= settings.critical_persistence:
            findings.append({"key": "threshold:" + sensor, "severity": "critical", "title": sensor + " has a sustained critical reading", "evidence": {sensor: metric}, "action": "inspect"})
        elif metric["warning_seconds"] >= settings.warning_persistence:
            findings.append({"key": "threshold:" + sensor, "severity": "warning", "title": sensor + " has a sustained warning", "evidence": {sensor: metric}, "action": "inspect"})
        elif metric["threshold_eta_minutes"] is not None:
            findings.append({"key": "trend:" + sensor, "severity": "warning", "title": sensor + " is trending toward its warning threshold", "evidence": {sensor: metric}, "action": "monitor"})
    for camera, metrics in snapshot["cameras"].items():
        if not metrics["fresh"]:
            findings.append({"key": "missing:" + camera, "severity": "warning", "title": camera + " is not reporting fresh events", "evidence": {camera: metrics}, "action": "inspect_connection"})
    heat = snapshot["sensors"]["temperature"]
    vibration = snapshot["sensors"]["vibration_magnitude"]
    if (heat["fresh"] and vibration["fresh"] and heat["latest"] >= 30 and vibration["latest"] >= 2.5
            and min(heat["warning_seconds"], vibration["warning_seconds"]) >= settings.critical_persistence):
        findings.append({"key": "combined:heat_vibration", "severity": "critical", "title": "Sustained combined heat and vibration",
                         "evidence": {"temperature": heat, "vibration_magnitude": vibration}, "action": "inspect"})
    anomaly = snapshot.get("anomaly", {})
    if anomaly.get("is_anomaly") and all(metric["fresh"] for metric in snapshot["sensors"].values()):
        findings.append({"key": "anomaly:multisensor", "severity": "warning", "title": "Unusual multi-sensor pattern", "evidence": {"anomaly": anomaly}, "action": "inspect"})
    return findings
