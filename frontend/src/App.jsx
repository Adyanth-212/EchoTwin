import { Canvas } from "@react-three/fiber";
import RoomBox from "./components/RoomBox.jsx";
import useRoomStatus from "./useRoomStatus.js";

const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:8001";
const DEMO_ROOM_ID = "corridor_a";

export default function App() {
  const roomStatusById = useRoomStatus(WS_URL);
  const room = roomStatusById[DEMO_ROOM_ID];

  return (
    <div style={{ width: "100vw", height: "100vh" }}>
      <div style={{ position: "absolute", top: 10, left: 10, color: "white", fontFamily: "sans-serif", zIndex: 1 }}>
        <div>Room: {DEMO_ROOM_ID}</div>
        <div>Status: {room ? room.status : "waiting for data..."}</div>
      </div>
      <Canvas camera={{ position: [3, 3, 3] }} style={{ background: "#111111" }}>
        <ambientLight intensity={0.6} />
        <pointLight position={[5, 5, 5]} />
        <RoomBox status={room ? room.status : null} />
      </Canvas>
    </div>
  );
}
