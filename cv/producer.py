"""EchoTwin computer-vision producer.

Counts people in a camera feed with YOLOv8n, posts the count to the backend's
/cv endpoint, and serves each person's position on the floor so the dashboard
can draw them inside the 3D room.

One process per camera: run it on Laptop 1 as cam1 and on Laptop 2 as cam2.

The camera can be either an OpenCV device index (a USB webcam, or a phone via
Iriun) or a URL (a phone running IP Webcam or an RTSP app, mounted as a fixed
CCTV camera). Both go to cv2.VideoCapture, which accepts either.

Floor positions come from a homography calibrated once with --calibrate. That
is only valid while the camera does not move, which is exactly the case for a
mounted phone. Without a calibration the producer still posts occupancy counts
as before; it just does not report positions.

Style note: this file deliberately avoids f-strings, readlines(), Counter and
clever comprehensions, matching the project's Python style preference.
"""

import argparse
import json
import os
import platform
import re
import subprocess
import sys
import threading
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import cv2
import numpy as np
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

# The order corners must be clicked in during calibration. Near means the edge
# closest to the camera.
CORNER_PROMPTS = [
    "near-left",
    "near-right",
    "far-right",
    "far-left",
]

# Colours are BGR, as OpenCV wants them.
BOX_COLOR = (192, 208, 75)
BOX_TEXT_COLOR = (255, 255, 255)

# Shared between the inference loop and the HTTP thread. The preview is the
# frame inference actually ran on, with its boxes drawn, so what the dashboard
# shows is what the model saw - not a different frame grabbed later.
latest_preview = {"jpeg": None, "timestamp": None}
preview_lock = threading.Lock()

latest_state = {
    "camera_id": "cam1",
    "room_id": "corridor_a",
    "timestamp": None,
    "occupancy": 0,
    "calibrated": False,
    "people": [],
}
state_lock = threading.Lock()


def parse_arguments():
    parser = argparse.ArgumentParser(
        description="Count people with YOLOv8 and post occupancy to EchoTwin."
    )
    parser.add_argument(
        "--source",
        default=None,
        help=(
            "Camera source: a device index like 2, or a URL like "
            "http://192.168.1.31:8080/video for a phone running IP Webcam. "
            "Overrides --camera-index."
        ),
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
    parser.add_argument(
        "--http-port",
        type=int,
        default=8010,
        help=(
            "Port to serve floor positions on for the dashboard "
            "(default: 8010; use 8011 for the second camera)"
        ),
    )
    parser.add_argument(
        "--list-cameras",
        action="store_true",
        help=(
            "List the camera indices that open, with device names on macOS, "
            "then exit. Use it to find which index is the iPhone."
        ),
    )
    parser.add_argument(
        "--preview-width",
        type=int,
        default=640,
        help=(
            "Width in pixels of the annotated preview served to the "
            "dashboard. 0 turns the preview off (default: 640)"
        ),
    )
    parser.add_argument(
        "--preview-quality",
        type=int,
        default=70,
        help="JPEG quality of the preview, 1-100 (default: 70)",
    )
    parser.add_argument(
        "--calibrate",
        action="store_true",
        help=(
            "Mark the floor rectangle by clicking four corners, save the "
            "calibration, and exit."
        ),
    )
    parser.add_argument(
        "--rect-width",
        type=float,
        default=6.0,
        help=(
            "Width in metres of the floor rectangle marked during "
            "calibration (default: 6.0, the room width)"
        ),
    )
    parser.add_argument(
        "--rect-depth",
        type=float,
        default=4.6,
        help=(
            "Depth in metres of the floor rectangle marked during "
            "calibration (default: 4.6, the room depth)"
        ),
    )
    parser.add_argument(
        "--rect-center-x",
        type=float,
        default=0.0,
        help="X offset in metres of the rectangle's centre (default: 0)",
    )
    parser.add_argument(
        "--rect-center-z",
        type=float,
        default=0.0,
        help="Z offset in metres of the rectangle's centre (default: 0)",
    )
    return parser.parse_args()


def resolve_source(arguments):
    """Return whatever cv2.VideoCapture should be handed."""
    if arguments.source is None:
        return arguments.camera_index

    text = arguments.source.strip()
    if text.isdigit():
        return int(text)
    return text


def describe_source(source):
    if isinstance(source, int):
        return "device index " + str(source)
    return source


def calibration_path(camera_id):
    here = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(here, "calibration_" + camera_id + ".json")


def macos_camera_names():
    """Camera names macOS knows about, in the order it reports them.

    OpenCV has no cross-platform way to name a capture device, which makes
    finding the iPhone a guessing game. On macOS the system can be asked.
    Continuity Camera shows up here as "<name>'s iPhone" once the phone is
    locked, stationary and on the same Apple ID.
    """
    if platform.system() != "Darwin":
        return []

    try:
        output = subprocess.run(
            ["system_profiler", "-json", "SPCameraDataType"],
            capture_output=True,
            timeout=12,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return []

    if output.returncode != 0:
        return []

    try:
        parsed = json.loads(output.stdout.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return []

    names = []
    for entry in parsed.get("SPCameraDataType", []):
        name = entry.get("_name")
        if name:
            names.append(name)
    return names





def list_cameras():
    """Print which indices open, with names where the platform provides them."""
    print("Probing camera indices...")
    print("")

    names = macos_camera_names()
    if len(names) > 0:
        print("Cameras macOS reports:")
        index = 0
        while index < len(names):
            print("  - " + names[index])
            index = index + 1
        print("")
        print("NOTE: this order does NOT reliably match the OpenCV indices")
        print("below. Use the saved thumbnails to identify each camera.")
        print("")

    here = os.path.dirname(os.path.abspath(__file__))

    opened = []
    misses = 0
    index = 0
    while index < MAX_PROBE_INDEX:
        # OpenCV prints "out device of bound" to stderr for every index past
        # the last real camera, which buries the useful output. Once a few in
        # a row have failed there is nothing further up to find.
        if misses >= 3:
            break

        capture = cv2.VideoCapture(index)
        if not capture.isOpened():
            misses = misses + 1
        if capture.isOpened():
            misses = 0
            # The first frame off a camera is often black while it wakes up,
            # so take a few and keep the last.
            frame = None
            attempt = 0
            while attempt < 5:
                was_read, candidate = capture.read()
                if was_read and candidate is not None:
                    frame = candidate
                attempt = attempt + 1

            if frame is not None:
                size = str(frame.shape[1]) + "x" + str(frame.shape[0])
                opened.append(index)

                # The order macOS lists cameras in is NOT the order OpenCV
                # indexes them, so naming them by position is guesswork.
                # Save a picture from each instead and let the eye decide.
                thumbnail_path = os.path.join(
                    here, "camera-index-" + str(index) + ".jpg"
                )
                cv2.imwrite(thumbnail_path, frame)
                print(
                    "  index "
                    + str(index)
                    + ": opened, "
                    + size
                    + "  ->  "
                    + thumbnail_path
                )
            else:
                print("  index " + str(index) + ": opened but returned no frame")
        capture.release()
        index = index + 1

    print("")
    if len(opened) > 0:
        print("Open the camera-index-*.jpg files above to see which is which.")
        print("")

    if len(opened) == 0:
        print("No cameras opened.")
        if platform.system() == "Darwin":
            print("")
            print("On macOS the camera permission prompt is for your TERMINAL")
            print("app, not for Python. If you are on SSH or have no GUI")
            print("session, it fails silently - run this from a real terminal")
            print("window and approve the prompt.")
        return 1

    labels = []
    for value in opened:
        labels.append(str(value))
    print("Usable indices: " + ", ".join(labels))
    print("Re-run with --camera-index <one of those>.")
    return 0


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


def open_camera(source):
    capture = cv2.VideoCapture(source)
    if capture.isOpened():
        return capture

    capture.release()

    print("Could not open " + describe_source(source) + ".")

    if not isinstance(source, int):
        print("Check that the phone's camera app is streaming and that the")
        print("laptop can reach it - try opening the URL in a browser first.")
        return None

    available = probe_available_indices(source)
    if len(available) == 0:
        print("No other camera indices opened either.")
    else:
        names = []
        for index in available:
            names.append(str(index))
        print("These indices did open: " + ", ".join(names))
        print("Re-run with --camera-index <one of those>.")
    return None


def world_rectangle(arguments):
    """The four floor corners in room coordinates, in CORNER_PROMPTS order.

    Room coordinates match frontend/src/roomLayout.js: x runs across the
    width, z across the depth, and the room is centred on the origin. Near
    (larger z) is the open side the camera looks in from.
    """
    half_width = arguments.rect_width / 2.0
    half_depth = arguments.rect_depth / 2.0
    center_x = arguments.rect_center_x
    center_z = arguments.rect_center_z

    return [
        [center_x - half_width, center_z + half_depth],
        [center_x + half_width, center_z + half_depth],
        [center_x + half_width, center_z - half_depth],
        [center_x - half_width, center_z - half_depth],
    ]


def run_calibration(capture, arguments):
    """Click the four floor corners once; the camera must not move after."""
    print("")
    print("Calibration")
    print("-----------")
    print(
        "Click the four corners of a "
        + str(arguments.rect_width)
        + "m x "
        + str(arguments.rect_depth)
        + "m rectangle on the FLOOR, in this order:"
    )
    index = 0
    while index < len(CORNER_PROMPTS):
        print("  " + str(index + 1) + ". " + CORNER_PROMPTS[index])
        index = index + 1
    print("")
    print("'near' is the edge closest to this camera.")
    print("Press u to undo the last point, r to reset, q to abort.")
    print("")

    was_read, frame = capture.read()
    if not was_read:
        print("Could not read a frame from the camera.")
        return False

    clicked_points = []

    def on_mouse(event, x, y, flags, userdata):
        if event == cv2.EVENT_LBUTTONDOWN:
            if len(clicked_points) < 4:
                clicked_points.append([float(x), float(y)])

    window_name = "EchoTwin calibration - " + arguments.camera_id
    cv2.namedWindow(window_name)
    cv2.setMouseCallback(window_name, on_mouse)

    while True:
        # Keep pulling frames so the preview stays live while aiming.
        was_read, new_frame = capture.read()
        if was_read:
            frame = new_frame

        preview = frame.copy()

        point_index = 0
        while point_index < len(clicked_points):
            point = clicked_points[point_index]
            center = (int(point[0]), int(point[1]))
            cv2.circle(preview, center, 6, (0, 210, 190), -1)
            cv2.putText(
                preview,
                str(point_index + 1),
                (center[0] + 9, center[1] - 9),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.6,
                (0, 210, 190),
                2,
            )
            if point_index > 0:
                previous = clicked_points[point_index - 1]
                cv2.line(
                    preview,
                    (int(previous[0]), int(previous[1])),
                    center,
                    (0, 210, 190),
                    2,
                )
            point_index = point_index + 1

        if len(clicked_points) == 4:
            first = clicked_points[0]
            last = clicked_points[3]
            cv2.line(
                preview,
                (int(last[0]), int(last[1])),
                (int(first[0]), int(first[1])),
                (0, 210, 190),
                2,
            )
            message = "4/4 - press ENTER to save, u to undo, q to abort"
        else:
            message = (
                str(len(clicked_points))
                + "/4 - click the "
                + CORNER_PROMPTS[len(clicked_points)]
                + " corner"
            )

        cv2.putText(
            preview,
            message,
            (14, 30),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.7,
            (255, 255, 255),
            2,
        )

        cv2.imshow(window_name, preview)
        key = cv2.waitKey(30) & 0xFF

        if key == ord("q"):
            cv2.destroyWindow(window_name)
            print("Calibration aborted.")
            return False
        if key == ord("u"):
            if len(clicked_points) > 0:
                clicked_points.pop()
        if key == ord("r"):
            clicked_points = []
        if key in (13, 10) and len(clicked_points) == 4:
            break

    cv2.destroyWindow(window_name)

    world_points = world_rectangle(arguments)
    calibration = {
        "camera_id": arguments.camera_id,
        "room_id": arguments.room_id,
        "image_points": clicked_points,
        "world_points": world_points,
        "created": datetime.now(timezone.utc).isoformat(),
    }

    path = calibration_path(arguments.camera_id)
    handle = open(path, "w")
    json.dump(calibration, handle, indent=2)
    handle.close()

    print("Saved " + path)
    print("Do not move the camera after this, or run --calibrate again.")
    return True


def load_homography(camera_id):
    """Return the image -> floor transform, or None when uncalibrated."""
    path = calibration_path(camera_id)
    if not os.path.exists(path):
        return None

    try:
        handle = open(path, "r")
        calibration = json.load(handle)
        handle.close()
    except (ValueError, OSError) as error:
        print("Ignoring unreadable calibration: " + str(error))
        return None

    image_points = calibration.get("image_points")
    world_points = calibration.get("world_points")
    if not image_points or not world_points:
        return None
    if len(image_points) != 4 or len(world_points) != 4:
        return None

    source = np.array(image_points, dtype=np.float32)
    target = np.array(world_points, dtype=np.float32)
    return cv2.getPerspectiveTransform(source, target)


def floor_position(homography, foot_x, foot_y):
    """Map a point in the image to (x, z) metres on the floor."""
    point = np.array([[[float(foot_x), float(foot_y)]]], dtype=np.float32)
    mapped = cv2.perspectiveTransform(point, homography)
    return float(mapped[0][0][0]), float(mapped[0][0][1])


def detect_people(model, frame, confidence_floor, homography):
    """One inference pass.

    Returns (count, mean_confidence_or_None, people, detections). `people`
    holds a floor position per detection once the camera is calibrated;
    `detections` holds the pixel boxes, which are needed to draw the preview
    whether or not there is a calibration.
    """
    results = model.predict(
        frame,
        classes=[PERSON_CLASS],
        conf=confidence_floor,
        verbose=False,
    )

    count = 0
    confidence_total = 0.0
    people = []
    detections = []

    for result in results:
        boxes = result.boxes
        if boxes is None:
            continue
        index = 0
        while index < len(boxes):
            score = float(boxes.conf[index])
            count = count + 1
            confidence_total = confidence_total + score

            corners = boxes.xyxy[index]
            left = float(corners[0])
            top = float(corners[1])
            right = float(corners[2])
            bottom = float(corners[3])

            world_x = None
            world_z = None

            if homography is not None:
                # Feet, not centre: the bottom edge of the box is where the
                # person meets the floor, which is the only point a
                # floor homography can place correctly.
                foot_x = (left + right) / 2.0
                foot_y = bottom

                world_x, world_z = floor_position(homography, foot_x, foot_y)
                people.append(
                    {
                        "x": round(world_x, 2),
                        "z": round(world_z, 2),
                        "conf": round(score, 3),
                        "height_px": round(bottom - top, 1),
                    }
                )

            detections.append(
                {
                    "left": left,
                    "top": top,
                    "right": right,
                    "bottom": bottom,
                    "conf": score,
                    "x": world_x,
                    "z": world_z,
                }
            )

            index = index + 1

    if count == 0:
        return 0, None, people, detections

    mean_confidence = confidence_total / count
    return count, round(mean_confidence, 3), people, detections


def build_preview(frame, detections, camera_id, width, quality):
    """The inference frame with its boxes drawn, JPEG encoded.

    This is deliberately the frame the model actually ran on rather than a
    fresh grab, so what the dashboard shows is what produced the numbers
    beside it.
    """
    if width <= 0:
        return None

    annotated = frame.copy()

    index = 0
    while index < len(detections):
        detection = detections[index]
        left = int(detection["left"])
        top = int(detection["top"])
        right = int(detection["right"])
        bottom = int(detection["bottom"])

        cv2.rectangle(annotated, (left, top), (right, bottom), BOX_COLOR, 2)

        label = str(int(round(detection["conf"] * 100))) + "%"
        if detection["x"] is not None:
            label = (
                label
                + "  x="
                + str(round(detection["x"], 1))
                + " z="
                + str(round(detection["z"], 1))
            )

        text_top = max(top - 8, 14)
        cv2.putText(
            annotated,
            label,
            (left, text_top),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.5,
            BOX_TEXT_COLOR,
            1,
            cv2.LINE_AA,
        )

        # Mark the point actually used for positioning, so a bad calibration
        # is obvious from the preview rather than only from the 3D view.
        foot_x = int((left + right) / 2)
        cv2.circle(annotated, (foot_x, bottom), 4, BOX_COLOR, -1)

        index = index + 1

    height, original_width = annotated.shape[:2]
    if original_width > width:
        scale = float(width) / float(original_width)
        annotated = cv2.resize(
            annotated, (width, int(round(height * scale)))
        )

    cv2.putText(
        annotated,
        camera_id + "  " + str(len(detections)) + " person(s)",
        (10, 22),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.6,
        BOX_TEXT_COLOR,
        2,
        cv2.LINE_AA,
    )

    safe_quality = min(max(quality, 1), 100)
    was_encoded, buffer = cv2.imencode(
        ".jpg", annotated, [int(cv2.IMWRITE_JPEG_QUALITY), safe_quality]
    )
    if not was_encoded:
        return None
    return buffer.tobytes()


def post_event(session, backend_url, payload):
    """POST one CV event. Returns the status code, or None on failure."""
    url = backend_url.rstrip("/") + "/cv"
    try:
        response = session.post(url, json=payload, timeout=POST_TIMEOUT_SECONDS)
        return response.status_code
    except requests.RequestException as error:
        print("POST failed: " + str(error))
        return None


class PositionsHandler(BaseHTTPRequestHandler):
    """Serves the latest floor positions to the dashboard.

    The backend's /cv schema is fixed and has no room for per-person
    positions, and that file belongs to another branch, so the positions are
    served straight from here and proxied by the Vite dev server instead.
    """

    def do_GET(self):
        if self.path.startswith("/frame.jpg"):
            self.serve_frame()
            return

        if not self.path.startswith("/positions"):
            self.send_response(404)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"detail":"not found"}')
            return

        state_lock.acquire()
        try:
            payload = json.dumps(latest_state).encode("utf-8")
        finally:
            state_lock.release()

        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        # Handy when opening the endpoint directly while debugging; the
        # dashboard itself reaches this through the Vite proxy.
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)

    def serve_frame(self):
        preview_lock.acquire()
        try:
            jpeg = latest_preview["jpeg"]
            timestamp = latest_preview["timestamp"]
        finally:
            preview_lock.release()

        if jpeg is None:
            # 503 rather than 404: the endpoint exists, there is just no
            # frame yet (or the preview was turned off).
            self.send_response(503)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(b'{"detail":"no frame yet"}')
            return

        self.send_response(200)
        self.send_header("Content-Type", "image/jpeg")
        self.send_header("Content-Length", str(len(jpeg)))
        self.send_header("Access-Control-Allow-Origin", "*")
        # Every request must get the current frame, never a cached one.
        self.send_header("Cache-Control", "no-store")
        if timestamp is not None:
            self.send_header("X-Frame-Timestamp", timestamp)
        self.end_headers()
        self.wfile.write(jpeg)

    def log_message(self, format_string, *args):
        # One line per POST is useful; one line per poll is noise.
        return


def start_positions_server(port):
    try:
        server = ThreadingHTTPServer(("0.0.0.0", port), PositionsHandler)
    except OSError as error:
        print("Could not serve positions on port " + str(port) + ": " + str(error))
        print("The dashboard will still get occupancy counts via the backend.")
        return None

    thread = threading.Thread(target=server.serve_forever)
    thread.daemon = True
    thread.start()
    return server


def main():
    arguments = parse_arguments()

    if ROOM_ID_PATTERN.match(arguments.room_id) is None:
        print(
            "Invalid --room-id '"
            + arguments.room_id
            + "'. It must be lowercase snake_case, e.g. corridor_a."
        )
        return 1

    if arguments.list_cameras:
        return list_cameras()

    source = resolve_source(arguments)

    if arguments.calibrate:
        capture = open_camera(source)
        if capture is None:
            return 1
        try:
            was_saved = run_calibration(capture, arguments)
        finally:
            capture.release()
        if was_saved:
            return 0
        return 1

    print("Loading " + MODEL_NAME + " (first run downloads the weights)...")
    model = YOLO(MODEL_NAME)

    capture = open_camera(source)
    if capture is None:
        return 1

    homography = load_homography(arguments.camera_id)
    if homography is None:
        print(
            "No calibration for "
            + arguments.camera_id
            + " - posting counts only, no floor positions."
        )
        print("Run with --calibrate to place people in the 3D room.")
    else:
        print("Calibration loaded; reporting floor positions.")

    state_lock.acquire()
    try:
        latest_state["camera_id"] = arguments.camera_id
        latest_state["room_id"] = arguments.room_id
        latest_state["calibrated"] = homography is not None
    finally:
        state_lock.release()

    server = start_positions_server(arguments.http_port)
    if server is not None:
        print(
            "Serving positions on http://0.0.0.0:"
            + str(arguments.http_port)
            + "/positions"
        )
        if arguments.preview_width > 0:
            print(
                "Serving annotated frames on http://0.0.0.0:"
                + str(arguments.http_port)
                + "/frame.jpg"
            )

    print(
        "Camera "
        + describe_source(source)
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
                count, confidence, people, detections = detect_people(
                    model, frame, arguments.conf, homography
                )
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

            timestamp = datetime.now(timezone.utc).isoformat()

            state_lock.acquire()
            try:
                latest_state["timestamp"] = timestamp
                latest_state["occupancy"] = count
                latest_state["people"] = people
            finally:
                state_lock.release()

            if arguments.preview_width > 0:
                try:
                    jpeg = build_preview(
                        frame,
                        detections,
                        arguments.camera_id,
                        arguments.preview_width,
                        arguments.preview_quality,
                    )
                except Exception as error:
                    # Drawing the preview must never take the pipeline with
                    # it; the counts matter and the picture does not.
                    print("Preview failed: " + str(error))
                    jpeg = None

                if jpeg is not None:
                    preview_lock.acquire()
                    try:
                        latest_preview["jpeg"] = jpeg
                        latest_preview["timestamp"] = timestamp
                    finally:
                        preview_lock.release()

            payload = {
                "room_id": arguments.room_id,
                "camera_id": arguments.camera_id,
                "occupancy": count,
                "unusual_activity": is_unusual,
                "confidence": confidence,
                "timestamp": timestamp,
            }

            status_code = post_event(session, arguments.backend, payload)

            line = arguments.camera_id + ": " + str(count) + " person(s)"
            if confidence is not None:
                line = line + ", mean conf " + str(confidence)
            if len(people) > 0:
                first = people[0]
                line = (
                    line
                    + ", first at x="
                    + str(first["x"])
                    + " z="
                    + str(first["z"])
                )
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
        if server is not None:
            server.shutdown()


if __name__ == "__main__":
    sys.exit(main())
