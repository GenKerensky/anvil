#!/usr/bin/env bash
# wait-user-bus.sh — waits until the user D-Bus session bus socket is available
# chmod +x wait-user-bus.sh

for i in $(seq 1 30); do
  if [ -S "/run/user/1000/bus" ]; then
    echo "User bus available after ${i} seconds"
    exit 0
  fi
  sleep 1
done

echo "Timed out waiting for user bus" >&2
exit 1
