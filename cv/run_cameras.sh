#!/bin/zsh
# Starts both camera producers, each in its own Terminal window so you can
# see live per-frame output. Must run from a real Terminal.app window (or
# via this script, which opens its own) — see the "camera permission" note
# in README.md if a camera fails to open.
#
# Defaults match the current physical setup. If a camera got unplugged,
# replugged, or a phone reconnected, indices can shift — re-run
# `python3 producer.py --list-cameras` first and override below if needed:
#
#   CAM1_INDEX=2 CAM2_INDEX=0 ./run_cameras.sh

set -e
cd "$(dirname "$0")"
HERE="$(pwd)"

CAM1_INDEX="${CAM1_INDEX:-0}"
CAM2_INDEX="${CAM2_INDEX:-1}"
ROOM_ID="${ROOM_ID:-corridor_a}"
INTERVAL="${INTERVAL:-0.1}"

CAM1_CMD="cd '$HERE' && source .venv/bin/activate && python3 producer.py --camera-id cam1 --camera-index $CAM1_INDEX --room-id $ROOM_ID --interval $INTERVAL"
CAM2_CMD="cd '$HERE' && source .venv/bin/activate && python3 producer.py --camera-id cam2 --camera-index $CAM2_INDEX --room-id $ROOM_ID --http-port 8011 --interval $INTERVAL"

osascript -e "tell application \"Terminal\" to do script \"$CAM1_CMD\"" >/dev/null
sleep 1
osascript -e "tell application \"Terminal\" to do script \"$CAM2_CMD\"" >/dev/null
osascript -e 'tell application "Terminal" to activate' >/dev/null

echo "Started cam1 (index $CAM1_INDEX) and cam2 (index $CAM2_INDEX) in new Terminal windows."
echo "Run ./stop_cameras.sh to stop them both."
