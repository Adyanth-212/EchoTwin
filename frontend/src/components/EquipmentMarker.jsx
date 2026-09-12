import { Suspense } from "react";
import { Html } from "@react-three/drei";
import MarkerModel from "./MarkerModel.jsx";
import MarkerStem from "./MarkerStem.jsx";
import ModelFallback from "./ModelFallback.jsx";
import { SENSOR_META, STATUS_ORDER, formatValue, severityFor } from "../config.js";

const HEALTH_COLOR = {
  green: "#3fbf7f",
  yellow: "#f2a63b",
  red: "#f2645f",
  none: "#7686a6",
};

// Health of the monitored machine specifically — surface temperature and
// vibration, the pair the project's fusion pitch is built on — rather than
// the room's overall fused status. The worse of the two wins.
function equipmentHealth(sensors) {
  const readings = sensors || {};
  const first = severityFor("surface_temp", readings.surface_temp);
  const second = severityFor(
    "vibration_magnitude",
    readings.vibration_magnitude
  );

  if (first === "none" && second === "none") {
    return "none";
  }

  const firstLevel = STATUS_ORDER[first] === undefined ? -1 : STATUS_ORDER[first];
  const secondLevel =
    STATUS_ORDER[second] === undefined ? -1 : STATUS_ORDER[second];

  return firstLevel >= secondLevel ? first : second;
}

function EquipmentBox() {
  return (
    <mesh>
      <boxGeometry args={[0.9, 0.55, 0.38]} />
      <meshStandardMaterial color="#28324b" roughness={0.7} />
    </mesh>
  );
}

export default function EquipmentMarker(props) {
  const marker = props.marker;
  const sensors = props.sensors || {};
  const health = equipmentHealth(sensors);
  const color = HEALTH_COLOR[health];

  const surfaceUnit = SENSOR_META.surface_temp.unit;
  const vibrationUnit = SENSOR_META.vibration_magnitude.unit;

  return (
    <group position={marker.position}>
      <MarkerStem height={marker.position[1]} color={color} />
      {marker.model ? (
        <ModelFallback fallback={<EquipmentBox />}>
          <Suspense fallback={<EquipmentBox />}>
            <MarkerModel url={marker.model} fit={0.9} />
          </Suspense>
        </ModelFallback>
      ) : (
        <EquipmentBox />
      )}

      {/* Health indicator sits on the machine itself, so the state of the
          equipment is visible in the scene without opening a panel. */}
      <mesh position={[0.36, 0.18, 0.2]}>
        <sphereGeometry args={[0.07, 16, 16]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.85}
        />
      </mesh>

      <Html position={[0, 0.45, 0]} zIndexRange={[20, 0]}>
        <div className="marker-label">
          <div className="marker-label-title">
            <span
              className="marker-health"
              style={{ background: color }}
            />
            {marker.label}
          </div>
          <div className="marker-label-row">
            <span style={{ color: "var(--muted)" }}>Surface</span>
            <span className="marker-label-value num">
              {formatValue("surface_temp", sensors.surface_temp)} {surfaceUnit}
            </span>
          </div>
          <div className="marker-label-row">
            <span style={{ color: "var(--muted)" }}>Vibration</span>
            <span className="marker-label-value num">
              {formatValue("vibration_magnitude", sensors.vibration_magnitude)}{" "}
              {vibrationUnit}
            </span>
          </div>
        </div>
      </Html>
    </group>
  );
}
