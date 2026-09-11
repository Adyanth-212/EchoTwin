from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.ws_manager import manager

router = APIRouter()


@router.websocket("/ws/room-status")
async def room_status_socket(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            # Dashboard clients do not send data on this socket today, but
            # we must keep reading to detect disconnects.
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)
