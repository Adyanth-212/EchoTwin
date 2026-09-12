import { useMemo, useState } from "react";
import { SENSOR_META, sensorLabel } from "../config.js";
import {
  formatClock,
  linePath,
  makeScale,
  nearestIndex,
  runsWhere,
} from "../chartUtils.js";

// The correlation chart — the one picture of the project's actual claim, that
// no single sensor calls a fault alone and two independent signals rising
// together mean something neither does apart.
//
// Both series are plotted as a percentage of their OWN warning threshold.
// That is not decoration: two measures on different scales (°C and m/s²)
// cannot share a plot honestly any other way. A second y-axis would let the
// two scales be aligned arbitrarily, which invents a correlation that is not
// in the data — the single worst thing a chart of this kind can do. Indexing
// both to their thresholds puts them on one axis and makes the comparison the
// meaningful one anyway: how close is each to the line that matters.
//
// 100% is therefore the warning threshold for both, and the shaded stretches
// are where BOTH are at or past it — exactly the condition the backend's
// combined heat-and-vibration rule fires on.

const VIEW_WIDTH = 760;
const VIEW_HEIGHT = 260;
const PAD_LEFT = 54;
const PAD_RIGHT = 118;
const PAD_TOP = 18;
const PAD_BOTTOM = 34;

// Only sensors with a single upper warning threshold can be indexed this way.
// Humidity is bad in both directions and the trip sensor is a boolean.
const INDEXABLE = [
  "temperature",
  "surface_temp",
  "vibration_magnitude",
  "eco2",
  "tvoc",
  "aqi",
  "occupancy_count",
];

const SERIES_COLORS = ["var(--series-1)", "var(--series-2)"];

function toPercent(value, key) {
  const meta = SENSOR_META[key];
  if (!meta || meta.warn === undefined || value === null || value === undefined) {
    return null;
  }
  return (Number(value) / meta.warn) * 100;
}

// Stored history arrives as {timestamp, value}; the rolling series the socket
// hook keeps is {t, v}. Normalise once so the chart does not care which it got.
function normalise(points) {
  if (!Array.isArray(points)) {
    return [];
  }
  const out = [];
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const time =
      point.t !== undefined ? point.t : new Date(point.timestamp).getTime();
    const value = point.v !== undefined ? point.v : Number(point.value);
    if (Number.isFinite(time) && Number.isFinite(value)) {
      out.push({ t: time, v: value });
    }
  }
  return out;
}

// Align two independently-bucketed series onto one time axis by pairing each
// timestamp with the nearest sample from the other series.
function alignSeries(rawA, rawB, keyA, keyB) {
  const pointsA = normalise(rawA);
  const pointsB = normalise(rawB);

  if (pointsA.length === 0 || pointsB.length === 0) {
    return [];
  }

  const aligned = [];
  for (let index = 0; index < pointsA.length; index += 1) {
    const time = pointsA[index].t;
    const matchIndex = nearestIndex(pointsB, (point) => point.t, time);
    if (matchIndex === -1) {
      continue;
    }
    const percentA = toPercent(pointsA[index].v, keyA);
    const percentB = toPercent(pointsB[matchIndex].v, keyB);
    if (percentA === null || percentB === null) {
      continue;
    }
    aligned.push({
      t: time,
      a: percentA,
      b: percentB,
      rawA: pointsA[index].v,
      rawB: pointsB[matchIndex].v,
    });
  }
  return aligned;
}

export default function FusionChart(props) {
  // Defaults are the pair the backend's combined rule actually uses, so the
  // shading lines up with a rule that really fires rather than an illustrative
  // one.
  const [keyA, setKeyA] = useState("temperature");
  const [keyB, setKeyB] = useState("vibration_magnitude");
  const [hoverIndex, setHoverIndex] = useState(-1);

  const series = props.series || {};
  const live = props.liveHistory || {};

  // Prefer stored history; fall back to whatever this session has collected.
  // Without this the chart is empty in demo mode, which is exactly the mode
  // that exists for showing the dashboard with no backend at all.
  const pick = (key) => {
    const stored = series[key];
    return stored && stored.length >= 2 ? stored : live[key];
  };

  const points = useMemo(
    () => alignSeries(pick(keyA), pick(keyB), keyA, keyB),
    [series, live, keyA, keyB]
  );

  const chart = useMemo(() => {
    if (points.length < 2) {
      return null;
    }

    let maxPercent = 100;
    for (let index = 0; index < points.length; index += 1) {
      maxPercent = Math.max(maxPercent, points[index].a, points[index].b);
    }
    // Always keep the threshold line in view with a little air above it.
    const yMax = Math.ceil((maxPercent * 1.08) / 10) * 10;

    const scale = makeScale({
      xMin: points[0].t,
      xMax: points[points.length - 1].t,
      yMin: 0,
      yMax: yMax,
      left: PAD_LEFT,
      right: VIEW_WIDTH - PAD_RIGHT,
      top: PAD_TOP,
      bottom: VIEW_HEIGHT - PAD_BOTTOM,
    });

    // Both past their own threshold — the correlation the project is about.
    const bothOver = runsWhere(points, (point) => point.a >= 100 && point.b >= 100);

    return { scale: scale, yMax: yMax, bothOver: bothOver };
  }, [points]);

  const options = INDEXABLE.filter((key) => SENSOR_META[key].warn !== undefined);

  const controls = (
    <div className="history-controls">
      <select
        className="select"
        value={keyA}
        onChange={(event) => setKeyA(event.target.value)}
        aria-label="First sensor to correlate"
      >
        {options.map((key) => (
          <option value={key} key={key}>
            {SENSOR_META[key].label}
          </option>
        ))}
      </select>
      <span className="microlabel">vs</span>
      <select
        className="select"
        value={keyB}
        onChange={(event) => setKeyB(event.target.value)}
        aria-label="Second sensor to correlate"
      >
        {options.map((key) => (
          <option value={key} key={key}>
            {SENSOR_META[key].label}
          </option>
        ))}
      </select>
    </div>
  );

  if (chart === null) {
    return (
      <section className="panel">
        <div className="panel-head">
          <span className="microlabel">Correlated signals</span>
        </div>
        {controls}
        <p className="panel-empty">
          Not enough stored history yet to correlate these two.
        </p>
      </section>
    );
  }

  const { scale, yMax, bothOver } = chart;
  const last = points[points.length - 1];
  const active = hoverIndex >= 0 && hoverIndex < points.length ? points[hoverIndex] : null;

  const axisText = {
    fill: "var(--dim)",
    fontSize: "11px",
    fontVariantNumeric: "tabular-nums",
  };

  function handleMove(event) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - bounds.left) / bounds.width;
    const pixel = ratio * VIEW_WIDTH;
    setHoverIndex(nearestIndex(points, (point) => scale.x(point.t), pixel));
  }

  // Gridlines at sensible percentages, solid hairlines, one shade off the
  // surface — never dashed, which would read as a threshold.
  const gridValues = [];
  for (let value = 0; value <= yMax; value += yMax > 250 ? 100 : 50) {
    gridValues.push(value);
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <span className="microlabel">Correlated signals</span>
        <span className="microlabel">% of each sensor's warning threshold</span>
      </div>

      {controls}

      <div className="chart-legend">
        <span className="chart-legend-item">
          <span
            className="chart-swatch"
            style={{ background: SERIES_COLORS[0] }}
          />
          {sensorLabel(keyA)}
        </span>
        <span className="chart-legend-item">
          <span
            className="chart-swatch"
            style={{ background: SERIES_COLORS[1] }}
          />
          {sensorLabel(keyB)}
        </span>
        {bothOver.length > 0 ? (
          <span className="chart-legend-item">
            <span className="chart-swatch chart-swatch-band" />
            both past threshold
          </span>
        ) : null}
      </div>

      <svg
        className="spark"
        viewBox={"0 0 " + VIEW_WIDTH + " " + VIEW_HEIGHT}
        role="img"
        aria-label={
          sensorLabel(keyA) +
          " and " +
          sensorLabel(keyB) +
          " as a percentage of their warning thresholds over time"
        }
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverIndex(-1)}
      >
        {/* Stretches where both signals are past their own threshold. This is
            the fusion rule firing, drawn rather than described. */}
        {bothOver.map((run) => {
          const startX = scale.x(points[run[0]].t);
          const endX = scale.x(points[run[1]].t);
          return (
            <rect
              key={"band-" + run[0]}
              x={startX}
              y={PAD_TOP}
              width={Math.max(2, endX - startX)}
              height={scale.plotHeight}
              style={{ fill: "var(--red)", opacity: 0.14 }}
            />
          );
        })}

        {gridValues.map((value) => (
          <g key={"grid-" + value}>
            <line
              x1={scale.left}
              y1={scale.y(value)}
              x2={scale.right}
              y2={scale.y(value)}
              style={{ stroke: "var(--hairline)", strokeWidth: 1, fill: "none" }}
            />
            <text
              x={scale.left - 8}
              y={scale.y(value) + 4}
              textAnchor="end"
              style={axisText}
            >
              {value}%
            </text>
          </g>
        ))}

        {/* The threshold itself. Dashed because it is a threshold, not a
            gridline — the grid above is solid so the two never read alike. */}
        <line
          x1={scale.left}
          y1={scale.y(100)}
          x2={scale.right}
          y2={scale.y(100)}
          style={{
            stroke: "var(--yellow)",
            strokeWidth: 1.5,
            strokeDasharray: "5 4",
            fill: "none",
          }}
        />
        {/* Labelled at the left, above the rule. On the right it collided with
            the end-of-line values whenever a series finished near 100%. */}
        <text
          x={scale.left + 4}
          y={scale.y(100) - 6}
          style={{ fill: "var(--yellow)", fontSize: "10px" }}
        >
          warning threshold
        </text>

        <path
          d={linePath(points, scale, (p) => p.t, (p) => p.a)}
          style={{
            fill: "none",
            stroke: SERIES_COLORS[0],
            strokeWidth: 2,
            strokeLinejoin: "round",
            strokeLinecap: "round",
          }}
        />
        <path
          d={linePath(points, scale, (p) => p.t, (p) => p.b)}
          style={{
            fill: "none",
            stroke: SERIES_COLORS[1],
            strokeWidth: 2,
            strokeLinejoin: "round",
            strokeLinecap: "round",
          }}
        />

        {/* Direct labels at the end of each line: identity without relying on
            colour alone, and without a number on every point. */}
        <circle
          cx={scale.x(last.t)}
          cy={scale.y(last.a)}
          r="3.5"
          style={{ fill: SERIES_COLORS[0], stroke: "var(--panel)", strokeWidth: 2 }}
        />
        <text
          x={scale.x(last.t) + 8}
          y={scale.y(last.a) + 4}
          style={{
            fill: "var(--text)",
            fontSize: "11px",
            fontWeight: 600,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {Math.round(last.a) + "%"}
        </text>
        <circle
          cx={scale.x(last.t)}
          cy={scale.y(last.b)}
          r="3.5"
          style={{ fill: SERIES_COLORS[1], stroke: "var(--panel)", strokeWidth: 2 }}
        />
        <text
          x={scale.x(last.t) + 8}
          y={scale.y(last.b) + 4}
          style={{
            fill: "var(--text)",
            fontSize: "11px",
            fontWeight: 600,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {Math.round(last.b) + "%"}
        </text>

        <text x={scale.left} y={VIEW_HEIGHT - 10} style={axisText}>
          {formatClock(points[0].t)}
        </text>
        <text
          x={scale.right}
          y={VIEW_HEIGHT - 10}
          textAnchor="end"
          style={axisText}
        >
          {formatClock(last.t)}
        </text>

        {/* Hover crosshair */}
        {active ? (
          <g>
            <line
              x1={scale.x(active.t)}
              y1={PAD_TOP}
              x2={scale.x(active.t)}
              y2={PAD_TOP + scale.plotHeight}
              style={{ stroke: "var(--muted)", strokeWidth: 1, opacity: 0.6 }}
            />
            <circle
              cx={scale.x(active.t)}
              cy={scale.y(active.a)}
              r="4"
              style={{ fill: SERIES_COLORS[0], stroke: "var(--panel)", strokeWidth: 2 }}
            />
            <circle
              cx={scale.x(active.t)}
              cy={scale.y(active.b)}
              r="4"
              style={{ fill: SERIES_COLORS[1], stroke: "var(--panel)", strokeWidth: 2 }}
            />
          </g>
        ) : null}
      </svg>

      <div className="chart-readout">
        {active ? (
          <>
            <span className="num">{formatClock(active.t)}</span>
            <span>
              {sensorLabel(keyA)}{" "}
              <strong className="num">
                {active.rawA.toFixed(SENSOR_META[keyA].decimals)}
              </strong>{" "}
              {SENSOR_META[keyA].unit}
              <span className="chart-readout-pct num">
                {" (" + Math.round(active.a) + "%)"}
              </span>
            </span>
            <span>
              {sensorLabel(keyB)}{" "}
              <strong className="num">
                {active.rawB.toFixed(SENSOR_META[keyB].decimals)}
              </strong>{" "}
              {SENSOR_META[keyB].unit}
              <span className="chart-readout-pct num">
                {" (" + Math.round(active.b) + "%)"}
              </span>
            </span>
          </>
        ) : bothOver.length > 0 ? (
          <span>
            Both signals crossed their thresholds together in the shaded
            stretches — the pattern neither reading shows alone.
          </span>
        ) : (
          <span>Hover the chart to read both values at a point in time.</span>
        )}
      </div>
    </section>
  );
}
