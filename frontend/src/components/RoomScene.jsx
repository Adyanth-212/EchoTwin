import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { MARKERS, ROOM } from "../roomLayout.js";
import { SENSOR_META, formatValue } from "../config.js";
import RoomShell from "./RoomShell.jsx";
import SensorMarker from "./SensorMarker.jsx";
import EquipmentMarker from "./EquipmentMarker.jsx";

// The 3D twin is the primary view of the room, driven by the same fused
// WebSocket state as every panel on the page — not a decoration running off
// its own data.
//
// Deliberately no useFrame anywhere in this subtree: nothing animates per
// frame, so React only re-renders the scene when a message actually arrives.
// dpr is capped so a retina laptop does not render at 3x for no visible gain.

function sensorRows(sensors) {
  return [
    {
      label: "Air",
      value:
        formatValue("temperature", sensors.temperature) +
        " " +
        SENSOR_META.temperature.unit,
    },
    {
      label: "eCO₂",
      value:
        formatValue("eco2", sensors.eco2) + " " + SENSOR_META.eco2.unit,
    },
  ];
}

function peopleLabel(count) {
  return String(count) + (count === 1 ? " person" : " people");
}

function cameraRows(marker, sensors, cameraCounts) {
  const known = cameraCounts && cameraCounts[marker.id];
  if (known !== undefined && known !== null) {
    return [{ label: "Occupancy", value: peopleLabel(known) }];
  }
  // No event from this camera yet — show the room total rather than a zero
  // that would read as "nobody is there".
  return [
    {
      label: "Room total",
      value:
        sensors.occupancy_count === null || sensors.occupancy_count === undefined
          ? "—"
          : peopleLabel(sensors.occupancy_count),
    },
  ];
}

export default function RoomScene(props) {
  const room = props.room;
  const sensors = (room && room.sensors) || {};
  const status = room ? room.status : null;

  return (
    <div className="scene-wrap">
      <Canvas
        className="scene-canvas"
        dpr={[1, 1.5]}
        camera={{ position: [5.4, 4.4, 6.2], fov: 46 }}
      >
        <color attach="background" args={["#0e1320"]} />
        <ambientLight intensity={0.75} />
        <directionalLight position={[4, 7, 5]} intensity={0.9} />
        <directionalLight position={[-5, 3, -4]} intensity={0.25} />

        <RoomShell status={status} />

        {MARKERS.map((marker) => {
          if (marker.kind === "equipment") {
            return (
              <EquipmentMarker
                key={marker.id}
                marker={marker}
                sensors={sensors}
              />
            );
          }

          const rows =
            marker.kind === "camera"
              ? cameraRows(marker, sensors, props.cameraCounts)
              : sensorRows(sensors);

          return (
            <SensorMarker key={marker.id} marker={marker} rows={rows} />
          );
        })}

        <OrbitControls
          makeDefault
          enablePan
          minDistance={2.5}
          maxDistance={18}
          // Stop the camera dropping below the floor plane.
          maxPolarAngle={Math.PI / 2.06}
          target={[0, 1, 0]}
        />
      </Canvas>

      <div className="scene-legend">
        <span>
          <span className="legend-swatch" /> sensor
        </span>
        <span>
          <span
            className="legend-swatch"
            style={{ background: "var(--dim)" }}
          />{" "}
          camera
        </span>
        <span>
          <span
            className="legend-swatch"
            style={{ background: "#28324b" }}
          />{" "}
          equipment
        </span>
      </div>

      <div className="scene-hint">
        Drag to orbit · scroll to zoom · {ROOM.width}m × {ROOM.depth}m
      </div>
    </div>
  );
}
