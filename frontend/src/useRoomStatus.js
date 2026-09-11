import { useEffect, useState } from "react";

// Connects to the WS URL and keeps the latest message per room_id, using
// the shape fixed in schemas/mqtt_and_ws.md section 2. Reconnects on
// close so the dashboard survives the mock sender or backend restarting.
export default function useRoomStatus(wsUrl) {
  const [roomStatusById, setRoomStatusById] = useState({});

  useEffect(() => {
    let socket = null;
    let reconnectTimer = null;
    let isUnmounted = false;

    function connect() {
      socket = new WebSocket(wsUrl);

      socket.onmessage = (event) => {
        const message = JSON.parse(event.data);
        setRoomStatusById((previous) => {
          const updated = Object.assign({}, previous);
          updated[message.room_id] = message;
          return updated;
        });
      };

      socket.onclose = () => {
        if (!isUnmounted) {
          reconnectTimer = setTimeout(connect, 2000);
        }
      };
    }

    connect();

    return () => {
      isUnmounted = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      if (socket) {
        socket.close();
      }
    };
  }, [wsUrl]);

  return roomStatusById;
}
