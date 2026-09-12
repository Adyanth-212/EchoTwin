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
values (`SERVER_IP` is Laptop 3's fixed IP on the venue hotspot).

```bash
cp .env.example .env
```

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

## frontend/ (owner: you)

React + Three.js dashboard.

Install: [Node.js](https://nodejs.org/) 18+.

```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

Opens at `http://localhost:5173`. By default it points at the mock
WebSocket sender (`VITE_WS_URL` in `frontend/.env`) so you can work
without the real backend running:

```bash
cd backend
pip install -r mocks/requirements.txt
python mocks/mock_ws_sender.py
```

The current shared Tailscale test addresses are:

| Role | Machine | Tailscale IP |
|---|---|---|
| Backend | `sanjays-macbook-air` | `100.93.145.13` |
| Frontend | `adyanths-macbook-air` | `100.117.169.11` |
| Firmware development | `akshay-lenovo` | `100.105.226.40` |

The frontend connects to
`ws://100.93.145.13:8000/ws/room-status`. Laptop-based MQTT publishers also
connect to `100.93.145.13:1883`. A physical ESP32 does not run Tailscale, so
its firmware must instead use the backend Mac's Wi-Fi/hotspot LAN address.

## esp32-firmware/ (owner: Akshay)

Not written yet — see [`esp32-firmware/README.md`](esp32-firmware/README.md)
for the sensor list, pinout, and I2C addresses. Will be an
Arduino/PlatformIO project; install
[PlatformIO](https://platformio.org/install) when firmware work starts.

## ml/

Isolation Forest anomaly detection with a reproducible synthetic baseline for
the demo. See [`ml/README.md`](ml/README.md) for retraining details. The score
is an anomaly deviation score, not a classification accuracy.

## schemas/

No install needed — [`schemas/mqtt_and_ws.md`](schemas/mqtt_and_ws.md) is
documentation, the fixed contract every other folder implements against.

## Branches

- `main` — shared scaffolding, kept in sync
- `akshay-esp32` — firmware work
- `aditya-backend` — backend work
- `adyanth-frontend` — frontend work
