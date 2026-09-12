import { useEffect, useState } from "react";
import { SENSOR_KEYS } from "../config.js";
import SensorTile from "./SensorTile.jsx";

export default function SensorGrid(props) {
  const sensors = (props.room && props.room.sensors) || {};
  const history = props.history || {};
  const changedAt = props.changedAt || {};

  // Drives the staleness dots only. One second is plenty and keeps this off
  // any animation frame loop.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <section className="panel">
      <div className="panel-head">
        <span className="microlabel">Sensor readings</span>
        <span className="microlabel">
          {props.room ? "9 channels" : "awaiting data"}
        </span>
      </div>

      <div className="sensor-grid">
        {SENSOR_KEYS.map((key) => (
          <SensorTile
            key={key}
            sensorKey={key}
            value={sensors[key]}
            series={history[key]}
            changedAt={changedAt[key]}
            now={now}
          />
        ))}
      </div>
    </section>
  );
}
