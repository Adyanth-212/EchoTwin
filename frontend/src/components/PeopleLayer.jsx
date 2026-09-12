import { useRef } from "react";
import { useFrame } from "@react-three/fiber";

// People detected by the cameras, drawn where they actually are on the floor.
//
// Positions arrive about once a second, which would make the figures
// teleport. They are eased toward the target in useFrame instead — that
// mutates the Object3D directly and never touches React state, so it costs
// one matrix update per person per frame and causes no re-renders. A CSS
// transition is not an option for a position in a 3D scene.

const PERSON_COLOR = "#4bd0c0";
// Someone both cameras can see is a confirmed detection rather than one
// camera's guess, and is worth distinguishing.
const CONFIRMED_COLOR = "#7ee8dc";

const EASE_PER_SECOND = 6;

function Person(props) {
  const groupRef = useRef(null);
  const hasPlacedRef = useRef(false);

  useFrame((state, delta) => {
    const group = groupRef.current;
    if (!group) {
      return;
    }

    // A person who has just appeared should not slide in from the origin.
    if (!hasPlacedRef.current) {
      group.position.set(props.x, 0, props.z);
      hasPlacedRef.current = true;
      return;
    }

    const factor = Math.min(1, delta * EASE_PER_SECOND);
    group.position.x += (props.x - group.position.x) * factor;
    group.position.z += (props.z - group.position.z) * factor;
  });

  const isConfirmed = props.cameras && props.cameras.length > 1;
  const color = isConfirmed ? CONFIRMED_COLOR : PERSON_COLOR;

  return (
    <group ref={groupRef}>
      <mesh position={[0, 0.82, 0]}>
        <capsuleGeometry args={[0.2, 1.02, 4, 12]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.28}
          roughness={0.45}
          transparent
          opacity={0.92}
        />
      </mesh>

      {/* Floor ring, so the position reads even when the figure is behind
          something in the scan. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
        <ringGeometry args={[0.24, 0.3, 24]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.75}
          depthWrite={false}
        />
      </mesh>

      {isConfirmed ? (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
          <ringGeometry args={[0.36, 0.39, 24]} />
          <meshBasicMaterial
            color={color}
            transparent
            opacity={0.4}
            depthWrite={false}
          />
        </mesh>
      ) : null}
    </group>
  );
}

export default function PeopleLayer(props) {
  const people = props.people || [];

  return (
    <group>
      {people.map((person) => (
        <Person
          key={person.id}
          x={person.x}
          z={person.z}
          cameras={person.cameras}
        />
      ))}
    </group>
  );
}
