# EchoTwin

Live 3D digital twin fusing CV camera feeds and IoT sensor data into one
dashboard. Built for the Inferentia hackathon (PES University) by Team Star
Coders.

Full architecture, tech stack, sensor specs, and constraints are in
[`EchoTwin_Master_Agent_Context.md`](EchoTwin_Master_Agent_Context.md).
The MQTT and WebSocket message shapes are fixed contracts — see
[`schemas/mqtt_and_ws.md`](schemas/mqtt_and_ws.md) before touching any
component that sends or receives them.

`main` is the shared demo baseline. Phone proximity/AR identification is
experimental and belongs on `main-testing` on the device used to test it.
Camera calibration and physical marker alignment remain final setup steps.

For first setup only, copy `.env.example` to `.env` and fill in real values.
Preserve existing working configuration; Tailscale addresses can change.

```bash
cp .env.example .env
```

## Quick start (backend Mac + one camera laptop, the common case)

```bash
# From the repo root on the backend Mac:
docker compose --env-file .env -f backend/docker-compose.yml up -d --build
# On the frontend/demo laptop, in a separate terminal:
cd frontend && npm ci && npm run dev
```

Open `http://localhost:5173`. That's the whole loop: sensors publish over
MQTT (or run the mock publisher below if no ESP32 yet), the backend fuses
sensor + camera data into room status, and the dashboard polls it. If a
piece isn't running, the dashboard reports its unavailable state. To use
synthetic backup data, explicitly set `VITE_DEMO=1` in `frontend/.env` and
restart Vite. It does not switch silently from real data to demo data.

## backend/ (owner: Aditya)

FastAPI + Docker Compose stack: Postgres/TimescaleDB, Mosquitto (MQTT),
and the FastAPI app.

Install: [Docker](https://docs.docker.com/get-docker/) and Docker Compose.

```bash
docker compose --env-file .env -f backend/docker-compose.yml up -d --build
```

Brings up all three services. FastAPI is on `http://localhost:8000`
(`/health` for a liveness check), the WebSocket endpoint is
`ws://localhost:8000/ws/room-status`, Postgres on `5432`, MQTT on `1883`.
The database schema and TimescaleDB hypertables are created automatically.

Sensor nodes publish to `echotwin/sensors/<node_id>`. The backend maps the
node ID to a room, stores the reading, fuses it with the latest CV occupancy,
scores anomalies and trends, then broadcasts the fixed WebSocket shape from
`schemas/mqtt_and_ws.md`.

Useful REST endpoints are `/sensor-readings`, `/cv`, `/cv-events`,
`/room-status`, `/room-status/<room_id>`, and
`/room-status/<room_id>/ai-advice`. Historical chart data is available from
`/history/rooms`, `/history/sensors`, and `/history/cv-events`; see
[`backend/HISTORY_API.md`](backend/HISTORY_API.md) for the frontend contract.

Docker loads the **root `.env`**; `backend/.env` applies only to direct Python
runs from that folder. Set `TAILSCALE_OLLAMA_URL`, `OLLAMA_MODEL=qwen3:8b`,
and `OLLAMA_TIMEOUT_SECONDS=20` there for the home PC. AskTwin forwards the
typed question; the backend disables thinking and falls back to labelled
rules if the model times out or returns an empty answer.

No real ESP32 yet? Run the mock publisher against the broker instead.
Do not run it alongside the real bridge: both publish as `node_1`.

```bash
cd backend
pip install -r mocks/requirements.txt
python mocks/mock_mqtt_publisher.py
```

## frontend/ (owner: Adyanth)

React + Three.js dashboard — a real 3D scan of the room, live sensor tiles,
camera views with detection boxes, an LLM chat panel grounded in current
readings, notifications, and a QR-code mobile/AR view. Full detail (env
vars, the LLM path, calibration, everything) is in
[`frontend/README.md`](frontend/README.md); this is just the short version.

Install: [Node.js](https://nodejs.org/) 18+.

```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

Opens at `http://localhost:5173`. `predev` also runs `cv/run_cameras.sh`
automatically — if `cv/.venv` exists it starts both camera producers in
their own Terminal windows on macOS. Windows/Linux skip this Mac launcher.
On a Mac with remote cameras, use `ECHOTWIN_START_CAMERAS=0 npm run dev`
to leave capture to the camera laptop. By default the
dashboard talks to the real backend over Tailscale (`VITE_BACKEND_HOST`);
set `VITE_DEMO=1` to force synthetic data instead.

## cv/ (owner: Adyanth)

YOLOv8n occupancy producer — one process per camera, counts people, posts
to the backend's `POST /cv`, and (once calibrated) reports each person's
floor position so the dashboard can place them inside the 3D room. Full
detail in [`cv/README.md`](cv/README.md).

```bash
cd cv
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
./run_cameras.sh          # starts cam1 + cam2 in separate Terminal windows
./stop_cameras.sh         # stops them
```

`run_cameras.sh` defaults to camera indices 0 and 1; it does not remember devices
(`python3 producer.py --list-cameras` to check/re-check — indices shift
when a phone reconnects). Override with `CAM1_INDEX=n CAM2_INDEX=n`.
Continuity Camera specifically needs the iPhone **locked, stationary, and
mounted in landscape** — it silently stops acting like a fixed camera the
moment someone picks the phone up.

## esp32-firmware/ (owner: Akshay)

Arduino/PlatformIO firmware with a first-boot I2C scanner and the complete
sensor-to-MQTT node. See
[`esp32-firmware/README.md`](esp32-firmware/README.md) for required libraries,
wiring, configuration, and the venue test sequence.

## ml/

Isolation Forest anomaly detection with a reproducible synthetic baseline for
the demo. See [`ml/README.md`](ml/README.md) for retraining details. The score
is an anomaly deviation score, not a classification accuracy.

## schemas/

No install needed — [`schemas/mqtt_and_ws.md`](schemas/mqtt_and_ws.md) is
documentation, the fixed contract every other folder implements against.

## Network

The current shared Tailscale test addresses (see `.env.example` for the
live copy):

| Role | Machine | Tailscale IP |
|---|---|---|
| Backend | `sanjays-macbook-air` | `100.93.145.13` |
| Frontend + cameras | `adyanths-macbook-air` | `100.117.169.11` |
| Firmware development | `akshay-lenovo` | `100.105.226.40` |

The frontend connects to the backend at `100.93.145.13:8000` (REST,
proxied under `/api`, and WebSocket under `/ws`). A physical ESP32 does not
run Tailscale, so its firmware must instead use the backend Mac's
Wi-Fi/hotspot LAN address.

## Branches

- `main` — verified demo baseline; only tested fixes go here
- `main-testing` — AR/proximity experimentation on the relevant device
- `akshay-esp32` — firmware work
- `aditya-backend` — backend work
- `adyanth-frontend` — frontend work

To get the stable demo, run `git switch main` then `git pull --ff-only origin main`.
To experiment, first save/commit your work, then:

```bash
git fetch origin
git switch main-testing
git pull --ff-only origin main-testing
```

Coordinate pushes to the shared testing branch. For simultaneous work, create
`main-testing-frontend`, `main-testing-backend`, or `main-testing-firmware`
from it. Do not merge experiments into main during the demo. These are team
instructions; no GitHub branch-protection settings are changed.

## Pre-demo check and rehearsal

From the repository root, with all producers running:

```bash
python3 scripts/check-demo.py --require-cameras --check-ai
# On the demo laptop, add its Vite URL and the backend address:
python3 scripts/check-demo.py --backend http://100.93.145.13:8000 --frontend http://localhost:5173 --require-cameras
```

The script only reads data. It checks all eight sensor channels, camera-event
freshness, history, database health, and optional frontend/AI paths. Use the
actual Vite port if it starts on 5174 instead of 5173.

Rehearse: Mesh/Gaussian switch and zoom → real sensor stimulus → camera boxes
and counts → calibrated people in 3D → history charts → AskTwin. Record a
short working demo as backup. Use `VITE_DEMO=1` for a labelled, repeatable
72-second alert/recovery sequence; AskTwin provides scripted guidance in this
mode without calling the backend. Camera previews still require live producers.

PostgreSQL persists in the Compose volume `backend_postgres_data` with the
default project name. Sensor/CV tables have 30-day chunk-retention policies;
room status stores the latest state. Do not use `docker compose down -v`:
that removes the database volume. USB captures stay on the firmware laptop.

Demo interpretation: occupancy is the latest camera count, not a sum or
deduplicated room total. 3D people use a separate calibrated-position path.
The anomaly model has a synthetic training baseline; linear extrapolation
is a trend estimate, not a validated failure forecast. Markers have configured
positions. Stored sensor values can outlive their source, so use actual reading
timestamps (the readiness check) to confirm freshness.
