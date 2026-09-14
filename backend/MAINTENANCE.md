# Maintenance watcher — `main-testing`

An optional worker on the **backend laptop**, not a new model and not a
browser timer. It reads stored sensor/CV data, records incidents in PostgreSQL,
and asks the existing home-PC Qwen3:8b for bounded inspection suggestions.
The frontend laptop displays those incidents and sends operator actions.
Closing the dashboard does not stop the worker.

## Behaviour

- Full review every **180 seconds**, looking back **300 seconds**.
- Additional critical-condition checks on a **15-second target interval**.
  This is not a hard real-time guarantee: database/provider/model latency can
  delay a cycle. Only one explanation is generated per tick.
- Existing sensor rules must persist for **120 seconds** for a warning, or
  **30 seconds** for a critical incident. Gaps break continuity; one spike does
  not satisfy a sustained-threshold rule.
- Combined sustained air temperature >=30 C and vibration >=2.5 m/s² can
  trigger a critical incident. These are demo rules, not manufacturer limits.
- Linear trends are advisory. Multi-sensor anomalies use sufficiently covered
  window means and the existing synthetic-trained baseline, not a validated
  equipment-failure predictor. Neither alone triggers a call.
- Sensor and camera samples older than **30 seconds** become missing/stale
  warnings at the next full review. Equal successive values can still be fresh.
  Both source timestamps and database arrival timestamps are checked. Old
  rows have unknown arrival times; the migration does not invent them.
- One active incident per room/condition. It survives restarts. The third
  distinct occurrence in 24 hours requests deeper inspection. Replacement is
  only a suggestion after a technician confirms a fault, never an automatic action.
- Acknowledge suppresses further notifications for that incident. Resolve closes
  it, but a still-present condition must clear before a new incident can open.
  Clearing a condition alone does not resolve it: an operator must confirm.

## Start without replacing the demo backend

Use the existing `backend` Compose project. The database must already have
been initialized by the main backend. Do not start a second MQTT backend to
run this feature. First check the existing stack:

```bash
cd /path/to/EchoTwin/backend
docker compose ps -a
```

If intentionally stopped, start the existing demo containers when you are ready:

```bash
docker start backend-postgres-1 backend-mosquitto-1 backend-fastapi-1
```

Then build/start **only** the experimental sidecars:

```bash
MAINTENANCE_NOTIFICATION_MODE=dry_run docker compose --profile maintenance build maintenance-api maintenance-worker
MAINTENANCE_NOTIFICATION_MODE=dry_run docker compose --profile maintenance up -d --no-deps --wait maintenance-api
MAINTENANCE_NOTIFICATION_MODE=dry_run docker compose --profile maintenance up -d --no-deps maintenance-worker
curl http://localhost:8002/maintenance/status
docker compose --profile maintenance logs --tail 30 maintenance-worker
```

The API runs on port **8002**; the existing backend remains on **8000**.
These services use the root `.env` and the same database. Schema changes are
additive: receipt-time columns plus `maintenance_*` tables. Raw sensor/CV
30-day retention is unchanged. Incident/notification history is retained
indefinitely for this demo; plan archival before a production deployment.

To stop just this feature:

```bash
docker compose --profile maintenance stop maintenance-worker maintenance-api
```

Do not run `down -v` on the demo stack; it deletes the database volume.

## Frontend laptop

Use the reviewed `main-testing` code (coordinate sharing/commits first).
In `frontend/.env.local`, keep the existing backend/camera settings and add:

```ini
VITE_MAINTENANCE_HOST=192.0.2.10:8002
```

Replace the IP if it changed. Use `host:port` without `http://`, then restart
`npm run dev`. Vite proxies `/api/maintenance` separately; other dashboard
requests still reach the normal backend. If you instead deploy the updated
integrated FastAPI on port 8000, omit this setting because it also exposes the
maintenance routes. A static production host needs equivalent reverse-proxy
routes; the Vite development proxy is not bundled into static build assets.

The panel shows worker status, full-review time, source freshness, evidence,
guidance, incident history, **Review now**, **Acknowledge**, and **Resolve**.
`VITE_DEMO=1` deliberately disables maintenance requests in that browser; it
does not stop a separately running worker.

## Settings

See the root `.env.example` for all defaults. Important adjustments:

- `MAINTENANCE_SAMPLE_SECONDS=1` for the one-second serial bridge; use the
  actual cadence (for example 7.5 for firmware MQTT) so coverage/gap checks work.
- `MAINTENANCE_ROOMS=corridor_a` and `MAINTENANCE_CAMERAS=cam1,cam2` must match
  stored IDs. An empty camera list disables camera-missing warnings.
- `MAINTENANCE_USE_LLM=0` skips explanations from Ollama. Otherwise the worker
  uses the existing `TAILSCALE_OLLAMA_URL`, `OLLAMA_MODEL=qwen3:8b` and timeout.
  Requests have `think:false` and a structured response schema. Invalid/slow
  responses fall back to rules; incident detection continues without Ollama.
- Qwen receives the incident, recurrence count, five-minute sensor summaries,
  freshness and camera counts. It does **not** receive video, raw image frames,
  phone numbers, provider credentials or the entire historical database.

## Calls: safe by default

`MAINTENANCE_NOTIFICATION_MODE=dry_run` records **Would call maintenance**
without making any provider request. `disabled` records no notification.
Only **open, currently observed critical** incidents are eligible. Warning,
trend, missing-source and anomaly incidents remain in the dashboard.

There is one attempt per incident/mode and a global **15-minute cooldown**.
A second incident waits until the cooldown expires and is eligible only if
still critical then. Switching from dry run to live can call for an existing
eligible incident: review the incident list before enabling live mode.

Real calling requires separate approval, a consenting demo recipient and:

```ini
MAINTENANCE_NOTIFICATION_MODE=twilio
TWILIO_ACCOUNT_SID=your_account_sid
TWILIO_AUTH_TOKEN=your_secret
TWILIO_FROM_NUMBER=your_provider_number_in_E164_format
MAINTENANCE_CALL_TO=the_approved_recipient_in_E164_format
```

Keep secrets only in ignored environment files. For Compose interpolation,
pass `--env-file ../.env` to Compose when enabling the mode, then recreate both
sidecars. Until that deliberate change, the commands above force dry run.
Provider account permissions, verified destinations and regional restrictions
still apply. Actual dialing is not covered by the automated tests.

Call text is deterministic, not unconstrained LLM output. Provider submission
is shown as submitted, not answered. The worker polls call status; completed
does not mean the maintenance team acknowledged the incident. An ambiguous
timeout/interrupted dispatch is **unknown** and is not automatically retried.

This is a private, trusted-network hackathon feature. The existing API and
these operator endpoints have no user authentication. Do not expose them
publicly; add authentication, authorization, auditing and operational safety
review before production use. This is not an emergency-response system.

## Validate safely

Run the regression suite in a separate, ephemeral database with no production
ports, broker or data volume. It disables Ollama and mocks every provider call:

```bash
cd /path/to/EchoTwin/backend
docker compose -p echotwin-maintenance-tests -f compose.maintenance-test.yml up -d --wait postgres
docker compose -p echotwin-maintenance-tests -f compose.maintenance-test.yml build tests
docker compose -p echotwin-maintenance-tests -f compose.maintenance-test.yml run --rm tests
docker compose -p echotwin-maintenance-tests -f compose.maintenance-test.yml down
```

Tests cover persistence/gaps, stale and future data, equal/duplicate samples,
trend and combined conditions, recurrence, deduplication, operator actions,
cooldown, ambiguous calls, call-status reporting, worker leadership, schema
arrival times, and existing MQTT/AskTwin regressions. Integration tests refuse
to run destructive fixtures unless explicitly enabled for `maintenance_test`.

For a live **read-only** check after starting the sidecars:

```bash
curl http://localhost:8002/maintenance/status
curl 'http://localhost:8002/maintenance/incidents?room_id=corridor_a'
```

Check `running:true`, `mode:dry_run`, an advancing heartbeat and current source
timestamps. Review now queues work for the next worker tick; requests are
rate-limited to one per 15 seconds. Stopping a source should create a warning
after the next full review, not a fake zero or an equipment-failure call.
Do not heat, damage or shake equipment dangerously to demonstrate an alert;
use the isolated synthetic test fixtures for critical conditions.
