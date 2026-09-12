# EchoTwin — Master Context for Coding Agents

Paste this entire document at the start of any AI coding agent session (Claude Code, Cursor, etc.) working on this project. It gives full shared context so agents don't need re-explaining and don't contradict each other's assumptions.

---

## 1. What we're building

**EchoTwin** — a live 3D digital twin of a campus/building that fuses computer-vision camera feeds and IoT sensor data into one dashboard, so facility issues are caught *before* they become visible damage, not after.

**The problem**: CCTV, environmental sensors, and inspection logs are siloed and never cross-reference each other. A sensor reading alone has no spatial context. Manual walkthroughs don't scale. Faults get noticed only after damage is already visible.

**The core pitch / novelty**: no single sensor makes a fault call alone. The system correlates multiple independent signals (e.g. rising surface temperature + rising vibration together) to flag a developing problem before either signal alone would look alarming. This fusion logic is the actual innovation — not any individual sensor or camera.

Built for the Inferentia hackathon (PES University) by Team Star Coders (team of 3).

---

## 2. Architecture & data flow

```
ESP32 sensor node ──MQTT──┐
                            ├──▶ FastAPI (ingest) ──▶ PostgreSQL/TimescaleDB
Phone cams ──RTSP──▶ Laptop│      │
(YOLOv8 on 2 laptops)──────┘      ▼
                              WebSocket broadcast
                                   │
                                   ▼
                        React + Three.js dashboard
                        (3D room twin, color-coded status,
                         AR overlay, ask-the-twin chat panel)
                                   │
                     (async, non-blocking) ▼
                    Suggestion engine (rule-based, always works)
                         → optional LLM phrasing via Tailscale
                           to home PC (Ollama), 2.5s timeout,
                           silent fallback to rule-based text
```

Every reading — sensor or camera-derived — gets tagged with room/location ID and timestamp and lands in one unified timeline. The dashboard does not distinguish between a sensor-sourced update and a CV-sourced update; both are just "this room's status changed."

---

## 3. Final tech stack

| Layer | Tools |
|---|---|
| Computer vision | YOLOv8n (pretrained COCO, `classes=[0]` for person/occupancy — no custom training), OpenCV (`cv2.VideoCapture`) |
| Camera source | Phone + IP Webcam app (Android) → RTSP, laptop webcam as local test fallback |
| Sensor firmware | ESP32 (Arduino/PlatformIO), publishes over MQTT |
| Backend | FastAPI + WebSockets, Python |
| Database | PostgreSQL + TimescaleDB extension |
| Message broker | Mosquitto (MQTT) |
| Containerization | Docker + Docker Compose |
| Frontend | React, Three.js (3D twin), WebXR (AR overlay) |
| Anomaly detection | Isolation Forest (scikit-learn), unsupervised, trained on baseline "normal" sensor readings |
| LLM (optional layer) | Ollama + Llama 3.1 8B, running on home RTX 3060 12GB PC, reached via Tailscale |
| Version control | Git + shared GitHub repo |

**Coding style preference (applies to all Python code)**: keep implementations simple. Avoid f-strings, `readlines()`, `Counter`, and similar advanced/shorthand constructs unless specifically needed for the task — prefer plain, explicit code.

---

## 4. Hardware inventory & roles

| Device | Role |
|---|---|
| Phone 1 | Hotspot only — always powered, screen-lock/sleep disabled |
| Phone 2 & 3 | Cameras via IP Webcam → RTSP → Laptop 1 & 2 |
| Laptop 1 | YOLOv8 inference on Phone 2's feed |
| Laptop 2 | YOLOv8 inference on Phone 3's feed |
| Laptop 3 | Server: FastAPI + PostgreSQL/TimescaleDB + Mosquitto + hosts the dashboard |
| ESP32 (×1 active, ×1 spare board) | Single fully-loaded sensor node |
| Home custom PC (RTX 3060 12GB) | Stays at home. Runs Ollama + Tailscale. Not brought to venue. |

**Network**: Phone 1's hotspot is the shared LAN for everything at the venue. Laptop 3's IP is the fixed reference point — stored in one shared `.env` config, never hardcoded per-file.

---

## 5. Sensor node — final spec

All on **one ESP32**, all sensors already acquired:

| Sensor | Signal | Interface | Pin / Address |
|---|---|---|---|
| AHT21 + ENS160 (combo board) | Temp, humidity, eCO2, TVOC, AQI | I2C | GPIO 21 (SDA) / 22 (SCL); AHT21 @ 0x38, ENS160 @ 0x53 |
| MLX90614ESF-BCC | Non-contact object/equipment surface temp (35° FoV) | I2C | Same bus, @ 0x5A |
| MPU-6050 | Vibration — accelerometer + gyroscope magnitude/direction | I2C | Same bus, @ 0x68 |
| SW-420 | Vibration — binary trip, sensitivity tuned via onboard pot | Digital | GPIO 5 |
| DHT22 (optional backup) | Temp/humidity redundancy | Digital | GPIO 4 + 10kΩ pull-up if module lacks one |

MQ135 was considered and **dropped** — ENS160 already covers air quality with calibrated eCO2/TVOC/AQI instead of raw analog voltage.

---

## 6. Data schemas (do not deviate — all agents must match these exactly)

**MQTT message (ESP32 → backend)**
```json
{
  "node_id": "string",
  "sensor": "string",
  "value": "number",
  "timestamp": "ISO8601 string"
}
```

**WebSocket message (backend → dashboard)** — agree on and fix this shape early; every room-status update, regardless of source (sensor, YOLO, anomaly score), should conform to one consistent structure keyed by room/location ID and timestamp.

Room/location IDs must be used consistently and identically across ESP32 firmware, database records, and 3D dashboard labels (e.g. `"corridor_a"`, not `"Corridor A"` in one place and `"corridor-a"` in another).

---

## 7. Locked feature set

**Core pipeline**: sensor fusion + CV occupancy → live 3D twin with color-coded room status (green/yellow/red).

**Three additional locked features:**

1. **Trend-based early warning** — using TimescaleDB's stored time-series, run simple linear extrapolation on recent readings to estimate time-to-threshold (e.g. "~12 min to critical AQI at current rate"), surfaced on the room's dashboard card.
2. **Anomaly explanation** — Isolation Forest already computes per-feature contribution to an anomaly score; surface the top 1-2 contributing features (e.g. "flagged due to: surface temp +40% above baseline, vibration +25%") instead of a generic "anomaly detected" flag.
3. **Ask-the-twin chat panel** — a chat UI on the dashboard where a user can ask a question about a room's current state; the backend assembles that room's live sensor context and sends it to the Ollama LLM (via Tailscale) for a natural-language answer. Falls back to a rule-based canned response if the Tailscale link times out (2.5s timeout), matching the same fallback pattern as the fix-suggestion engine.

AR overlay (WebXR) is in scope but lowest priority — cut first if time runs short.

---

## 8. Non-negotiable constraints

- **No fabricated accuracy claims.** The anomaly detector is unsupervised and has no labeled fault data to validate against. If asked "what's your model's accuracy?", the honest answer is that it produces an anomaly deviation score, not a classification accuracy — there is no ground truth to measure against. Do not invent or imply a percentage.
- **The LLM/Tailscale layer must never be load-bearing.** Every LLM-dependent feature (fix suggestions, chat panel) must have a rule-based fallback that fires silently on timeout or connection failure. The demo must work completely even if the home PC is unreachable all day.
- **Room naming, MQTT schema, and WebSocket schema are fixed contracts** — agents working on any one component must not unilaterally change these without updating the other components that depend on them.

---

## 9. Team ownership

| Person | Owns |
|---|---|
| Akshay — Hardware/Embedded | ESP32 wiring, firmware (all 5 sensors → MQTT), physical mounting/calibration at venue |
| Aditya — Backend/Data | Docker stack (his Mac is Laptop 3/server), MQTT + REST ingestion, fusion logic, anomaly model integration, the generic Tailscale-call utility (2.5s timeout + fallback) used by both the suggestion engine and the chat panel |
| Adyanth — Frontend/CV | YOLOv8 pipeline (both camera feeds), Three.js dashboard, AR overlay, chat panel UI, and everything on the Ollama side of the Tailscale link: running Ollama on the home PC, model choice, verifying reachability from a hotspot, and turning a chat question into context sent to the LLM |

---

## 10. Demo script (success criteria)

1. Dashboard shows building at rest, all rooms green.
2. Live-trigger a staged anomaly (tap SW-420, heat the MLX90614 target).
3. Room flips to yellow/red in real time, with anomaly explanation shown.
4. Suggested fix appears (rule-based, optionally LLM-phrased).
5. AR mode (if built): point a phone at the room, see live overlay.
6. Ask-the-twin chat: ask a live question about the room, get an answer grounded in real sensor data.
