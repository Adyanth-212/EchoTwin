# History API

The history endpoints read existing PostgreSQL/TimescaleDB data. They do not
change the MQTT or WebSocket contracts.

Interactive documentation is available at `http://<backend-host>:8000/docs`.

## Rooms with stored data

```http
GET /history/rooms
```

Response:

```json
{
  "rooms": ["corridor_a"]
}
```

## Sensor history

```http
GET /history/sensors?room_id=corridor_a&sensor=temperature&bucket=5m
```

Query parameters:

- `room_id` is required.
- `sensor` is optional. Omit it to return every sensor for the room.
- `from` and `to` are optional ISO 8601 timestamps with timezones. The default
  range is the 24 hours ending now.
- `bucket` is `raw`, `1m`, `5m`, `15m`, `1h`, `6h`, or `1d`. It defaults to
  `raw`.
- `limit` is between 1 and 5000 and defaults to 1000.

Every point contains `timestamp`, `node_id`, `sensor`, `value`, `min_value`,
`max_value`, and `sample_count`. For bucketed results, `value` is the average
for that interval.

Example with an explicit range:

```http
GET /history/sensors?room_id=corridor_a&from=2026-09-11T00:00:00Z&to=2026-09-12T00:00:00Z&bucket=1h
```

## Computer-vision history

```http
GET /history/cv-events?room_id=corridor_a&bucket=5m
```

The time range, bucket, and limit parameters work like sensor history.
`camera_id` is an optional filter. Bucketed occupancy is the average occupancy;
`max_occupancy` is the peak for the interval, and `unusual_activity` is true if
any event in the interval was unusual.

## Frontend examples

When the frontend runs on Akshay's tailnet, use the shared MagicDNS backend
hostname:

```text
http://sanjays-macbook-air.tail833b77.ts.net:8000/history/rooms
http://sanjays-macbook-air.tail833b77.ts.net:8000/history/sensors?room_id=corridor_a&sensor=temperature&bucket=5m
```

The top-level response includes `from`, `to`, `bucket`, `point_count`, and
`points`, so the frontend can show the selected range and detect an empty
result without special handling.
