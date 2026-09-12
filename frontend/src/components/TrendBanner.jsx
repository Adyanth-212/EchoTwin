import { SENSOR_META, TREND_ALERT_MINUTES, sensorLabel } from "../config.js";

// The early-warning feature: linear extrapolation over recent readings giving
// an estimated time until a metric crosses its threshold. This is the whole
// point of storing a time series, so it gets banner treatment rather than a
// line of small print.
export default function TrendBanner(props) {
  const trend = (props.room && props.room.trend) || null;
  const minutes =
    trend && trend.time_to_threshold_minutes !== undefined
      ? trend.time_to_threshold_minutes
      : null;

  if (minutes === null || !trend.metric) {
    return (
      <div className="trend-quiet">
        No metric is trending toward its threshold.
      </div>
    );
  }

  const meta = SENSOR_META[trend.metric] || {};
  const threshold = meta.warn;
  const rounded = Math.max(0, Math.round(minutes));
  const isUrgent = minutes <= TREND_ALERT_MINUTES;

  return (
    <div className="trend-banner" data-urgent={String(isUrgent)}>
      <div className="trend-clock num">~{rounded} min</div>
      <div className="trend-copy">
        <div className="trend-headline">
          {sensorLabel(trend.metric)} trending toward
          {threshold !== undefined
            ? " " + threshold + (meta.unit ? " " + meta.unit : "")
            : " its threshold"}
        </div>
        <div className="trend-sub">
          Estimated from the recent rate of change — early warning, not a
          guarantee.
        </div>
      </div>
    </div>
  );
}
