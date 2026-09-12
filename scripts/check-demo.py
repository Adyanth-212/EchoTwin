"""Read-only demo checks. Uses Python's standard library; never publishes samples."""

import argparse
import json
import sys
from datetime import datetime, timezone
from urllib.error import URLError
from urllib.parse import quote
from urllib.request import Request, urlopen


SENSORS = ("temperature", "humidity", "eco2", "tvoc", "aqi", "surface_temp",
           "vibration_magnitude", "vibration_trip")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--backend", default="http://localhost:8000")
    parser.add_argument("--room", default="corridor_a")
    parser.add_argument("--frontend", help="Optional Vite URL; checks REST proxy and scan assets")
    parser.add_argument("--require-cameras", action="store_true", help="Fail when cam1/cam2 events are missing or stale")
    parser.add_argument("--check-ai", action="store_true", help="Request one answer; rules fallback is a warning")
    parser.add_argument("--max-age", type=float, default=30, help="Freshness limit in seconds")
    args = parser.parse_args()
    failures = []
    warnings = []

    def report(level, label, detail):
        print("[{0}] {1}: {2}".format(level, label, detail))
        if level == "FAIL":
            failures.append(label)
        elif level == "WARN":
            warnings.append(label)

    def fetch(base, path, method="GET"):
        request = Request(base.rstrip("/") + path, method=method)
        with urlopen(request, timeout=30 if "ai-advice" in path else 8) as response:
            return {} if method == "HEAD" else json.load(response)

    def check(label, operation):
        try:
            return operation()
        except (URLError, TimeoutError, ValueError, KeyError, TypeError, OSError) as error:
            report("FAIL", label, str(error))
            return None

    def age(timestamp):
        value = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
        if value.tzinfo is None:
            raise ValueError("timestamp has no timezone")
        return (datetime.now(timezone.utc) - value).total_seconds()

    for path, key, expected in (("/health", "status", "ok"), ("/db-health", "database", "connected")):
        payload = check(path, lambda: fetch(args.backend, path))
        if payload is not None:
            report("PASS" if payload.get(key) == expected else "FAIL", path, payload.get(key))

    room_path = "/room-status/" + quote(args.room, safe="")
    room = check("room status", lambda: fetch(args.backend, room_path))
    if room is not None:
        missing = [name for name in SENSORS if room.get("sensors", {}).get(name) is None]
        report("FAIL" if missing else "PASS", "room sensors", ", ".join(missing) if missing else "all eight channels populated")
        report("PASS" if room.get("anomaly", {}).get("score") is not None else "WARN", "anomaly model", room.get("anomaly"))

    rows = check("sensor samples", lambda: fetch(args.backend, "/sensor-readings?limit=500"))
    if rows is not None:
        for name in SENSORS:
            reading = next((row for row in rows if row["room_id"] == args.room and row["sensor"] == name), None)
            if reading is None:
                report("FAIL", name, "no recent sample in latest 500 rows")
            else:
                seconds = check(name + " timestamp", lambda: age(reading["time"]))
                if seconds is not None:
                    report("PASS" if -5 <= seconds <= args.max_age else "FAIL", name, "{0:.1f}s old; node={1}".format(seconds, reading["node_id"]))

    events = check("camera events", lambda: fetch(args.backend, "/cv-events?limit=500"))
    if events is not None:
        for camera_id in ("cam1", "cam2"):
            event = next((row for row in events if row["room_id"] == args.room and row["camera_id"] == camera_id), None)
            seconds = check(camera_id + " timestamp", lambda: age(event["time"])) if event else None
            fresh = seconds is not None and -5 <= seconds <= args.max_age
            report("PASS" if fresh else ("FAIL" if args.require_cameras else "WARN"), camera_id,
                   "{0:.1f}s old".format(seconds) if seconds is not None else "no event received")

    for kind in ("sensors", "cv-events"):
        path = "/history/" + kind + "?room_id=" + quote(args.room, safe="") + "&bucket=5m&limit=10"
        payload = check(kind + " history", lambda: fetch(args.backend, path))
        if payload is not None:
            report("PASS" if payload.get("point_count", 0) > 0 else "WARN", kind + " history", str(payload.get("point_count", 0)) + " points")

    if args.frontend:
        payload = check("frontend REST proxy", lambda: fetch(args.frontend, "/api/health"))
        if payload is not None:
            report("PASS" if payload.get("status") == "ok" else "FAIL", "frontend REST proxy", payload)
        def scan_header(path, signature):
            request = Request(args.frontend.rstrip("/") + path, headers={"Range": "bytes=0-3"})
            with urlopen(request, timeout=8) as response:
                if not response.read(4).startswith(signature):
                    raise ValueError("scan signature missing (HTML fallback or wrong asset)")
            return True

        for path, signature in (("/scans/table-mesh.glb", b"glTF"), ("/scans/table-gaussian.ply", b"ply")):
            if check(path, lambda: scan_header(path, signature)):
                report("PASS", path, "valid scan header served")
        for camera_id in ("cam1", "cam2"):
            try:
                payload = fetch(args.frontend, "/" + camera_id + "/positions")
                seconds = age(payload["timestamp"]) if payload.get("timestamp") else float("inf")
                fresh = -5 <= seconds <= args.max_age
                report("PASS" if fresh else ("FAIL" if args.require_cameras else "WARN"), camera_id + " proxy", "{0:.1f}s old; calibrated={1}".format(seconds, payload.get("calibrated")))
            except (URLError, TimeoutError, ValueError, KeyError, OSError, TypeError) as error:
                report("FAIL" if args.require_cameras else "WARN", camera_id + " proxy", str(error))

    if args.check_ai:
        payload = check("AI advice", lambda: fetch(args.backend, room_path + "/ai-advice?question=What%20needs%20attention%3F"))
        if payload is not None:
            report("PASS" if payload.get("source") == "ollama" and payload.get("advice") else "WARN", "AI advice", "source=" + str(payload.get("source")))

    print("\n{0} failure(s), {1} warning(s). Camera calibration and visual alignment still need physical verification.".format(len(failures), len(warnings)))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
