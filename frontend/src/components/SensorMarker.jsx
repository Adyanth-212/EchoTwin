import { Suspense } from "react";
import { Html } from "@react-three/drei";
import MarkerModel from "./MarkerModel.jsx";
import MarkerStem from "./MarkerStem.jsx";
import ModelFallback from "./ModelFallback.jsx";

// Distinct geometry per marker kind, so the room is readable without reading
// any label: the sensor node is a small upright box, a camera is a cone
// pointing into the room.
const KIND_COLOR = {
  sensor: "#4bd0c0",
  camera: "#7686a6",
};

export default function SensorMarker(props) {
  const marker = props.marker;
  const color = KIND_COLOR[marker.kind] || "#a9b6d2";

  const builtIn =
    marker.kind === "camera" ? (
      <mesh rotation={[Math.PI / 2.6, 0, 0]}>
        <coneGeometry args={[0.12, 0.3, 4]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.35}
          roughness={0.5}
        />
      </mesh>
    ) : (
      <mesh>
        <boxGeometry args={[0.2, 0.28, 0.12]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.35}
          roughness={0.5}
        />
      </mesh>
    );

  function handleClick(event) {
    if (props.onSelect) {
      event.stopPropagation();
      props.onSelect(marker.id);
    }
  }

  return (
    <group position={marker.position} onClick={handleClick}>
      {props.selected ? (
        <mesh>
          <sphereGeometry args={[0.28, 16, 12]} />
          <meshBasicMaterial
            color="#ffffff"
            transparent
            opacity={0.72}
            wireframe
            depthWrite={false}
          />
        </mesh>
      ) : null}
      <MarkerStem height={marker.position[1]} color={color} />
      {marker.model ? (
        <ModelFallback fallback={builtIn}>
          <Suspense fallback={builtIn}>
            <MarkerModel url={marker.model} fit={0.4} />
          </Suspense>
        </ModelFallback>
      ) : (
        builtIn
      )}

      <Html position={[0, 0.3, 0]} zIndexRange={[20, 0]}>
        <div className="marker-label">
          <div className="marker-label-title">{marker.label}</div>
          {props.rows.map((row) => (
            <div className="marker-label-row" key={row.label}>
              <span style={{ color: "var(--muted)" }}>{row.label}</span>
              <span className="marker-label-value num">{row.value}</span>
            </div>
          ))}
        </div>
      </Html>
    </group>
  );
}
