import { Html, Line } from "@react-three/drei";
import { RESTRICTED_ZONE } from "../roomLayout.js";

// The floor rectangle nobody should stand in, drawn flat on the floor so it
// reads as an area rather than an object. It sits 1cm above y=0 because a
// plane exactly coincident with the scanned floor z-fights with it.
//
// Breached state is deliberately loud: this is the one overlay that exists to
// be noticed from across a room.

const CLEAR_COLOR = "#38bdf8";
const BREACHED_COLOR = "#f8586f";

export default function RestrictedZone(props) {
  const zone = RESTRICTED_ZONE;
  if (!zone || !zone.enabled) {
    return null;
  }

  const breached = props.intruderCount > 0;
  const color = breached ? BREACHED_COLOR : CLEAR_COLOR;
  const [width, depth] = zone.size;
  const [centerX, centerZ] = zone.center;

  return (
    <group position={[centerX, 0.01, centerZ]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[width, depth]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={breached ? 0.42 : 0.16}
          depthWrite={false}
        />
      </mesh>

      {/* An outline, so the area stays readable when the fill is faint. */}
      <Line
        points={[
          [-width / 2, 0, -depth / 2],
          [width / 2, 0, -depth / 2],
          [width / 2, 0, depth / 2],
          [-width / 2, 0, depth / 2],
          [-width / 2, 0, -depth / 2],
        ]}
        color={color}
        lineWidth={2}
        transparent
        opacity={0.9}
      />

      <Html center distanceFactor={9} position={[0, 0.45, 0]}>
        <div className={"zone-tag" + (breached ? " breached" : "")}>
          <span className="zone-tag-label">{zone.label}</span>
          <span className="zone-tag-state">
            {breached
              ? props.intruderCount + " inside — not permitted"
              : "Clear"}
          </span>
        </div>
      </Html>
    </group>
  );
}
