# A tiny standalone WebSocket server sending fake room-status messages
# matching schemas/mqtt_and_ws.md section 2, so frontend work can proceed
# without the real backend being finished.
#
# Requires: pip install websockets
# Usage: python mock_ws_sender.py

import asyncio
import datetime
import json
import random

import websockets

HOST = "localhost"
PORT = 8001
SEND_INTERVAL_SECONDS = 5

ROOM_IDS = ["corridor_a"]
STATUSES = ["green", "green", "green", "yellow", "red"]


def build_message(room_id):
    status = random.choice(STATUSES)
    timestamp = datetime.datetime.now(datetime.timezone.utc).isoformat()

    is_anomaly = status != "green"
    top_features = []
    if is_anomaly:
        top_features = ["surface_temp", "vibration_magnitude"]

    message = {
        "room_id": room_id,
        "timestamp": timestamp,
        "status": status,
        "source": "fusion",
        "sensors": {
            "temperature": round(random.uniform(20.0, 28.0), 2),
            "humidity": round(random.uniform(30.0, 60.0), 2),
            "eco2": round(random.uniform(400.0, 800.0), 2),
            "tvoc": round(random.uniform(0.0, 200.0), 2),
            "aqi": round(random.uniform(1.0, 3.0), 2),
            "surface_temp": round(random.uniform(20.0, 40.0), 2),
            "vibration_magnitude": round(random.uniform(0.0, 3.0), 2),
            "vibration_trip": is_anomaly,
            "occupancy_count": random.randint(0, 5),
        },
        "anomaly": {
            "is_anomaly": is_anomaly,
            "score": round(random.uniform(0.5, 0.9), 2) if is_anomaly else None,
            "top_features": top_features,
        },
        "trend": {
            "metric": "aqi" if is_anomaly else None,
            "time_to_threshold_minutes": round(random.uniform(5.0, 20.0), 1)
            if is_anomaly
            else None,
        },
    }
    return message


async def send_updates(websocket):
    print("Frontend client connected.")
    try:
        while True:
            for room_id in ROOM_IDS:
                message = build_message(room_id)
                payload = json.dumps(message)
                await websocket.send(payload)
                print("Sent:", payload)
            await asyncio.sleep(SEND_INTERVAL_SECONDS)
    except websockets.exceptions.ConnectionClosed:
        print("Frontend client disconnected.")


async def main():
    print("Mock WS sender listening on ws://" + HOST + ":" + str(PORT))
    async with websockets.serve(send_updates, HOST, PORT):
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
