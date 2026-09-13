# Fires a named fault scenario at the live system for demos and rehearsals.
#
# Readings go in over MQTT in exactly the shape schemas/mqtt_and_ws.md
# specifies, so nothing downstream can tell them from the real node: the
# fusion rules, the Isolation Forest, the maintenance watcher and the stored
# history all see genuine readings. Occupancy goes to POST /cv instead,
# because that is the camera path rather than the sensor path.
#
# The real ESP32 also publishes as node_1 every 7.5s, and fusion keeps the
# latest value per sensor. This publishes faster than that so a held scenario
# wins, and the board's own readings take over again once it stops.
#
# Usage:
#   python3 scripts/demo_trigger.py --list
#   python3 scripts/demo_trigger.py combined --seconds 180
#   python3 scripts/demo_trigger.py occupancy --people 7
#   python3 scripts/demo_trigger.py clear
#   python3 scripts/demo_trigger.py menu
#
# Style note: this deliberately avoids f-strings and clever comprehensions,
# matching the project's Python style preference.

import argparse
import datetime
import json
import sys
import time

try:
    import paho.mqtt.client as mqtt
except ImportError:
    print("paho-mqtt is missing. Install it with:")
    print("  pip install paho-mqtt==2.1.0 requests")
    sys.exit(1)

try:
    import requests
except ImportError:
    requests = None


DEFAULT_BROKER = "100.93.145.13"
DEFAULT_BACKEND = "http://100.93.145.13:8000"
BROKER_PORT = 1883
NODE_ID = "node_1"
ROOM_ID = "corridor_a"
TOPIC = "echotwin/sensors/" + NODE_ID

# How often a held scenario republishes. Must beat the firmware's 7.5s so the
# scenario value is the latest one fusion sees.
PUBLISH_INTERVAL_SECONDS = 1.5

# Calm values used to hand the room back at the end of a scenario, and by the
# "clear" scenario on its own.
BASELINE = {
    "temperature": 24.5,
    "humidity": 50.0,
    "eco2": 520.0,
    "tvoc": 80.0,
    "aqi": 2.0,
    "surface_temp": 28.0,
    "vibration_magnitude": 0.05,
    "vibration_trip": 0,
}

SCENARIOS = {
    "overheat": {
        "blurb": "Surface temp past critical - equipment overheating",
        "expect": "red - 'High surface temperature detected'",
        "sensors": {"surface_temp": 47.0},
    },
    "vibration": {
        "blurb": "Strong vibration plus the SW-420 trip",
        "expect": "red - 'Strong vibration detected' + trip warning",
        "sensors": {"vibration_magnitude": 6.2, "vibration_trip": 1},
    },
    "combined": {
        "blurb": "Heat AND vibration together - neither alone is critical",
        "expect": "red - the combined-fault rule, the fusion story",
        "sensors": {"temperature": 31.5, "vibration_magnitude": 3.1},
    },
    "air": {
        "blurb": "CO2, TVOC and AQI past critical",
        "expect": "red - ventilation suggestions, likely an anomaly too",
        "sensors": {"eco2": 1650.0, "tvoc": 700.0, "aqi": 5.0},
    },
    "stuffy": {
        "blurb": "Air quality up moderately - pair with occupancy to show the crowd cross-check",
        "expect": "yellow - explained as crowding when 5+ people are seen",
        "sensors": {"eco2": 1150.0, "tvoc": 340.0},
    },
    "humidity": {
        "blurb": "Humidity past the upper critical bound",
        "expect": "red - 'Humidity is outside the safe operating range'",
        "sensors": {"humidity": 85.0},
    },
    "clear": {
        "blurb": "Hand the room back to calm baseline values",
        "expect": "green",
        "sensors": {},
    },
}


def timestamp_now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def connect(broker):
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
    client.connect(broker, BROKER_PORT, 30)
    client.loop_start()
    return client


def publish_values(client, values):
    for sensor in sorted(values.keys()):
        payload = {
            "node_id": NODE_ID,
            "sensor": sensor,
            "value": values[sensor],
            "timestamp": timestamp_now(),
        }
        client.publish(TOPIC, json.dumps(payload), qos=0)


def post_occupancy(backend, people, camera_id):
    if requests is None:
        print("requests is missing; cannot post occupancy.")
        return
    payload = {
        "room_id": ROOM_ID,
        "camera_id": camera_id,
        "occupancy": people,
        "unusual_activity": False,
        "confidence": 0.9,
        "timestamp": timestamp_now(),
    }
    try:
        response = requests.post(backend.rstrip("/") + "/cv", json=payload, timeout=5)
        print("  occupancy " + str(people) + " -> HTTP " + str(response.status_code))
    except requests.RequestException as error:
        print("  occupancy post failed: " + str(error))


def hold(client, values, seconds, label):
    print(label)
    print("  holding for " + str(seconds) + "s (Ctrl-C to stop early)")
    deadline = time.time() + seconds
    ticks = 0
    try:
        while time.time() < deadline:
            publish_values(client, values)
            ticks = ticks + 1
            if ticks % 4 == 1:
                remaining = int(deadline - time.time())
                print("  ... " + str(remaining) + "s left")
            time.sleep(PUBLISH_INTERVAL_SECONDS)
    except KeyboardInterrupt:
        print("  stopped early")


def run_scenario(name, seconds, people, broker, backend, camera_id, restore):
    scenario = SCENARIOS[name]
    values = dict(BASELINE)
    values.update(scenario["sensors"])

    client = connect(broker)
    try:
        print("")
        print("scenario : " + name)
        print("what     : " + scenario["blurb"])
        print("expect   : " + scenario["expect"])

        if people is not None:
            post_occupancy(backend, people, camera_id)

        hold(client, values, seconds, "publishing to " + broker)

        if restore and name != "clear":
            print("restoring baseline")
            publish_values(client, BASELINE)
            if people is not None:
                post_occupancy(backend, 0, camera_id)
        print("done")
    finally:
        client.loop_stop()
        client.disconnect()


def print_scenarios():
    print("")
    print("scenarios:")
    for name in sorted(SCENARIOS.keys()):
        print("  %-10s %s" % (name, SCENARIOS[name]["blurb"]))
    print("")
    print("sustained conditions need ~120s for a maintenance warning and 30s")
    print("for a critical one, so use --seconds 150 if you want an incident.")


def run_menu(seconds, broker, backend, camera_id):
    names = sorted(SCENARIOS.keys())
    while True:
        print("")
        for index in range(len(names)):
            print("  " + str(index + 1) + ") " + names[index])
        print("  q) quit")
        choice = input("pick> ").strip().lower()
        if choice in ("q", "quit", "exit"):
            return 0
        if not choice.isdigit():
            continue
        number = int(choice)
        if number < 1 or number > len(names):
            continue
        name = names[number - 1]
        people = 7 if name == "stuffy" else None
        run_scenario(name, seconds, people, broker, backend, camera_id, True)


def main():
    parser = argparse.ArgumentParser(
        description="Fire a fault scenario at the live EchoTwin stack."
    )
    parser.add_argument("scenario", nargs="?", help="scenario name, or 'menu'")
    parser.add_argument("--seconds", type=float, default=45.0, help="how long to hold it")
    parser.add_argument("--people", type=int, default=None, help="also post this occupancy")
    parser.add_argument("--camera-id", default="cam1", help="camera id for occupancy posts")
    parser.add_argument("--broker", default=DEFAULT_BROKER)
    parser.add_argument("--backend", default=DEFAULT_BACKEND)
    parser.add_argument("--no-restore", action="store_true", help="leave the fault in place")
    parser.add_argument("--list", action="store_true", help="list scenarios and exit")
    arguments = parser.parse_args()

    if arguments.list or arguments.scenario is None:
        print_scenarios()
        return 0

    if arguments.scenario == "menu":
        return run_menu(arguments.seconds, arguments.broker, arguments.backend, arguments.camera_id)

    if arguments.scenario not in SCENARIOS:
        print("Unknown scenario: " + arguments.scenario)
        print_scenarios()
        return 1

    run_scenario(
        arguments.scenario,
        arguments.seconds,
        arguments.people,
        arguments.broker,
        arguments.backend,
        arguments.camera_id,
        not arguments.no_restore,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
