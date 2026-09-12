import asyncio

from fastapi import WebSocket

from app.schemas.ws import WSMessage


class ConnectionManager:
    def __init__(self):
        self.active_connections = []
        self.loop = None

    def set_loop(self, loop):
        self.loop = loop

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: WSMessage):
        payload = message.model_dump(mode="json")
        still_connected = []

        for connection in self.active_connections:
            try:
                await connection.send_json(payload)
                still_connected.append(connection)
            except Exception:
                pass

        self.active_connections = still_connected

    def broadcast_from_sync(self, message: WSMessage):
        if self.loop is None or not self.active_connections:
            return

        asyncio.run_coroutine_threadsafe(self.broadcast(message), self.loop)


manager = ConnectionManager()
