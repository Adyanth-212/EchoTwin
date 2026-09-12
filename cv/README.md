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

## Run

Laptop 1:

```bash
python3 producer.py --camera-id cam1 --camera-index 2
```

Laptop 2:

```bash
python3 producer.py --camera-id cam2 --camera-index 2
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
| `--backend` | the Tailscale hostname | Backend base URL |
| `--interval` | `1.5` | Seconds between inference samples |
| `--conf` | `0.4` | Confidence floor for a detection to count |
| `--jump` | `3` | Occupancy change between samples that counts as unusual |

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
