// A thin line from a marker down to a ring on the floor.
//
// Two problems, one fix. A marker floating at head height is hard to place
// in a 3D view at all — you cannot tell where on the floor it actually sits.
// And once the scanned room is sliced for the dollhouse view, anything
// mounted above the slice (the ceiling cameras) hangs in mid-air with no
// visible connection to the room. The stem answers both.
export default function MarkerStem(props) {
  const height = props.height;

  if (height <= 0.05) {
    return null;
  }

  const color = props.color || "#7686a6";

  return (
    <group>
      <mesh position={[0, -height / 2, 0]}>
        <cylinderGeometry args={[0.006, 0.006, height, 6]} />
        <meshBasicMaterial color={color} transparent opacity={0.5} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -height + 0.015, 0]}>
        <ringGeometry args={[0.1, 0.13, 20]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.65}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}
