# EchoTwin

A hackathon digital-twin prototype that brings ESP32 sensor readings, camera-based occupancy, a scanned 3D environment, and maintenance incidents into one dashboard.

**Start here:** [Startup](#startup) · [3D scans](#3d-scans-and-markers) · [Maintenance](#maintenance-watcher-and-calls) · [Validation](#validation-and-tests) · [Troubleshooting](#troubleshooting) · [Limitations](#known-limitations)

This guide describes the website/backend on `main`, reviewed against commit `29c7f0d` on 14 September 2026. It is a prototype, not a certified safety or fault-diagnosis system. Do not use its thresholds or AI suggestions as equipment operating specifications.

## What is included

- Live sensor cards, WebSocket updates, status/anomaly timelines, and stored sensor/CV history.
- A 3D viewer for locally supplied textured GLB meshes or Gaussian-splat PLY scans.
- Two camera feeds with YOLO person detections; calibrated floor positions displayed in 3D.
- Deterministic warning/critical rules, a synthetic-baseline Isolation Forest, and linear trend estimates.
- Optional Qwen3/Ollama explanations with a rules fallback.
- A maintenance worker with persistent incidents, acknowledge/resolve controls, inspection suggestions, and optional Twilio calling.
- A phone-oriented browser view and optional camera-passthrough AR layer.

Automatic discovery/localization of individual sensors is not implemented. Scene markers are configured or manually placed, not recognized from wires or a scan. Captured 3D scans are supplied separately and are not bundled with this checkout.

## Architecture

```text
ESP32 sensors ── direct Wi-Fi MQTT OR USB → laptop bridge ──┐
                                                         ▼
                                                   Mosquitto :1883
                                                         │
                                                         ▼
Phone cameras → CV producers ── POST /cv ──→ FastAPI :8000 ↔ TimescaleDB
                    │                            │              │
                    │ frames + floor positions   │ REST + WS    │ history
                    └────────────────────────────┼──────────────┘
                                                 ▼
                                         React/Vite dashboard

TimescaleDB → maintenance worker → persistent incidents → dashboard
                                ├→ optional Ollama explanations
                                └→ dry-run record OR configured Twilio call
```

Video frames and calibrated person positions are served directly by the CV producers, through the frontend proxy. The backend stores camera metadata/counts, not video footage. One ESP32 (`node_1`) supplies multiple sensor channels for the room `corridor_a`.

## Repository map

| Path | Purpose |
| --- | --- |
| `backend/app/` | FastAPI, MQTT ingestion, fusion, rules, trend, history, maintenance |
| `backend/docker-compose.yml` | Database, broker, API, optional maintenance services |
| `backend/db/schema.sql` | Initial database setup; runtime startup also initializes schema |
| `backend/models/isolation_forest.joblib` | Committed anomaly-model artifact |
| `frontend/src/` | Dashboard, 3D viewers, browser mobile view, history/incident UI |
| `frontend/public/scans/` | Local, Git-ignored scan assets and their setup guide |
| `cv/` | Camera capture, person detection, calibration, frame/position server |
| `esp32-firmware/` | ESP32 firmware, PlatformIO configuration, serial tools/tests |
| `ml/` | Reproducible synthetic anomaly-model training script |
| `schemas/mqtt_and_ws.md` | Shared MQTT and WebSocket contracts |
| `scripts/check-demo.py` | Read-only connectivity/freshness/asset checks |
| `scripts/demo_trigger.py` | Explicitly simulated fault injection and web remote |

## Prerequisites and configuration

- Backend laptop: Docker Desktop/Engine running, with a recent Compose v2 supporting optional `env_file` entries and `--wait`.
- Frontend laptop: Node.js and npm; the audited build used Node 24. Use `npm ci` with the committed lockfile.
- Camera/serial laptops: Python 3.12 and separate virtual environments for each component. Keep the CV environment separate from backend dependencies.
- Firmware changes: PlatformIO, or the Arduino setup documented in the firmware guide. An already-flashed working board need not be reflashed to start the system.
- Devices must have a usable route to the relevant servers, through the LAN or Tailscale. A bare ESP32 cannot connect to a Tailscale-only address by itself.

Commands below start from the repository root unless a section explicitly changes directory. Shell examples use macOS/Linux; the serial bridge also includes a Windows example.

For a new clone:

```bash
git clone https://github.com/Adyanth-212/EchoTwin.git
cd EchoTwin
git switch main
```

For an existing clone, inspect `git status` first. Save/commit your changes before switching branches or running `git pull --ff-only origin main`. Do not force a checkout or overwrite working configuration during a demo.

Configuration locations:

| File | Used by | Important distinction |
| --- | --- | --- |
| Root `.env` | Docker Compose services | Backend credentials, broker/database, Ollama, maintenance |
| `frontend/.env.local` | Vite/frontend configuration | Hostnames/ports and UI flags; **never secrets** |
| `backend/.env` | Optional direct Python setup | Not the env file used by the documented Compose stack |
| Firmware source / device setup | Direct ESP32 Wi-Fi/MQTT | Network placeholders must be configured before direct MQTT works |
| `cv/calibration_cam1.json`, `cv/calibration_cam2.json` | Camera producers | Local, camera-pose-specific calibration; intentionally ignored |

Addresses in committed examples use the documentation-only `192.0.2.0/24` range; they do not identify live servers. Replace them with your own reachable LAN/Tailscale addresses in ignored `.env` files. Keep device-specific hostnames and addresses out of committed code/docs. `localhost` / `127.0.0.1` (this device) and `0.0.0.0` (listen on all interfaces) retain their functional meanings and are not secret deployment addresses. Tailscale user membership alone does not prove a device or application is reachable. Test the actual HTTP endpoint too.

## Startup

Order: **backend → sensor publisher and cameras → frontend → validation → optional maintenance worker**.

### 1. Backend laptop

Create the root config only if missing:

```bash
test -f .env || cp .env.example .env
```

Edit it locally. Set a private database password and check network addresses. Leave `MAINTENANCE_NOTIFICATION_MODE=dry_run` during setup. Never commit real `.env` files, Twilio tokens, or passwords.

Start the core services:

```bash
docker compose --env-file .env -f backend/docker-compose.yml up -d --build --wait postgres mosquitto fastapi
docker compose --env-file .env -f backend/docker-compose.yml ps
curl --fail http://localhost:8000/health
curl --fail http://localhost:8000/db-health
```

Expected: health is `ok`, database is `connected`. `/health` alone does not prove sensors or cameras are reporting. A room may not exist until its first accepted reading/event.

Keep the same Compose project name as your existing deployment. With this file location, the normal default is `backend`; its database volume is usually `backend_postgres_data`. Changing the project name can create a different empty volume and make history appear missing. Existing `COMPOSE_PROJECT_NAME` or `-p` settings take precedence.

### 2. Sensor/firmware laptop

Choose **one publishing path** for `node_1`. Do not run a mock, USB bridge, and direct firmware MQTT simultaneously under the same node ID.

**USB bridge — useful when the laptop uses Tailscale:** keep the working firmware, connect the ESP32 by USB, and close any Serial Monitor holding the port.

First setup on Windows, from `esp32-firmware/`:

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r tools\requirements.txt
.\.venv\Scripts\python.exe tools\serial_to_mqtt.py --port COM10 --baud 115200 --broker-host BACKEND_IP --broker-port 1883 --node-id node_1 --label live
```

Replace `COM10` and `BACKEND_IP`. On macOS/Linux, use the equivalent Python environment and serial path such as `/dev/cu.usbserial-...`.

**Direct Wi-Fi MQTT:** configure the Wi-Fi/broker placeholders in `esp32-firmware/sensor_node/sensor_node.ino`, use a broker LAN address reachable by the board, and ensure time synchronization works. Direct firmware MQTT sends about every **7.5 seconds**; USB serial reports about every **1 second**. Do not commit real Wi-Fi credentials.

See [firmware setup](esp32-firmware/README.md) and [sensor calibration](esp32-firmware/CALIBRATION.md) for wiring, libraries, flashing, and calibration.

### 3. Camera laptop

First setup:

```bash
cd cv
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python -c "from ultralytics import YOLO; YOLO('yolov8n.pt')"
python producer.py --list-cameras
```

Download YOLO weights before going offline. They are intentionally not committed. Approve camera access for the terminal/application on the camera laptop.

Run one process per camera, in separate terminals with this environment active:

```bash
# Replace 1 with the currently detected iPhone/Continuity Camera index.
python producer.py --camera-id cam1 --camera-index 1 --http-port 8010 --room-id corridor_a --backend http://BACKEND_IP:8000
```

```bash
# Replace PIXEL_LAN_IP with the address shown by the phone's streaming app.
python producer.py --camera-id cam2 --source http://PIXEL_LAN_IP:8080/video --http-port 8011 --room-id corridor_a --backend http://BACKEND_IP:8000
```

Camera indices can change after reconnecting a phone. The camera laptop must reach both the phone stream and backend. The frontend laptop must reach ports 8010/8011 on the camera laptop. Seeing frames does not prove `POST /cv` is reaching the backend—check both.

For 3D people placement, add `--calibrate` and follow [camera calibration](cv/README.md#calibration--putting-people-in-the-3d-room). Calibrate both views into the same measured floor coordinate frame. Recalibrate when a camera moves. Without calibration, counts/frames can work but positions will not be correct.

### 4. Frontend/demo laptop

From `frontend/`, create `frontend/.env.local` with your actual addresses:

```ini
VITE_BACKEND_HOST=BACKEND_IP:8000
VITE_ROOM_ID=corridor_a
VITE_CAM1_HOST=CAMERA_LAPTOP_IP:8010
VITE_CAM2_HOST=CAMERA_LAPTOP_IP:8011
```

Host values have **no `http://` prefix**. Use `127.0.0.1` for a service on the same laptop. If both camera processes run on the frontend laptop, use `127.0.0.1:8010` and `127.0.0.1:8011`.

```bash
cd frontend
npm ci
ECHOTWIN_START_CAMERAS=0 npm run dev
```

The explicit camera opt-out keeps manually managed/remote producers separate. On Windows PowerShell use `$env:ECHOTWIN_START_CAMERAS="0"` followed by `npm run dev`.

Open the URL printed by Vite, normally `http://localhost:5173`. From a phone, use `http://FRONTEND_LAPTOP_IP:5173`; `localhost` on the phone means the phone, not your laptop. Restart Vite after changing env files. Existing `.env.local` overrides matching `.env` settings.

Vite proxies `/api`, `/ws`, `/cam1`, and `/cam2`, so browsers normally use the frontend origin rather than reaching the backend directly. A production deployment needs an equivalent reverse proxy and HTTPS; copying `dist/` to a plain static host alone is not a full deployment.

## Maintenance watcher and calls

Maintenance routes are already included in the main API. The **worker is optional** and must be running for periodic reviews; opening the panel does not start it.

After the core backend has initialized its database, start the maintenance profile in dry-run mode:

```bash
MAINTENANCE_NOTIFICATION_MODE=dry_run docker compose --env-file .env -f backend/docker-compose.yml --profile maintenance up -d --build --wait maintenance-api maintenance-worker
curl --fail http://localhost:8000/maintenance/status
```

This also starts a standalone maintenance API on port 8002. The website can keep using the same routes on port 8000. If deliberately using the sidecar, set `VITE_MAINTENANCE_HOST=BACKEND_IP:8002` and restart Vite. Do not start the sidecar against an uninitialized fresh database; it expects core sensor/CV tables.

Default behavior:

| Setting | Default |
| --- | --- |
| Full review / lookback window | Every 180 seconds / previous 300 seconds |
| Urgent checks | Every 15 seconds, subject to processing time |
| Warning / critical persistence | 120 seconds / 30 seconds |
| Sensor / camera stale age | 30 seconds / 30 seconds |
| Notification cooldown | 900 seconds |
| Expected sensor cadence | `MAINTENANCE_SAMPLE_SECONDS=1` |
| Expected cameras | `MAINTENANCE_CAMERAS=cam1,cam2` |

**For direct ESP32 MQTT, set `MAINTENANCE_SAMPLE_SECONDS=7.5`.** Otherwise the default allowed gap can break every sustained-condition streak. Set the expected camera list to the actual deployment; intentionally absent cameras otherwise create missing-camera warnings.

Incidents persist in PostgreSQL. The UI supports review requests, acknowledgement, resolution, and previous incidents. Repeated problems can suggest deeper inspection; replacement is a human decision. Rules/evidence determine severity, not the language model.

Notification modes:

- `dry_run`: record what would be said, without contacting Twilio.
- `disabled`: do not dispatch notifications.
- `twilio`: eligible open, active **critical** incidents can place real calls to the configured recipient. This is not a call for every yellow reading.

Real calls require `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, and `MAINTENANCE_CALL_TO` in the backend's local root `.env`. Use a consenting designated recipient and confirm account/trial restrictions. Do not put credentials in `VITE_*` fields. Restart/recreate the worker after config changes.

Call submission is not proof of answering; inspect provider status and confirm audibility with the recipient. An uncertain request is not automatically redialed. The earlier team demo notes report a successful manual Console call but a rejected backend inline-TwiML trial call: **automatic calling is not verified end to end; keep dry-run as the default** until separately tested.

See [maintenance details](https://github.com/Adyanth-212/EchoTwin/blob/29c7f0d6daa16184a2ca4965734e21c39722529e/backend/MAINTENANCE.md). Some older component documentation still refers to maintenance as branch-only; current `main` contains it.

## 3D scans and markers

Bring your own scan: captured meshes, Gaussian files, and compressed scan archives are intentionally excluded from Git. A fresh clone can run without them using the fallback room. The small synthetic `frontend/public/room-sample.glb` and renderer/Draco files remain available for testing; they are not captured room data.

### Supported scan formats

| Representation | Format | Requirements |
| --- | ---: | --- |
| Textured mesh | `.glb` (glTF 2.0 binary) | Prefer a self-contained export with geometry and textures embedded. Draco-compressed geometry is supported by the bundled decoder. |
| Gaussian splat | Gaussian-splat `.ply` | Use a Gaussian reconstruction export, including position, color, opacity, scale, and rotation attributes. An ordinary mesh/point-cloud PLY is not equivalent. |
| Optional local archive | `.ply.gz` | A gzip-compressed compatible Gaussian PLY; the prep script can unpack the default filename below. |

For the documented workflow, export/convert mesh formats such as OBJ or FBX to GLB; do not rename their extensions. A scan is a visual reconstruction, not automatic sensor identification. Capture adequate overlapping views, keep the scene still, and check textures and geometry before using it in a demo.

### Add a scan locally

1. Copy the mesh to `frontend/public/scans/table-mesh.glb` and/or the Gaussian export to `frontend/public/scans/table-gaussian.ply`. Either representation can be supplied independently.
2. Alternatively, place `table-gaussian.ply.gz` in that directory. `npm run dev` and `npm run build` unpack it if the raw PLY does not already exist. Without either Gaussian file, preparation skips it and the viewer uses its fallback.
3. For custom filenames, set the corresponding values in `frontend/.env.local` (URLs relative to `frontend/public/`, not absolute laptop paths):

```ini
VITE_ROOM_MODEL_MODE=mesh
VITE_ROOM_MESH=/scans/my-room.glb
VITE_ROOM_SPLAT=/scans/my-room.ply
```

Only set overrides for files you actually supply, then restart Vite. Custom `.gz` filenames are not automatically unpacked: decompress them locally or use the default archive filename.

Manual preparation of the default local archive:

```bash
cd frontend
node scripts/prepare-scans.mjs
```

Use the **Mesh / Gaussian** toggle, orbit, zoom, and reset-view controls. `frontend/src/roomLayout.js` holds transforms, room dimensions, initial marker positions, and the exclusion-zone configuration. Model placement, floor calibration, and marker alignment must share a coordinate frame; they are not automatically inferred from the scan.

To test without your own scan, set `VITE_ROOM_MESH=/room-sample.glb` in `frontend/.env.local`. Large Gaussian reconstructions can use substantial browser memory; test loading, zoom, and image quality on the actual demo devices.

The prep script preserves an existing raw PLY. If replacing the archive, first back up/move any old generated PLY you want to keep, then regenerate; otherwise the previous local file remains in use. Verify the visual result rather than relying on the fallback room to prove the scan loaded.

Keep private backups of original exports outside the checkout and transfer scans separately to each frontend laptop. Files under `public/` can be served to anyone who can reach the frontend: Git-ignored does not mean private at runtime. A build made with local scans will include those assets in its output.

**Upgrading an older checkout:** back up tracked scan files outside the repo before pulling the commit that removes them, then restore them locally into `public/scans/`. Removing them in a new commit does not erase old Git history; no history rewrite is performed.

The optional phone browser view/AR instructions are in [frontend documentation](frontend/README.md). Camera passthrough needs a secure context such as HTTPS or localhost. It does **not** identify a sensor by radio, recognize every individual sensor, or provide measured physical proximity. The QR/equipment-link workflow is a separate, explicit identification mechanism.

## Data contract, storage, and history

Publish one reading per MQTT message to `echotwin/sensors/node_1`:

```json
{
  "node_id": "node_1",
  "sensor": "temperature",
  "value": 25.2,
  "timestamp": "2026-09-14T08:00:00Z"
}
```

Use the **current actual sample time**, not the literal timestamp above. The backend accepts the named channels in [the shared schema](schemas/mqtt_and_ws.md), maps `node_1` to `corridor_a`, and requires a timezone. Default live-ingestion rejection limits are older than 300 seconds or more than 60 seconds into the future. Unknown nodes and malformed messages are rejected. Additional physical-range/finite-value validation remains a known gap.

Key endpoints (all relative to the backend):

| Endpoint | Purpose |
| --- | --- |
| `GET /health`, `GET /db-health` | Process and database checks |
| `GET /docs` | Interactive API documentation |
| `GET /sensor-readings`, `GET /cv-events` | Recent raw events |
| `POST /cv` | Camera occupancy metadata ingestion |
| `GET /room-status`, `GET /room-status/corridor_a` | Fused room state |
| `WS /ws/room-status` | Live fused state updates |
| `GET /room-status/corridor_a/ai-advice` | Optional question-aware recommendation |
| `GET /history/rooms`, `/history/sensors`, `/history/cv-events` | Persisted history |
| `GET /maintenance/status`, `/maintenance/incidents` | Worker status and incidents |
| `POST /maintenance/review` | Request a worker review |
| `POST /maintenance/incidents/{id}/acknowledge` or `/resolve` | Human incident actions |

Example:

```bash
curl --fail 'http://localhost:8000/history/sensors?room_id=corridor_a&sensor=temperature&bucket=5m&limit=100'
```

History defaults to the previous 24 hours. `from` and `to` accept timezone-qualified timestamps. Buckets: `raw`, `1m`, `5m`, `15m`, `1h`, `6h`, `1d`; maximum result limit 5,000. Aggregated sensor points include average, minimum, maximum, and sample count. See [history API](backend/HISTORY_API.md).

Storage lives in the backend's Docker PostgreSQL volume, **not GitHub**. Sensor readings and CV events have a **30-day TimescaleDB retention policy**. This drops eligible old chunks on a background schedule, not each row at precisely its 30-day birthday. `room_status` stores the latest row per room. Maintenance incident/notification records do not currently have the same retention policy. Camera video is not archived by this backend.

Back up the database separately; a code push is not a data backup. Check actual database/disk usage rather than estimating it from Git repository size. Do not delete volumes to solve a startup issue.

## Rules, anomaly detection, prediction, and Ollama

Current upper-threshold rules; critical takes precedence over warning:

| Metric | Yellow | Red |
| --- | --- | --- |
| Air temperature | ≥30 °C | ≥35 °C |
| Surface temperature | ≥40 °C | ≥45 °C |
| Vibration magnitude | ≥2.5 m/s² | ≥5 m/s² |
| Estimated CO₂ | ≥1,000 ppm | ≥1,500 ppm |
| TVOC | ≥300 ppb | ≥600 ppb |
| ENS160 AQI | ≥4 | ≥5 |
| Humidity | <30% or >70% | <20% or >80% |
| Occupancy | ≥20 | ≥30 |

`vibration_trip=true` adds a warning. Air temperature ≥30 °C **together with** vibration ≥2.5 m/s² is critical. Restricted-hours occupancy can be critical when configured; it is disabled by default. The frontend also has a configured spatial exclusion zone.

These are demo/application thresholds, not certified sensor limits. ENS160 eCO₂ is estimated from VOC sensing, not a direct NDIR CO₂ measurement, and its AQI is a 1–5 device index.

**Isolation Forest:** the committed model was trained on 3,000 synthetic normal-like samples, with 200 trees and contamination 0.05. It scores how unusual a complete eight-channel vector looks relative to that baseline. It is not a diagnosis or a measured probability of failure. Missing required features disable that evaluation. Displayed contributors are the two largest standardized deviations, not a causal explanation. A busy-room heuristic may suppress an air-quality-only anomaly; it does not remove the fixed threshold rules. Training code: [ml/train_anomaly.py](ml/train_anomaly.py).

**Linear extrapolation:** `backend/app/trend.py` fits a straight line to recent values, then estimates the time to a warning threshold if the slope is positive. The nearest future crossing within 24 hours is returned; a crossing within 15 minutes can raise a green state to yellow. It needs at least four points spanning 30 seconds. **Known issue:** it queries only 20 readings per metric, so a steady 1 Hz stream spans approximately 19 seconds and yields no trend. The maintenance worker has a separate five-minute-window calculation. No forecast is not proof that conditions are safe or will remain stable.

**Ollama:** configure the root `.env` on the backend laptop:

```ini
TAILSCALE_OLLAMA_URL=http://OLLAMA_HOST:11434
OLLAMA_MODEL=qwen3:8b
OLLAMA_TIMEOUT_SECONDS=20
```

The endpoint must be reachable from the backend container and the named model must be installed on the model host. The backend already sends `think: false`. It passes room state/question context for a short recommendation; it does not let the model set numeric thresholds or choose call recipients. Missing, failed, or empty model responses fall back to rules. Ollama is optional for ingestion, history, and deterministic alerts.

## Validation and tests

Run these against the intended live setup, substituting the frontend URL:

```bash
python3 scripts/check-demo.py --backend http://localhost:8000 --frontend http://FRONTEND_LAPTOP_IP:5173 --require-cameras
```

Add `--check-ai` only when you want one actual Ollama request. Omit `--require-cameras` when cameras are intentionally absent. Verify changing sample timestamps, not just an open socket or an old value on screen.

Inspect MQTT without injecting data, from the repo root:

```bash
docker compose --env-file .env -f backend/docker-compose.yml exec mosquitto mosquitto_sub -h localhost -p 1883 -t 'echotwin/sensors/#' -v
```

Stop that subscriber with Ctrl-C. The `-f` path matters: there is no root Compose file to discover automatically.

Build and non-database tests in a fresh local environment:

```bash
cd frontend
npm ci
npm run build
```

```bash
# From the repo root; use a test environment, not a configured production shell.
python3.12 -m venv .venv-audit
source .venv-audit/bin/activate
python -m pip install -r backend/requirements.txt -r esp32-firmware/tools/requirements.txt pytest
PYTHONPATH=backend python -m pytest backend/tests esp32-firmware/tools/tests -q
```

Database integration tests are intentionally skipped unless the isolated test database is configured. The supplied test stack uses a separate database, temporary storage, no exposed database port, and disabled external notifications:

```bash
docker compose -p echotwin-tests -f backend/compose.maintenance-test.yml up --build --abort-on-container-exit --exit-code-from tests
docker compose -p echotwin-tests -f backend/compose.maintenance-test.yml down
```

Never set the integration-test switch against your live database. The audit of `29c7f0d` produced 59 passing tests and 11 skipped integration tests; Docker was off, so the integration stack was not validated in that audit. The frontend build passed. These results are not a substitute for reconnecting real hardware and checking the deployed hosts.

### Simulated demos are not live evidence

- `VITE_DEMO=1` supplies synthetic dashboard data and displays a demo badge. In the website build, camera feeds can still be live; this is not a completely network-isolated mode.
- MQTT mocks and `scripts/demo_trigger.py` **write simulated readings into the chosen backend's normal history as `node_1`**. They can compete with real firmware and trigger maintenance/calls. There is no separate simulation flag in stored sensor rows.
- The demo web remote (`serve`, port 8090 by default) listens on all interfaces without authentication. Do not expose it publicly or leave it running accidentally.

Use a separate rehearsal deployment, keep notifications in `dry_run`, and identify simulation explicitly to viewers. Run `python scripts/demo_trigger.py --list` to inspect scenarios; this script additionally needs `paho-mqtt` and `requests`. Do not use it as a read-only health check.

## Shutdown and restart

Stop the simulator first if running, then stop serial/camera producer terminals with Ctrl-C. Stop Vite with Ctrl-C. On the backend, from the repo root:

```bash
docker compose --env-file .env -f backend/docker-compose.yml --profile maintenance stop
```

This stops containers without deleting database storage. **Do not run `down -v`, prune volumes, or delete the PostgreSQL data directory unless intentionally discarding backed-up data.** Unplug the ESP32 after stopping its serial bridge. Restart using the startup sequence above; keep laptops awake during demos.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| `no configuration file provided` | Run from repo root with `-f backend/docker-compose.yml` |
| Cannot connect to Docker daemon | Start Docker Desktop/Engine; do not reset database storage |
| Works on localhost, not another laptop | Actual service binding, firewall, correct LAN/Tailscale address, and a direct `curl`; ping alone is not an application check |
| Frontend opens but no data | `VITE_BACKEND_HOST`, restart Vite, `/db-health`, MQTT subscriber, fresh history, correct room/node IDs |
| Camera images visible but occupancy absent | CV producer `--backend`, successful `POST /cv`, fresh `/cv-events` |
| Counts work but people float/wrong positions | Per-camera calibration and shared coordinate frame; don't move cameras afterward |
| Camera repeatedly loads/stalls | Network latency, camera process, phone permissions; main's 250 ms image polling can replace slow in-flight requests |
| Maintenance panel says offline | Worker/profile running, `/maintenance/status`, database initialization, configured host/port |
| Sustained incident never appears | Correct expected cadence (`1` vs `7.5`), fresh samples, persistence/window settings |
| Model viewer falls back to a room | Scan URLs, successful prep step, files in `public/scans`, browser WebGL support |
| Ask Twin shows rules | Ollama reachable from backend, installed model name, timeout; rules fallback is expected when unavailable |
| History disappeared after startup | Same Compose project and database volume, same room/time range, retention—not a reason to delete volumes |

## Known limitations

- Main has no authentication/authorization for the API, MQTT publishing, camera feeds, or demo remote. CORS is not authentication. Keep the prototype on a trusted private network; add TLS, access control, broker credentials, and hardened deployment before wider exposure.
- Dependency audit found vulnerable frontend tooling and 8 unique backend advisory IDs across `python-dotenv`/`starlette` (16 returned entries including duplicates). The separate audit report records the scope and details. Upgrade compatible dependency sets and retest in a separate branch, not during a running demo.
- Ingestion still needs finite/physical-range checks, robust malformed-byte handling, and stronger topic/node identity checks.
- Fusion reads latest stored values without per-source age gating. Frontend stale indicators and maintenance freshness checks do not make that fused snapshot fully freshness-aware.
- Backend occupancy uses the latest camera event, not a globally deduplicated headcount. The frontend's calibrated proximity merge is an approximation, not cross-camera identity tracking.
- Trend estimates have the sampling-window issue described above; model accuracy has not been validated against a labeled real-world failure dataset.
- Main's camera polling may interrupt slow frame downloads; its pending fix is not included in this documentation update.
- No committed CI workflow or project license file exists at this revision. Component guides contain some historical setup/defaults; use this root guide for current startup and check source/config where they disagree.
- Automatic sensor localization and accurate physical alignment are separate work—not implied by a successful web build.

## Further documentation

- [MQTT and WebSocket contract](schemas/mqtt_and_ws.md)
- [History API](backend/HISTORY_API.md)
- [Maintenance implementation](https://github.com/Adyanth-212/EchoTwin/blob/29c7f0d6daa16184a2ca4965734e21c39722529e/backend/MAINTENANCE.md)
- [Frontend and browser mobile/AR details](frontend/README.md)
- [Camera setup and calibration](cv/README.md)
- [Firmware setup](esp32-firmware/README.md)
- [Sensor calibration](esp32-firmware/CALIBRATION.md)
- [Anomaly-model training](ml/README.md)

When updating a shared interface, update its schema, producer, backend, frontend, and tests together. Review changes on a feature branch before merging into the demo branch, and keep all credentials/device-specific calibration local.
