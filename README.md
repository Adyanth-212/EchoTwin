# EchoTwin

Live 3D digital twin fusing CV camera feeds and IoT sensor data into one
dashboard. Built for the Inferentia hackathon (PES University) by Team Star
Coders.

Full architecture, tech stack, sensor specs, and constraints are in
[`EchoTwin_Master_Agent_Context.md`](EchoTwin_Master_Agent_Context.md).
The MQTT and WebSocket message shapes are fixed contracts — see
[`schemas/mqtt_and_ws.md`](schemas/mqtt_and_ws.md) before touching any
component that sends or receives them.

First step for everyone: copy `.env.example` to `.env` and fill in real
values (`SERVER_IP` is the backend Mac's fixed Tailscale IP).

```bash
cp .env.example .env
```

## Quick start (backend Mac + one camera laptop, the common case)

```bash
cd backend && docker compose up          # terminal 1
cd frontend && npm install && npm run dev  # terminal 2 — also starts both cameras
```

Open `http://localhost:5173`. That's the whole loop: sensors publish over
MQTT (or run the mock publisher below if no ESP32 yet), the backend fuses
sensor + camera data into room status, and the dashboard polls it. If a
piece isn't running, the dashboard falls back to `DEMO DATA` rather than
going blank — see `frontend/README.md`'s Demo mode section.

## backend/ (owner: Aditya)

FastAPI + Docker Compose stack: Postgres/TimescaleDB, Mosquitto (MQTT),
and the FastAPI app.

Install: [Docker](https://docs.docker.com/get-docker/) and Docker Compose.

```bash
cd backend
docker compose up
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

No real ESP32 yet? Run the mock publisher against the broker instead:

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
their own Terminal windows; if not, it's a silent no-op so this never
blocks a teammate whose laptop isn't set up for cameras. By default the
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

`run_cameras.sh` uses whatever camera indices worked last
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

- `main` — shared scaffolding, kept in sync
- `akshay-esp32` — firmware work
- `aditya-backend` — backend work
- `adyanth-frontend` — frontend work
