#!/bin/zsh
# Stops any running camera producers. The Terminal windows they were
# started in stay open (harmless) — just close them if you want.

pids=$(pgrep -f "[p]roducer\.py" 2>/dev/null || true)

if [ -z "$pids" ]; then
  echo "No camera producers running."
  exit 0
fi

echo "$pids" | xargs kill
echo "Stopped: $pids"
