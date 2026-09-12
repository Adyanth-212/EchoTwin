import { SENSOR_META, STALE_AFTER_MS, formatValue, severityFor } from "../config.js";

// Direction of travel from the rolling WS history. Compares the newest value
// against the most recent value that differs from it, so a series that has
// been flat for a few samples still shows the last real move rather than
// flickering between arrow and dash.
function trendDirection(series) {
  if (!Array.isArray(series) || series.length < 2) {
    return "flat";
  }
  const newest = series[series.length - 1].v;
  for (let index = series.length - 2; index >= 0; index -= 1) {
    const candidate = series[index].v;
    if (candidate !== newest) {
      return candidate < newest ? "up" : "down";
    }
  }
  return "flat";
}

const ARROW = { up: "▲", down: "▼", flat: "—" };

export default function SensorTile(props) {
  const key = props.sensorKey;
  const meta = SENSOR_META[key] || {};
  const value = props.value;

  const isMissing = value === null || value === undefined;
  const severity = severityFor(key, value);
  const direction = meta.boolean ? "flat" : trendDirection(props.series);

  // The WS payload carries one timestamp for the whole room, not per sensor,
  // and the backend re-sends the last stored value for a sensor that has
  // stopped reporting. So the only honest freshness signal is how long this
  // value has been unchanged. Boolean sensors are exempt: a trip flag sitting
  // at "Clear" is the normal case, not a stale reading.
  const changedAt = props.changedAt;
  const isStale =
    !meta.boolean &&
    !isMissing &&
    changedAt !== undefined &&
    props.now - changedAt > STALE_AFTER_MS;

  return (
    <div className="tile" data-severity={severity}>
      <div className="tile-head">
        <span className="tile-label" title={meta.label}>
          {meta.short || key}
        </span>
        {isStale ? (
          <span
            className="tile-stale"
            title={
              "Unchanged for " +
              Math.round((props.now - changedAt) / 1000) +
              "s — this sensor may have stopped reporting"
            }
          />
        ) : null}
      </div>

      <div className="tile-value-row">
        <span className="tile-value num" data-missing={String(isMissing)}>
          {formatValue(key, value)}
        </span>
        {meta.unit ? <span className="tile-unit">{meta.unit}</span> : null}
        <span className="tile-trend" data-dir={direction} title={"Trend: " + direction}>
          {ARROW[direction]}
        </span>
      </div>

      {meta.note ? <div className="tile-note">{meta.note}</div> : null}
    </div>
  );
}
