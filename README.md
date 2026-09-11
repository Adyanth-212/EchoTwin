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

No real ESP32 yet? Run the mock publisher against the broker instead:

```bash
cd backend
pip install -r mocks/requirements.txt
python mocks/mock_mqtt_publisher.py
```

## frontend/ (owner: Adaynth)

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

Swap `VITE_WS_URL` to `ws://<SERVER_IP>:8000/ws/room-status` once the real
backend is up.

## esp32-firmware/ (owner: Akshay)

Not written yet — see [`esp32-firmware/README.md`](esp32-firmware/README.md)
for the sensor list, pinout, and I2C addresses. Will be an
Arduino/PlatformIO project; install
[PlatformIO](https://platformio.org/install) when firmware work starts.

## ml/

Isolation Forest anomaly detection. Not implemented yet — see
[`ml/README.md`](ml/README.md).

Install (when work starts): Python 3.11+, `pip install scikit-learn
pandas`.

## schemas/

No install needed — [`schemas/mqtt_and_ws.md`](schemas/mqtt_and_ws.md) is
documentation, the fixed contract every other folder implements against.

## Branches

- `main` — shared scaffolding, kept in sync
- `akshay-esp32` — firmware work
- `aditya-backend` — backend work
- `adyanth-frontend` — frontend work
