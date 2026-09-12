import { SENSOR_KEYS, SENSOR_META, formatValue, severityFor } from "../config.js";
import { linePath, makeScale } from "../chartUtils.js";

// Small multiples: every numeric sensor at once, each against its own
// threshold, instead of one at a time behind a dropdown.
//
// One series per facet, so there is no identity to encode and every facet
// uses the same colour — a value-ramp across facets would double-encode
// magnitude as hue for no gain. Severity is carried by the value's own
// colour and the threshold rule, not by the line.

const FACET_WIDTH = 240;
const FACET_HEIGHT = 68;
const PAD = 4;

function Facet(props) {
  const key = props.sensorKey;
  const meta = SENSOR_META[key];
  const points = props.points || [];

  if (points.length < 2) {
    return (
      <div className="facet">
        <div className="facet-head">
          <span className="facet-label">{meta.short || key}</span>
          <span className="facet-value num" data-missing="true">—</span>
        </div>
        <div className="facet-empty">no history yet</div>
      </div>
    );
  }

  let minValue = points[0].v;
  let maxValue = points[0].v;
  for (let index = 1; index < points.length; index += 1) {
    minValue = Math.min(minValue, points[index].v);
    maxValue = Math.max(maxValue, points[index].v);
  }

  let yMin = minValue;
  let yMax = maxValue;
  if (meta.warn !== undefined) {
    yMax = Math.max(yMax, meta.warn);
  }
  if (yMax === yMin) {
    yMax = yMin + 1;
  }
  const padding = (yMax - yMin) * 0.12;
  yMin = yMin - padding;
  yMax = yMax + padding;

  const scale = makeScale({
    xMin: points[0].t,
    xMax: points[points.length - 1].t,
    yMin: yMin,
    yMax: yMax,
    left: PAD,
    right: FACET_WIDTH - PAD,
    top: PAD,
    bottom: FACET_HEIGHT - PAD,
  });

  const last = points[points.length - 1];
  const severity = severityFor(key, last.v);

  const area =
    linePath(points, scale, (p) => p.t, (p) => p.v) +
    " L" + scale.x(last.t).toFixed(2) + " " + (FACET_HEIGHT - PAD).toFixed(2) +
    " L" + scale.x(points[0].t).toFixed(2) + " " + (FACET_HEIGHT - PAD).toFixed(2) +
    " Z";

  return (
    <div className="facet">
      <div className="facet-head">
        <span className="facet-label" title={meta.label}>
          {meta.short || key}
        </span>
        <span className="facet-value num" data-severity={severity}>
          {formatValue(key, last.v)}
          {meta.unit ? <span className="facet-unit"> {meta.unit}</span> : null}
        </span>
      </div>

      <svg
        className="facet-svg"
        viewBox={"0 0 " + FACET_WIDTH + " " + FACET_HEIGHT}
        role="img"
        aria-label={
          meta.label + " now " + formatValue(key, last.v) + " " + (meta.unit || "")
        }
      >
        <defs>
          <linearGradient id={"facet-" + key} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--series-1)" stopOpacity="0.3" />
            <stop offset="100%" stopColor="var(--series-1)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {meta.warn !== undefined && meta.warn <= yMax && meta.warn >= yMin ? (
          <line
            x1={PAD}
            y1={scale.y(meta.warn)}
            x2={FACET_WIDTH - PAD}
            y2={scale.y(meta.warn)}
            style={{
              stroke: "var(--yellow)",
              strokeWidth: 1,
              strokeDasharray: "4 4",
              opacity: 0.55,
              fill: "none",
            }}
          />
        ) : null}

        <path d={area} style={{ fill: "url(#facet-" + key + ")" }} />
        <path
          d={linePath(points, scale, (p) => p.t, (p) => p.v)}
          style={{
            fill: "none",
            stroke: "var(--series-1)",
            strokeWidth: 1.6,
            strokeLinejoin: "round",
            strokeLinecap: "round",
          }}
        />
        <circle
          cx={scale.x(last.t)}
          cy={scale.y(last.v)}
          r="2.8"
          style={{ fill: "var(--series-1)", stroke: "var(--raised)", strokeWidth: 1.5 }}
        />
      </svg>
    </div>
  );
}

export default function SensorSparkGrid(props) {
  const series = props.series || {};
  const live = props.liveHistory || {};

  const keys = SENSOR_KEYS.filter((key) => !SENSOR_META[key].boolean);

  return (
    <section className="panel">
      <div className="panel-head">
        <span className="microlabel">All channels</span>
        <span className="microlabel">dashed line = warning threshold</span>
      </div>

      <div className="facet-grid">
        {keys.map((key) => {
          const stored = (series[key] || []).map((point) => ({
            t: new Date(point.timestamp).getTime(),
            v: Number(point.value),
          }));
          const points = stored.length >= 2 ? stored : live[key] || [];
          return <Facet key={key} sensorKey={key} points={points} />;
        })}
      </div>
    </section>
  );
}
