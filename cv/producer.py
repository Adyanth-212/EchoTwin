"""EchoTwin computer-vision producer.

Counts people in a camera feed with YOLOv8n and posts the count to the
backend's /cv endpoint. One process per camera: run it on Laptop 1 as cam1
and on Laptop 2 as cam2.

The camera is an ordinary OpenCV device index. Iriun Webcam over USB shows
up as a normal index, but that index changes when USB devices are replugged,
which is why it is a command line argument and not a constant.

Style note: this file deliberately avoids f-strings, readlines(), Counter and
clever comprehensions, matching the project's Python style preference.
"""

import argparse
import re
import sys
import time
from datetime import datetime, timezone

import cv2
import requests
from ultralytics import YOLO


# Must match the backend's CVEvent pattern exactly.
ROOM_ID_PATTERN = re.compile(r"^[a-z0-9]+(?:_[a-z0-9]+)*$")

DEFAULT_BACKEND = "http://sanjays-macbook-air.tail833b77.ts.net:8000"

# COCO class 0 is "person". The model is the pretrained YOLOv8n as shipped —
# no training and no custom weights.
PERSON_CLASS = 0
MODEL_NAME = "yolov8n.pt"

# How many device indices to probe when the requested one will not open.
MAX_PROBE_INDEX = 10

POST_TIMEOUT_SECONDS = 5


def parse_arguments():
    parser = argparse.ArgumentParser(
        description="Count people with YOLOv8 and post occupancy to EchoTwin."
    )
    parser.add_argument(
        "--camera-index",
        type=int,
        default=2,
        help="OpenCV device index for the camera (default: 2)",
    )
    parser.add_argument(
        "--camera-id",
        default="cam1",
        help="Camera identifier sent to the backend (default: cam1)",
    )
    parser.add_argument(
        "--room-id",
        default="corridor_a",
        help="Room this camera watches (default: corridor_a)",
    )
    parser.add_argument(
        "--backend",
        default=DEFAULT_BACKEND,
        help="Backend base URL (default: " + DEFAULT_BACKEND + ")",
    )
    parser.add_argument(
        "--interval",
        type=float,
        default=1.5,
        help="Seconds between inference samples (default: 1.5)",
    )
    parser.add_argument(
        "--conf",
        type=float,
        default=0.4,
        help="Confidence floor for a detection to count (default: 0.4)",
    )
    parser.add_argument(
        "--jump",
        type=int,
        default=3,
        help=(
            "Occupancy change between consecutive samples that counts as "
            "unusual activity (default: 3)"
        ),
    )
    return parser.parse_args()


def probe_available_indices(skip_index):
    """Return the device indices that can actually be opened right now."""
    available = []
    index = 0
    while index < MAX_PROBE_INDEX:
        if index != skip_index:
            capture = cv2.VideoCapture(index)
            if capture.isOpened():
                available.append(index)
            capture.release()
        index = index + 1
    return available


def open_camera(camera_index):
    capture = cv2.VideoCapture(camera_index)
    if capture.isOpened():
        return capture

    capture.release()

    print("Could not open camera index " + str(camera_index) + ".")
    available = probe_available_indices(camera_index)
    if len(available) == 0:
        print("No other camera indices opened either.")
    else:
        names = []
        for index in available:
            names.append(str(index))
        print("These indices did open: " + ", ".join(names))
        print("Re-run with --camera-index <one of those>.")
    return None


def count_people(model, frame, confidence_floor):
    """Run one inference pass and return (count, mean_confidence_or_None)."""
    results = model.predict(
        frame,
        classes=[PERSON_CLASS],
        conf=confidence_floor,
        verbose=False,
    )

    count = 0
    confidence_total = 0.0

    for result in results:
        boxes = result.boxes
        if boxes is None:
            continue
        index = 0
        while index < len(boxes):
            score = float(boxes.conf[index])
            count = count + 1
            confidence_total = confidence_total + score
            index = index + 1

    if count == 0:
        return 0, None

    mean_confidence = confidence_total / count
    return count, round(mean_confidence, 3)


def post_event(session, backend_url, payload):
    """POST one CV event. Returns the status code, or None on failure."""
    url = backend_url.rstrip("/") + "/cv"
    try:
        response = session.post(url, json=payload, timeout=POST_TIMEOUT_SECONDS)
        return response.status_code
    except requests.RequestException as error:
        print("POST failed: " + str(error))
        return None


def main():
    arguments = parse_arguments()

    if ROOM_ID_PATTERN.match(arguments.room_id) is None:
        print(
            "Invalid --room-id '"
            + arguments.room_id
            + "'. It must be lowercase snake_case, e.g. corridor_a."
        )
        return 1

    print("Loading " + MODEL_NAME + " (first run downloads the weights)...")
    model = YOLO(MODEL_NAME)

    capture = open_camera(arguments.camera_index)
    if capture is None:
        return 1

    print(
        "Camera "
        + str(arguments.camera_index)
        + " open as "
        + arguments.camera_id
        + " for room "
        + arguments.room_id
        + ". Posting to "
        + arguments.backend
        + " every "
        + str(arguments.interval)
        + "s. Ctrl-C to stop."
    )

    session = requests.Session()

    previous_count = None
    last_sample_at = 0.0
    consecutive_read_failures = 0

    try:
        while True:
            # Frames are read continuously even between inference samples so
            # the capture buffer stays drained and the frame we do run on is
            # the current one, not a stale one from several seconds ago.
            was_read, frame = capture.read()

            if not was_read:
                consecutive_read_failures = consecutive_read_failures + 1
                if consecutive_read_failures == 1:
                    print("Dropped a frame; continuing.")
                if consecutive_read_failures > 300:
                    print("Camera stopped returning frames. Exiting.")
                    return 1
                time.sleep(0.05)
                continue

            consecutive_read_failures = 0

            now = time.time()
            if now - last_sample_at < arguments.interval:
                continue
            last_sample_at = now

            try:
                count, confidence = count_people(model, frame, arguments.conf)
            except Exception as error:
                # A single bad inference should not end the run.
                print("Inference failed: " + str(error))
                continue

            # Deliberately simple and explainable: an occupancy count that
            # jumps by more than the configured delta between consecutive
            # samples. This feeds a backend rule that already exists.
            is_unusual = False
            if previous_count is not None:
                if abs(count - previous_count) > arguments.jump:
                    is_unusual = True
            previous_count = count

            payload = {
                "room_id": arguments.room_id,
                "camera_id": arguments.camera_id,
                "occupancy": count,
                "unusual_activity": is_unusual,
                "confidence": confidence,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }

            status_code = post_event(session, arguments.backend, payload)

            line = (
                arguments.camera_id
                + ": "
                + str(count)
                + " person(s)"
            )
            if confidence is not None:
                line = line + ", mean conf " + str(confidence)
            if is_unusual:
                line = line + ", UNUSUAL"
            if status_code is None:
                line = line + " -> no response"
            else:
                line = line + " -> HTTP " + str(status_code)
            print(line)

    except KeyboardInterrupt:
        print("")
        print("Stopped.")
        return 0
    finally:
        capture.release()


if __name__ == "__main__":
    sys.exit(main())
