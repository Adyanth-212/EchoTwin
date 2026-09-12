const STATUS_COLORS = {
  green: "#2ecc71",
  yellow: "#f1c40f",
  red: "#e74c3c",
};
const DEFAULT_COLOR = "#888888";

// Placeholder box representing one room. Real geometry/layout for the
// full building twin is a later task — this proves the WS-to-3D wiring.
export default function RoomBox({ status }) {
  const color = STATUS_COLORS[status] || DEFAULT_COLOR;

  return (
    <mesh position={[0, 0, 0]}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color={color} />
    </mesh>
  );
}
