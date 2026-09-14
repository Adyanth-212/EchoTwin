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
import html
import json
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

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


DEFAULT_BROKER = "192.0.2.10"
DEFAULT_BACKEND = "http://192.0.2.10:8000"
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


# --------------------------------------------------------------------------
# Web remote
# --------------------------------------------------------------------------
#
# A page of buttons, served separately from the dashboard so the demo screen
# stays clean. Open it on a second window or a phone on the same network and
# drive the room from there.

# Only one scenario runs at a time. A new press supersedes whatever is holding.
current = {"name": None, "until": 0.0, "generation": 0}
current_lock = threading.Lock()


def scenario_worker(name, seconds, people, options, generation):
    scenario = SCENARIOS[name]
    values = dict(BASELINE)
    values.update(scenario["sensors"])

    try:
        client = connect(options["broker"])
    except OSError as error:
        print("broker connect failed: " + str(error))
        return

    try:
        if people is not None:
            post_occupancy(options["backend"], people, options["camera_id"])

        deadline = time.time() + seconds
        while time.time() < deadline:
            with current_lock:
                # A later press took over; leave its values alone.
                if current["generation"] != generation:
                    return
            publish_values(client, values)
            time.sleep(PUBLISH_INTERVAL_SECONDS)

        with current_lock:
            if current["generation"] != generation:
                return
            current["name"] = None

        if name != "clear":
            publish_values(client, BASELINE)
            if people is not None:
                post_occupancy(options["backend"], 0, options["camera_id"])
    finally:
        client.loop_stop()
        client.disconnect()


def start_scenario(name, seconds, people, options):
    with current_lock:
        current["generation"] = current["generation"] + 1
        current["name"] = name
        current["until"] = time.time() + seconds
        generation = current["generation"]

    thread = threading.Thread(
        target=scenario_worker,
        args=(name, seconds, people, options, generation),
    )
    thread.daemon = True
    thread.start()


PAGE_STYLE = """
body { margin:0; background:#0b0f1a; color:#e6ebf5;
  font:15px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; padding:18px; }
h1 { font-size:17px; margin:0 0 4px; }
.sub { color:#8a93a6; font-size:12px; margin-bottom:16px; }
.grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); gap:12px; }
button { width:100%; text-align:left; padding:14px 16px; border-radius:12px; cursor:pointer;
  border:1px solid #24304a; background:#141b2d; color:#e6ebf5; font-size:15px; font-weight:600; }
button:hover { border-color:#3d8bfd; }
button.clear { border-color:#2f7d5b; }
button .what { display:block; font-weight:400; font-size:12px; color:#8a93a6; margin-top:4px; }
.row { display:flex; gap:10px; align-items:center; margin-bottom:14px; flex-wrap:wrap; }
select { background:#141b2d; color:#e6ebf5; border:1px solid #24304a;
  border-radius:8px; padding:8px 10px; font-size:14px; }
#status { margin-top:16px; padding:12px 14px; border-radius:10px;
  background:#141b2d; border:1px solid #24304a; font-size:13px; min-height:20px; }
.live { color:#f2b45f; font-weight:600; }
"""

PAGE_SCRIPT = """
async function fire(name) {
  const seconds = document.getElementById('seconds').value;
  const people = document.getElementById('people').value;
  document.getElementById('status').innerHTML =
    '<span class="live">firing ' + name + '...</span>';
  try {
    const query = '?scenario=' + encodeURIComponent(name)
      + '&seconds=' + encodeURIComponent(seconds)
      + '&people=' + encodeURIComponent(people);
    const response = await fetch('/fire' + query, { method: 'POST' });
    const body = await response.json();
    document.getElementById('status').innerHTML =
      '<span class="live">' + body.message + '</span>';
  } catch (error) {
    document.getElementById('status').textContent = 'failed: ' + error;
  }
}

async function poll() {
  try {
    const response = await fetch('/status');
    const body = await response.json();
    const node = document.getElementById('status');
    if (body.running) {
      node.innerHTML = '<span class="live">' + body.name + '</span> holding, '
        + body.remaining + 's left';
    } else if (!node.dataset.sticky) {
      node.textContent = 'idle - the room is on its own readings';
    }
  } catch (error) { /* the page is useful even if a poll misses */ }
}
setInterval(poll, 1000);
"""


def build_page():
    buttons = []
    for name in sorted(SCENARIOS.keys()):
        css = " class=\"clear\"" if name == "clear" else ""
        buttons.append(
            "<button" + css + " onclick=\"fire('" + name + "')\">"
            + html.escape(name)
            + "<span class=\"what\">"
            + html.escape(SCENARIOS[name]["blurb"])
            + "</span></button>"
        )

    return (
        "<!doctype html><html><head><meta charset=\"utf-8\">"
        "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
        "<title>EchoTwin demo remote</title><style>" + PAGE_STYLE + "</style></head><body>"
        "<h1>EchoTwin demo remote</h1>"
        "<div class=\"sub\">Publishes real MQTT readings as node_1. "
        "The dashboard reacts within a second or two.</div>"
        "<div class=\"row\">"
        "<label>hold <select id=\"seconds\">"
        "<option value=\"30\">30s</option>"
        "<option value=\"45\" selected>45s</option>"
        "<option value=\"90\">90s</option>"
        "<option value=\"150\">150s (opens an incident)</option>"
        "</select></label>"
        "<label>people <select id=\"people\">"
        "<option value=\"\" selected>unchanged</option>"
        "<option value=\"0\">0</option>"
        "<option value=\"3\">3</option>"
        "<option value=\"7\">7 (crowd cross-check)</option>"
        "</select></label>"
        "</div>"
        "<div class=\"grid\">" + "".join(buttons) + "</div>"
        "<div id=\"status\">idle</div>"
        "<script>" + PAGE_SCRIPT + "</script></body></html>"
    )


def make_handler(options):
    class RemoteHandler(BaseHTTPRequestHandler):
        def send_json(self, payload, code=200):
            body = json.dumps(payload).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            route = urlparse(self.path).path
            if route == "/status":
                with current_lock:
                    name = current["name"]
                    remaining = int(max(0, current["until"] - time.time()))
                if name is None or remaining <= 0:
                    self.send_json({"running": False})
                else:
                    self.send_json({"running": True, "name": name, "remaining": remaining})
                return

            page = build_page().encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(page)))
            self.end_headers()
            self.wfile.write(page)

        def do_POST(self):
            parsed = urlparse(self.path)
            if parsed.path != "/fire":
                self.send_json({"error": "not found"}, 404)
                return

            query = parse_qs(parsed.query)
            name = (query.get("scenario") or [""])[0]
            if name not in SCENARIOS:
                self.send_json({"error": "unknown scenario"}, 400)
                return

            try:
                seconds = float((query.get("seconds") or ["45"])[0])
            except ValueError:
                seconds = 45.0

            people = None
            raw_people = (query.get("people") or [""])[0]
            if raw_people != "":
                try:
                    people = int(raw_people)
                except ValueError:
                    people = None

            start_scenario(name, seconds, people, options)
            message = name + " firing for " + str(int(seconds)) + "s"
            if people is not None:
                message = message + ", occupancy " + str(people)
            print(message)
            self.send_json({"message": message})

        def log_message(self, format_string, *args):
            return

    return RemoteHandler


def run_server(port, options):
    server = ThreadingHTTPServer(("0.0.0.0", port), make_handler(options))
    print("")
    print("demo remote on:")
    print("  http://localhost:" + str(port))
    print("")
    print("publishing to broker " + options["broker"])
    print("Ctrl-C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("")
        print("stopped")
    finally:
        server.shutdown()
    return 0


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
    parser.add_argument("--port", type=int, default=8090, help="port for 'serve'")
    arguments = parser.parse_args()

    options = {
        "broker": arguments.broker,
        "backend": arguments.backend,
        "camera_id": arguments.camera_id,
    }

    if arguments.scenario == "serve":
        return run_server(arguments.port, options)

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
