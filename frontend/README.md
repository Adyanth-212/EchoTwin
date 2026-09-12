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
| `VITE_BACKEND_HOST` | `sanjays-macbook-air.tail833b77.ts.net:8000` | Backend host:port. Read by `vite.config.js` only; both REST and WebSocket follow it. **Restart the dev server after changing it.** |
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
