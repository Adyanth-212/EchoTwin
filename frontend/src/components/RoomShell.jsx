import { useMemo } from "react";
import { Color, DoubleSide } from "three";
import { ROOM } from "../roomLayout.js";

const BASE_FLOOR = "#131a2a";
const BASE_WALL = "#1a2236";

const STATUS_TINT = {
  green: "#3fbf7f",
  yellow: "#f2a63b",
  red: "#f2645f",
};

// A wash, not a coat of paint: the base surface colour is nudged a short way
// toward the status colour so the room reads as green/yellow/red at a glance
// while the markers on top of it stay legible.
function washed(baseHex, status, amount) {
  const base = new Color(baseHex);
  const tint = STATUS_TINT[status];
  if (!tint) {
    return base;
  }
  return base.lerp(new Color(tint), amount);
}

export default function RoomShell(props) {
  const status = props.status;

  const floorColor = useMemo(
    () => washed(BASE_FLOOR, status, 0.1),
    [status]
  );
  const wallColor = useMemo(() => washed(BASE_WALL, status, 0.07), [status]);

  const halfWidth = ROOM.width / 2;
  const halfDepth = ROOM.depth / 2;
  const wallHeight = ROOM.height;

  return (
    <group>
      {/* Floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[ROOM.width, ROOM.depth]} />
        <meshStandardMaterial color={floorColor} roughness={0.95} />
      </mesh>

      {/* Back wall (-z) */}
      <mesh position={[0, wallHeight / 2, -halfDepth]}>
        <planeGeometry args={[ROOM.width, wallHeight]} />
        <meshStandardMaterial
          color={wallColor}
          roughness={1}
          transparent
          opacity={0.62}
          side={DoubleSide}
        />
      </mesh>

      {/* Left wall (-x) */}
      <mesh
        position={[-halfWidth, wallHeight / 2, 0]}
        rotation={[0, Math.PI / 2, 0]}
      >
        <planeGeometry args={[ROOM.depth, wallHeight]} />
        <meshStandardMaterial
          color={wallColor}
          roughness={1}
          transparent
          opacity={0.45}
          side={DoubleSide}
        />
      </mesh>

      {/* Right wall (+x) */}
      <mesh
        position={[halfWidth, wallHeight / 2, 0]}
        rotation={[0, -Math.PI / 2, 0]}
      >
        <planeGeometry args={[ROOM.depth, wallHeight]} />
        <meshStandardMaterial
          color={wallColor}
          roughness={1}
          transparent
          opacity={0.45}
          side={DoubleSide}
        />
      </mesh>

      {/* The +z side is deliberately left open so the camera can look in. */}

      <gridHelper
        args={[ROOM.width, 12, "#2b3550", "#222b42"]}
        position={[0, 0.01, 0]}
        scale={[1, 1, ROOM.depth / ROOM.width]}
      />
    </group>
  );
}
