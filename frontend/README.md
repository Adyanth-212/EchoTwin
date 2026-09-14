# frontend/ — EchoTwin dashboard

React 18 + Vite + Three.js. A live 3D twin of `corridor_a` driven by the
backend's WebSocket broadcast, with the anomaly explanation, the trend early
warning, the rule/LLM suggestions, occupancy from the CV pipeline, and a
phone-first view reachable by scanning a QR code on the equipment itself.

```bash
cd frontend
npm install
cp .env.example .env      # optional — the defaults already work
npm run dev
```

Opens at <http://localhost:5173>.

---

## The tailnet

Everything at the venue talks over Tailscale. **These addresses change if the
tailnet is recreated** — they already have once, which broke every hardcoded
hostname in this repo.

| Machine | Tailscale IP | MagicDNS | Runs |
|---|---|---|---|
| `sanjays-macbook-air` | `100.93.145.13` | `sanjays-macbook-air.tail22578a.ts.net` | Backend, Postgres, Mosquitto |
| `adyanths-macbook-air` | `100.117.169.11` | `adyanths-macbook-air.tail22578a.ts.net` | Dashboard, CV producer (iPhone) |
| `akshay-lenovo` | `100.105.226.40` | `akshay-lenovo.tail22578a.ts.net` | — |

Current MagicDNS suffix: `tail22578a.ts.net`. Check with `tailscale status`.

If MagicDNS is not resolving on a machine, use the raw `100.x` address — set
`VITE_BACKEND_HOST=100.93.145.13:8000` in `frontend/.env`. That is the only
place the frontend needs it; `vite.config.js` reads it and both REST and the
WebSocket follow.

For the CV producer it is `--backend http://100.93.145.13:8000`.

## How it talks to the backend

The browser never calls the backend directly. `vite.config.js` proxies
`/api/*` and `/ws/*` to `VITE_BACKEND_HOST`, so every request is same-origin
and the backend's CORS allow-list never comes into it.

That matters because the allow-list only covers `localhost:5173` and
`localhost:3000`, and a phone loading the dashboard over the venue hotspot
has an origin that will never be on it. Proxying sidesteps the problem
entirely without anyone editing the backend config.

```
browser  ──/api/room-status──▶  Vite dev server  ──▶  http://<VITE_BACKEND_HOST>/room-status
browser  ──/ws/room-status──▶   Vite dev server  ──▶  ws://<VITE_BACKEND_HOST>/ws/room-status
```

`server.host` is on, so the dev server listens on every interface. Find the
laptop's LAN address and open it from a phone:

```bash
ipconfig getifaddr en0     # macOS, Wi-Fi
```

Then browse to `http://<that address>:5173` from the phone. Both devices must
be on the same hotspot.

---

## Environment variables

All optional. Copy `.env.example` to `.env` to change any of them.

| Variable | Default | What it does |
|---|---|---|
| `VITE_BACKEND_HOST` | `sanjays-macbook-air.tail22578a.ts.net:8000` | Backend host:port. Read by `vite.config.js` only; both REST and WebSocket follow it. **Restart the dev server after changing it.** |
| `VITE_WS_URL` | unset | Bypasses the proxy and connects the WebSocket straight to this URL. Only for the mock sender. |
| `VITE_ROOM_ID` | `corridor_a` | The room this dashboard shows. |
| `VITE_DEMO` | unset | `1` feeds the whole UI from a built-in synthetic generator. See below. |
| `VITE_ENABLE_AR` | unset | `1` enables the camera-passthrough layer in the mobile view. |
| `VITE_TREND_ALERT_MINUTES` | `15` | Only notify about a predicted threshold crossing this close or sooner. |

### Working against the mock sender

```bash
cd backend
pip install -r mocks/requirements.txt
python mocks/mock_ws_sender.py
```

Then set `VITE_WS_URL=ws://localhost:8001` in `frontend/.env`.

---

## Demo mode

`VITE_DEMO=1` runs the dashboard off a synthetic data generator instead of
the network — the backend can be completely unreachable and every panel still
works. It runs a repeating scripted arc: calm, then air quality climbing (the
trend banner fires), then surface temperature and vibration rising together
(the anomaly fires), then recovery.

This is also the reliable way to **show the notifications working on cue**
rather than waiting for a real fault at the exact moment a judge is watching.

The page shows a **DEMO DATA** badge the whole time it is on, so synthetic
readings can never be mistaken for live ones.

---

## Notifications

Alerting for someone who is not looking at the tab. Three layers that fail
independently:

1. **OS notification** — only if permission was granted.
2. **In-page toast** — always, on exactly the same triggers.
3. **A short tone** — unless muted or `prefers-reduced-motion` is set.

A judge's browser denying the permission prompt never makes the feature look
absent, because the toast still fires.

This uses the browser `Notification` API, **not** Web Push. Real push needs a
service worker, VAPID keys and a backend push endpoint; the Notification API
gets the same visible result — an OS alert while the tab is backgrounded —
with none of that. The tab that registered the notification has to stay open,
which is fine for a laptop left running through a demo.

### What fires an alert

Only **transitions**, never every message — the socket pushes an update on
every reading:

- status worsening (`green → yellow`, or either → `red`). Recovery is a quiet
  toast only: no OS notification, no sound.
- `anomaly.is_anomaly` flipping false → true
- `trend.time_to_threshold_minutes` newly non-null and under
  `VITE_TREND_ALERT_MINUTES`
- `vibration_trip` flipping false → true

A room stuck at red does not re-alert: each trigger is armed once per episode
and only re-arms when the condition clears. At most one OS notification fires
per 20 seconds, and simultaneous triggers are combined into one body rather
than sent separately.

The permission prompt is only ever raised from the banner's button. A prompt
fired from page load with no user gesture is throttled or hidden by Chrome,
so there is no automatic prompt anywhere in this app.

The mobile view gets toasts only — no permission banner.

Mute the tone with the **Sound on / Sound muted** toggle next to the
connection indicator. It defaults to on, because a hackathon hall is loud.

---

## The LLM path (ask-the-twin)

The `LLM` / `RULES` badge on each answer says which produced it. If it is
always `RULES`, the cause is almost certainly one of the three settings
below rather than anything in the frontend.

The browser never talks to Ollama. The chain is:

```
AskTwin ──/api/room-status/{id}/ai-advice──▶ backend ──▶ Ollama (home PC, via Tailscale)
```

Ollama runs on the home PC at **`http://100.64.88.63:11434`**, serving
`qwen3:8b` (8.2B, Q4_K_M, 5.6GB). Verified reachable from the tailnet at
~0.26s round trip.

### Required backend settings

These go in `backend/.env` on `sanjays-macbook-air`, where the backend runs.
**They are not set by default and every one of them silently forces the rule
based fallback:**

```ini
TAILSCALE_OLLAMA_URL=http://100.64.88.63:11434
OLLAMA_MODEL=qwen3:8b
OLLAMA_TIMEOUT_SECONDS=20
```

- `TAILSCALE_OLLAMA_URL` defaults to empty, and `get_ai_advice` returns
  `None` immediately when it is unset.
- `OLLAMA_MODEL` defaults to `llama3.1:8b`, which is **not installed** on
  that machine. Only `qwen3:8b` is.
- `OLLAMA_TIMEOUT_SECONDS` defaults to `2.5`. Measured generation time for
  the backend's own prompt is **4.9-6.5s**, so at 2.5s the LLM never once
  answers in time.

### Why it is slow, and the one-line fix

qwen3 is a reasoning model: it spends most of that time in a thinking pass.
Ollama 0.34 returns that separately in a `thinking` field, so none of it
leaks into the answer, but you pay for it.

Sending `"think": false` collapses generation to **0.7-2.2s**, which fits
inside the original 2.5s timeout with room to spare. That is one line in
`backend/app/ollama_client.py`:

```python
json={
    "model": config.OLLAMA_MODEL,
    "prompt": prompt,
    "stream": False,
    "think": False,          # <- this
},
```

That file belongs to the backend branch and is not changed here. Until it
is, raise the timeout instead.

Two things that look like fixes and are not: `"/no_think"` as a system
prompt is ignored by Ollama 0.34, and setting `think` as a model-level
parameter via `/api/create` is accepted and then ignored. Worse, capping
`num_predict` on such a variant starves the answer, because the cap counts
thinking tokens too - it returns `done_reason: length` with an **empty**
response. Both were tried against the live server.

### Keeping the model in VRAM

Already handled: `expires_at` on the loaded model reads year 2318, and it
stays there after a request that sends no `keep_alive`, so
`OLLAMA_KEEP_ALIVE` is set server-side on the home PC. Nothing to do.

To pin it manually from any machine on the tailnet:

```bash
curl http://100.64.88.63:11434/api/generate \
  -d '{"model":"qwen3:8b","keep_alive":"24h"}'
```

An empty prompt loads the model without generating. Use `-1` instead of
`"24h"` for indefinite. Note that a later request that omits `keep_alive`
resets the timer to the server default, which is why the server-side
`OLLAMA_KEEP_ALIVE` is the durable answer rather than a one-off curl.

## The QR / mobile view

The reliable half of the AR pitch: stick a QR code on the actual machine,
scan it, get that machine's live status in large type.

```
http://<host>:5173/?view=mobile&room=corridor_a&target=equip_1
```

`target` is matched against `MARKERS` in `src/roomLayout.js`, and which
readings are shown depends on what it is — the equipment marker shows surface
temperature and vibration, a camera shows occupancy, the sensor node shows
air readings.

### Generating the codes

```bash
node ../scripts/make-qr.mjs 192.168.1.50:5173
```

or from `frontend/`:

```bash
npm run qr -- 192.168.1.50:5173
```

The host is an argument (or `QR_HOST`) because the venue address is not known
until the hotspot is up — **regenerate the codes once it is**. PNGs land in
`scripts/qr/`, one per marker plus one for the room entrance, each named after
the marker it belongs on, alongside `print-sheet.html` which lays them all out
with their labels underneath for printing in one pass.

---

## The AR camera layer (optional, off by default)

With `VITE_ENABLE_AR=1`, the mobile view renders the phone's rear camera as a
full-screen background with the status panel over it. That gives the AR look —
live status superimposed on the actual equipment — without WebXR.

**`getUserMedia` requires a secure context.** Over plain HTTP on a LAN address
the camera request fails on both iOS Safari and Android Chrome. When the
camera is unavailable for any reason, the view falls back silently to the
normal opaque mobile view: never a black screen, never an error page. The QR
flow works perfectly with AR disabled.

### Serving over HTTPS

Generate a self-signed certificate:

```bash
openssl req -x509 -newkey rsa:2048 -nodes -days 365 \
  -keyout localhost-key.pem -out localhost-cert.pem \
  -subj "/CN=localhost"
```

Add it to `vite.config.js` inside `server`:

```js
https: {
  key: fs.readFileSync("./localhost-key.pem"),
  cert: fs.readFileSync("./localhost-cert.pem"),
},
```

(`import fs from "node:fs";` at the top.) Then `npm run dev` serves over
`https://<address>:5173`. The phone will show a certificate warning — tap
through it once per device, which needs a spare minute before the demo, not
during it.

Deliberately not using `@vitejs/plugin-basic-ssl`: it is one more dependency
for something a four-line config change already does.

**If this fights back, demo the QR flow and describe the camera layer as
roadmap.** It is the lowest-priority item in the whole project and the QR view
already delivers the pitch.

---

## The 3D room

By default the twin draws a simple box room from the dimensions in
`src/roomLayout.js`. The scene supports a textured mesh and a photographic
Gaussian splat, with a control above the canvas for switching between them.

### Using a real scan

1. Capture the room with a scanner that can export a textured mesh or a
   Gaussian reconstruction. Walk slowly, keep heavy overlap, and capture
   high, level, and low passes while the scene stays still.
2. For this setup, export the mesh as **GLB** with embedded textures, or the
   Gaussian reconstruction as a compatible **Gaussian-splat PLY**. A generic
   point-cloud/mesh PLY does not contain the same attributes as a splat export.
3. Save them as `frontend/public/scans/table-mesh.glb` and
   `frontend/public/scans/table-gaussian.ply`, or set `VITE_ROOM_MESH` and
   `VITE_ROOM_SPLAT` to different paths under `public/`.
4. Reload and use the **Mesh / Gaussian** control above the 3D view.
5. If either looks misaligned, adjust its block under `ROOM_MODEL` in
   `src/roomLayout.js`.

Captured scans are not included in Git. If a scan is absent or its loader
reports an error, the scene is designed to fall back to a box room. Test large
files on the actual device; fallback handling cannot guarantee recovery from
browser/GPU memory exhaustion.

Test the loader before you have a scan:

Set this in `frontend/.env.local`, then restart Vite:

```ini
VITE_ROOM_MESH=/room-sample.glb
```

### Fixing up a scan

Everything is in the `ROOM_MODEL.mesh` and `ROOM_MODEL.gaussian` blocks in
`src/roomLayout.js`:

| Field | What it does |
|---|---|
| `mesh.autoFit` | Measures the mesh and fits its footprint to `ROOM`, dropping the floor to y=0. Leave this on. |
| `rotationY` | Degrees. Usually the only thing you need to change: scans rarely come out facing the way you want. |
| `scale` | Extra multiplier for the selected representation. Gaussian splats use this directly because distant background splats make automatic bounds unreliable. |
| `offset` | Metres, after autoFit centring. |
| `mesh.clipHeight` | Slices the mesh above this height for a dollhouse view. `null` shows the complete mesh. |
| `gaussian.focalAdjustment` | Controls splat sharpness. The default favours image quality. |

The contents of `public/scans/` are Git-ignored except for its setup guide.
Supply scan files separately on each frontend laptop. You may optionally
provide `public/scans/table-gaussian.ply.gz`; `npm run dev` and `npm run build`
unpack it into `table-gaussian.ply` if the raw file is absent. No archive means
this preparation step is skipped. Existing local PLY files are preserved;
move an old PLY aside before unpacking a replacement archive.

See the [scan setup guide](public/scans/README.md) for formats and paths.
Back up tracked scans outside your checkout before pulling the removal commit,
then restore them locally. Earlier Git history still contains the old assets.
Git-ignored scans are still publicly served by Vite and copied into builds if
present, so keep sensitive originals outside `public/`.

When running the frontend on another laptop, set `VITE_CAM1_HOST` and
`VITE_CAM2_HOST` in its `.env` to the laptops running `cv/producer.py`, including
ports (for example `camera-laptop:8010` and `camera-laptop:8011`). Restart Vite
after changing them. These are the inference laptop addresses, not the Pixel's
IP Webcam address; the Pixel's video URL is passed to the producer's `--source`.

Marker positions in `MARKERS` are in metres in the same frame, so once the
scan is aligned the sensor node and the AC unit sit where they really are.
Each marker can also carry a `model` pointing at its own GLB under `public/`.

### Placing sensor markers

Open **Place markers** in the 3D view, choose a marker, and click its physical
location on the Mesh scan. The raycast produces a real world-space coordinate;
X/Y/Z inputs provide 5 cm fine-tuning. Positions are saved in this browser's
local storage, and **Copy JSON** exports every coordinate for transferring the
final values into `MARKERS` in `src/roomLayout.js`. Placement deliberately uses
the triangle mesh: a 2D detector can suggest cables or electronics in a camera
frame, but without registered camera depth it cannot recover a trustworthy 3D
location in the scan.

---

## People in the room

With the CV producers calibrated, the twin shows **where** people are, not
just how many. Each detection becomes a figure standing at its real position
on the floor, updating about once a second and easing between positions so it
glides rather than teleports.

Someone visible to both cameras gets a second ring and a lighter colour —
that detection is confirmed by two independent views rather than being one
camera's guess.

This data does **not** come through the backend. Its `/cv` schema is fixed and
has no field for positions, so each producer serves them from the camera
laptop itself and Vite proxies them:

```
browser ──/cam1/positions──▶ Vite ──▶ http://<VITE_CAM1_HOST>/positions
browser ──/cam2/positions──▶ Vite ──▶ http://<VITE_CAM2_HOST>/positions
```

A camera laptop that is off, unreachable or uncalibrated contributes nobody,
and the occupancy panel says which of those it is. The fused occupancy count
from the backend is unaffected either way.

See [`cv/README.md`](../cv/README.md) for calibration.

### Camera views

The **Camera views** panel shows the frame each producer actually ran
inference on, with its detection boxes drawn — confidence, the floor
coordinates that detection produced, and a dot on the point used to place it.

This is how you tell whether YOLO is boxing people or boxing a coat rack. The
counts and the figures in the 3D room look equally confident either way.

Frames are polled at 2 fps rather than streamed: a stalled MJPEG stream
freezes without saying so, whereas a failed request is unambiguous. **Pause
feeds** stops the polling — they are the heaviest thing on the network here,
so leave them off until someone asks to see them.

---

## Layout of the real room

`src/roomLayout.js` has an `EDIT ME` block at the top holding the room
dimensions and every marker position in metres. Adjust it by hand once the
hardware is physically mounted — nothing else needs to change, and the QR
generator reads the same list so the stickers stay in sync.

---

## Notes on what the numbers mean

- **eCO₂** is *estimated* CO₂ from the ENS160's VOC sensor, not a true NDIR
  measurement. It is labelled eCO₂ everywhere and never CO₂.
- **AQI** is an index from 1 to 5, not a percentage.
- The **anomaly score** is a raw deviation score from an unsupervised
  Isolation Forest. It is not an accuracy, a confidence or a probability —
  there is no labelled fault data to validate it against, and the UI says so
  next to the number.
- A **missing reading renders as an em dash**, never as `0`.
- The **stale dot** on a tile means the value has not changed in 30s. The
  WebSocket payload carries one timestamp for the whole room and the backend
  re-sends the last stored value for a sensor that has stopped reporting, so
  "unchanged" is the only freshness signal actually available.

---

## Known backend gap

`suggestions` is persisted and returned by `GET /room-status`, but it is not a
field on the backend's `WSMessage` model, so it is not broadcast over the
socket. The frontend handles both: it reads `suggestions` off the socket
message when present and otherwise polls `/room-status/{room_id}`.

Adding `suggestions: List[str] = []` to `WSMessage` in
`backend/app/schemas/ws.py` (and passing it through in `fusion.py`) would
remove the extra poll. That file belongs to the backend branch — not changed
here.
