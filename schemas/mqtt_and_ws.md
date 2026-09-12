# EchoTwin data contracts

This file is the **source of truth** for the two message shapes used across
EchoTwin. Every component (ESP32 firmware, backend, mocks, frontend, ML)
must match these exactly. If a shape needs to change, update this file
first, then update every consumer listed below — do not change a shape in
one place only.

Room/location IDs must be lowercase, snake_case, and identical across the
ESP32 firmware, the database, and the dashboard (e.g. `corridor_a`, not
`Corridor A` or `corridor-a`).

---

## 1. MQTT message (ESP32 -> backend)

Topic: `echotwin/sensors/<node_id>`

```json
{
  "node_id": "string",
  "sensor": "string",
  "value": "number",
  "timestamp": "ISO8601 string"
}
```

Field notes:

- `node_id` — identifies the physical ESP32 board, e.g. `"esp32_1"`.
- `sensor` — one of the fixed sensor names below. One MQTT message reports
  exactly one sensor reading (the ESP32 publishes one message per sensor
  per sample cycle, not one combined blob).
- `value` — always a plain number. Boolean-style readings (e.g. the SW-420
  trip sensor) are encoded as `0` or `1`.
- `timestamp` — ISO8601 with a timezone, e.g. `"2026-09-11T14:32:05Z"`.
  The backend rejects readings more than 5 minutes old or more than 60 seconds
  in the future by default. These limits are configurable on the backend.

Fixed `sensor` values (from the sensor node spec):

| `sensor` value | Meaning | Unit |
|---|---|---|
| `temperature` | AHT21 air temperature | degrees C |
| `humidity` | AHT21 relative humidity | percent |
| `eco2` | ENS160 estimated CO2 | ppm |
| `tvoc` | ENS160 total volatile organic compounds | ppb |
| `aqi` | ENS160 air quality index | index 1-5 |
| `surface_temp` | MLX90614 non-contact object temperature | degrees C |
| `vibration_magnitude` | MPU-6050 accelerometer/gyro magnitude | m/s^2 |
| `vibration_trip` | SW-420 binary trip | 0 or 1 |
| `temperature_backup` | DHT22 backup air temperature | degrees C |
| `humidity_backup` | DHT22 backup relative humidity | percent |

The ESP32 does not send a `room_id` in the MQTT payload — the backend maps
`node_id` to a room/location ID via a fixed lookup table (one sensor node
per room in the current hackathon build).

---

## 2. WebSocket message (backend -> dashboard)

Every room-status update the backend broadcasts — whether triggered by a
new sensor reading, a YOLO occupancy update, or an anomaly re-score — uses
this one shape. The dashboard never needs to know which source triggered
the update.

```json
{
  "room_id": "string",
  "timestamp": "ISO8601 string",
  "status": "green | yellow | red",
  "source": "sensor | cv | fusion",
  "sensors": {
    "temperature": "number | null",
    "humidity": "number | null",
    "eco2": "number | null",
    "tvoc": "number | null",
    "aqi": "number | null",
    "surface_temp": "number | null",
    "vibration_magnitude": "number | null",
    "vibration_trip": "boolean | null",
    "occupancy_count": "number | null"
  },
  "anomaly": {
    "is_anomaly": "boolean",
    "score": "number | null",
    "top_features": ["string"]
  },
  "trend": {
    "metric": "string | null",
    "time_to_threshold_minutes": "number | null"
  }
}
```

Field notes:

- `room_id` — same fixed room ID vocabulary as the MQTT `node_id` mapping.
- `status` — one of exactly `"green"`, `"yellow"`, `"red"`. Computed by the
  fusion logic (TODO in backend), never invented client-side.
- `source` — which pipeline triggered this particular broadcast. Purely
  informational for debugging; the dashboard renders all sources the same
  way.
- `sensors` — latest known value for each field, or `null` if that sensor
  has not reported yet for this room. `occupancy_count` comes from the
  YOLOv8 CV pipeline, not the ESP32.
- `anomaly` — output of the Isolation Forest model. `score` is a raw
  anomaly deviation score, not an accuracy or probability — see
  constraint in the project context doc: no fabricated accuracy claims.
  `top_features` holds the 1-2 feature names contributing most to the
  anomaly (e.g. `["surface_temp", "vibration_magnitude"]`), empty list
  when `is_anomaly` is `false`.
- `trend` — output of the linear extrapolation early-warning feature.
  `null` fields when no trend has been computed yet.

### Known consumers of this shape (update together)

- `backend/app/` — constructs and validates this shape (ingestion +
  broadcast).
- `backend/mocks/mock_ws_sender.py` — must emit exactly this shape.
- `frontend/src/` — must parse exactly this shape.
