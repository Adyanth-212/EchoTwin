# cv/ — computer-vision occupancy producer

Counts people in a camera feed with YOLOv8n and posts the count to the
backend's `POST /cv` endpoint. One process per camera: Laptop 1 runs `cam1`,
Laptop 2 runs `cam2`. The backend folds those counts into the room's fused
status, so this is what makes `occupancy_count` appear anywhere in the
dashboard.

## Install

```bash
cd cv
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Download the model weights before the demo

The first run downloads `yolov8n.pt` (about 6 MB) from the internet. On the
venue hotspot that may be slow or may not work at all. **Do it at home, on a
good connection, on both laptops.**

```bash
python3 -c "from ultralytics import YOLO; YOLO('yolov8n.pt')"
```

The file lands in the working directory, so run that from `cv/` — the same
directory you will run the producer from.

## Camera sources

The camera is either an **OpenCV device index** or a **URL** — both go
straight to `cv2.VideoCapture`.

| Setup | Flag |
|---|---|
| **iPhone via Continuity Camera** (macOS) | `--camera-index <n>` |
| Phone over USB via Iriun | `--camera-index 2` |
| Laptop webcam | `--camera-index 0` |
| Android phone running **IP Webcam** | `--source http://192.168.1.31:8080/video` |
| Anything streaming RTSP | `--source rtsp://192.168.1.31:8554/live` |

Find out which index is which:

```bash
python3 producer.py --list-cameras
```

That probes every index, reports the resolution each one returns, and on
macOS also lists the camera names the system knows about — which is how you
spot the iPhone. OpenCV has no cross-platform way to name a device, so
without this it is guesswork.

### iPhone via Continuity Camera (no app needed)

The best-quality option if any camera laptop is a Mac. macOS presents the
iPhone as an ordinary capture device, so the producer needs no changes — just
the right index.

Requirements: macOS 13+, iPhone XR or later on iOS 16+, the **same Apple ID
with two-factor on both**, Wi-Fi and Bluetooth on, and the phone **locked,
stationary, and mounted in landscape with the rear camera facing out**. It
will not engage while the phone is unlocked in your hand. Only one Mac can
claim a given iPhone at a time.

Two things that will waste your time if you do not know them:

- **The camera permission prompt is for your terminal app, not for Python.**
  Run the producer from a real terminal window and approve it. Over SSH, or
  without a GUI session, opening the camera fails silently.
- **The index is not stable.** Continuity Camera appears and disappears as
  the phone connects, which shifts the other indices. Re-run
  `--list-cameras` if a previously working index stops opening.

AirPlay is not a capture source, and QuickTime's "New Movie Recording" claims
the device exclusively — OpenCV cannot open a camera QuickTime is holding, so
close it.

### Phones over the network

For phones mounted as fixed CCTV cameras on a non-Mac laptop, use the URL
form. Open the URL in a browser on the laptop first — if it does not play
there, OpenCV will not open it either.

Android has the easiest path: **IP Webcam**, free, streams MJPEG over HTTP.
On iPhone, if Continuity Camera is not an option, you need an app that
exposes RTSP or MJPEG — Larix Broadcaster or IP Camera Lite — or plug it in
and use Iriun as a normal device index.

## Run

**Both cameras on one laptop (this machine's current setup):**

```bash
./run_cameras.sh
```

Opens two Terminal windows, one producer each, using the last-known-good
camera indices. Stop both with `./stop_cameras.sh`. If a camera got
unplugged or a phone reconnected, indices can shift — run
`python3 producer.py --list-cameras` first and override, e.g.
`CAM1_INDEX=2 ./run_cameras.sh`.

**Manually, or on separate laptops:**

Laptop 1:

```bash
python3 producer.py --camera-id cam1 --source http://192.168.1.31:8080/video
```

Laptop 2, second camera, second positions port:

```bash
python3 producer.py --camera-id cam2 --source http://192.168.1.32:8080/video --http-port 8011
```

Against a backend somewhere else:

```bash
python3 producer.py --camera-id cam1 --backend http://192.168.1.42:8000
```

Output is one line per POST:

```
cam1: 3 person(s), mean conf 0.72 -> HTTP 200
cam1: 4 person(s), mean conf 0.68, UNUSUAL -> HTTP 200
```

## Calibration — putting people in the 3D room

Without this the producer posts occupancy counts and nothing else. With it,
every detection also gets a floor position, and the dashboard draws each
person standing where they actually are inside the 3D room.

It works by mapping the image to the floor plane with a homography, which is
only valid **while the camera does not move**. That is exactly right for a
mounted CCTV phone, and exactly wrong for a handheld one. Re-run calibration
if a camera gets knocked.

```bash
python3 producer.py --camera-id cam1 --source http://192.168.1.31:8080/video --calibrate
```

A window opens on the live feed. Click the four corners of a floor rectangle
in this order — *near* means the edge closest to **that camera**:

1. near-left
2. near-right
3. far-right
4. far-left

Press <kbd>Enter</kbd> to save, `u` to undo a point, `r` to reset, `q` to
abort. It writes `calibration_<camera_id>.json` next to the script, which the
producer picks up automatically on its next start.

By default the rectangle is assumed to be the whole room floor, 6 × 4.6 m,
matching `ROOM` in `frontend/src/roomLayout.js`. **All four corners have to be
visible in the frame.** If a camera cannot see the whole floor, mark a smaller
rectangle you can measure — tape one out, or use floor tiles — and pass its
size and where its centre sits relative to the room centre:

```bash
python3 producer.py --camera-id cam1 --calibrate \
  --rect-width 2.0 --rect-depth 1.5 --rect-center-x 1.0 --rect-center-z -0.5
```

Both cameras must be calibrated against the **same** room frame, or the two
views will disagree about where people are. The dashboard merges detections
within 0.7 m of each other, so a person both cameras can see appears once.

Accuracy comes from how carefully the corners are clicked and how flat the
floor is. Expect a few tens of centimetres, which is fine for "someone is
standing near the AC unit" and not fine for anything measured.

### Serving positions

Each producer serves its latest positions on `--http-port` (default 8010; use
8011 for the second camera) at `GET /positions`:

```json
{
  "camera_id": "cam1",
  "room_id": "corridor_a",
  "timestamp": "2026-09-12T21:30:00+00:00",
  "occupancy": 2,
  "calibrated": true,
  "people": [{ "x": 1.2, "z": -0.4, "conf": 0.82, "height_px": 310.0 }]
}
```

`x` and `z` are metres in the same frame as `frontend/src/roomLayout.js`.

This does not go through the backend: the `/cv` schema is fixed and has no
field for positions. The dashboard reads it through the Vite proxy — set
`VITE_CAM1_HOST` / `VITE_CAM2_HOST` in `frontend/.env` to point at the camera
laptops.

## Seeing what the camera sees

The producer serves the frame it **actually ran inference on**, with the
detection boxes drawn, at `GET /frame.jpg` on the same port as the positions:

```
http://<camera laptop>:8010/frame.jpg
```

The dashboard shows both cameras in a "Camera views" panel. Each box is
labelled with its confidence and, once calibrated, the floor coordinates that
detection produced, plus a dot on the point used for positioning — so a bad
calibration is visible in the picture rather than only as figures standing in
the wrong place in the 3D room.

This is the frame the model saw, not a fresh grab, so the boxes always match
the numbers beside them.

Frames are polled by the dashboard at 2 fps and scaled to `--preview-width`
(default 640) at `--preview-quality` (default 70). On a phone hotspot that is
roughly 20 KB/s per camera. `--preview-width 0` turns the preview off
entirely if the network is struggling; counts and positions keep working.

Note that this puts a live view of identifiable people on a dashboard someone
may be screen-sharing — worth a thought about where the cameras point.

## The camera index

The camera is an ordinary OpenCV device index. Iriun Webcam over USB appears
as a normal index, but **the index changes when USB devices are replugged**,
which is why it is an argument rather than a constant. The default is 2.

If the requested index will not open, the producer probes the other indices,
prints the ones that did open, and exits:

```
Could not open camera index 2.
These indices did open: 0, 1
Re-run with --camera-index <one of those>.
```

## Arguments

| Argument | Default | Meaning |
|---|---|---|
| `--camera-index` | `2` | OpenCV device index |
| `--camera-id` | `cam1` | Identifier sent to the backend; must differ per laptop |
| `--room-id` | `corridor_a` | Room this camera watches; lowercase snake_case |
| `--backend` | `sanjays-macbook-air.tail22578a.ts.net:8000` | Backend base URL; use `http://100.93.145.13:8000` if MagicDNS will not resolve |
| `--interval` | `1.5` | Seconds between inference samples |
| `--conf` | `0.4` | Confidence floor for a detection to count |
| `--jump` | `3` | Occupancy change between samples that counts as unusual |
| `--source` | unset | Device index or URL; overrides `--camera-index` |
| `--http-port` | `8010` | Port to serve floor positions on |
| `--calibrate` | off | Mark the floor rectangle and exit |
| `--rect-width` | `6.0` | Width in metres of the calibration rectangle |
| `--rect-depth` | `4.6` | Depth in metres of the calibration rectangle |
| `--rect-center-x` | `0` | X offset of the rectangle's centre |
| `--rect-center-z` | `0` | Z offset of the rectangle's centre |
| `--list-cameras` | off | List indices that open, with names on macOS, then exit |
| `--preview-width` | `640` | Width of the annotated preview; `0` disables it |
| `--preview-quality` | `70` | JPEG quality of the preview, 1-100 |

## What it does and does not do

- YOLOv8n pretrained on COCO, restricted to `classes=[0]` (person). No
  training and no custom weights.
- Frames are read continuously so the capture buffer stays drained, but
  inference only runs once per `--interval`. Running it on every frame would
  saturate the laptop for no extra information.
- `unusual_activity` is deliberately simple: true when the count changes by
  more than `--jump` between consecutive samples. It feeds a backend rule
  that already exists, so a cleverer definition here would only make that
  rule harder to reason about.
- `confidence` is the mean confidence of the detections in that sample, or
  `null` when nothing was detected. It is not an accuracy figure for the
  model.
- A failed POST or a dropped frame logs and continues. Only a camera that
  stops returning frames entirely ends the run.

## Payload

Matches `backend/app/schemas/cv.py` exactly:

```json
{
  "room_id": "corridor_a",
  "camera_id": "cam1",
  "occupancy": 3,
  "unusual_activity": false,
  "confidence": 0.72,
  "timestamp": "2026-09-12T21:30:00+00:00"
}
```
