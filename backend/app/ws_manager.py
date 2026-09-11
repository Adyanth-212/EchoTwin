import json

from fastapi import WebSocket

from app.schemas.ws import WSMessage


class ConnectionManager:
    def __init__(self):
        self.active_connections = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: WSMessage):
        payload = json.dumps(message.model_dump())
        still_connected = []
        for connection in self.active_connections:
            try:
                await connection.send_text(payload)
                still_connected.append(connection)
            except Exception:
                pass
        self.active_connections = still_connected


manager = ConnectionManager()
