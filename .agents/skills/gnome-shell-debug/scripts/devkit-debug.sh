#!/usr/bin/env bash
# Legacy devkit launcher (Devkit Seam) — builds via make, logs to /tmp/anvil-debug-session.log.
# Prefer run-devkit-session.sh (primary deep adapter for the default Devkit Seam).
# See SKILL.md for Devkit vs Headless seams.
set -euo pipefail

SCRIPT_PATH="$(readlink -f "${BASH_SOURCE[0]}")"
PROJECT_ROOT="$(cd "$(dirname "$SCRIPT_PATH")/../../../.." && pwd -P)"
UUID="anvil@GenKerensky.github.com"
LOGFILE="/tmp/anvil-debug-session.log"

cd "$PROJECT_ROOT"

echo "=== Anvil Devkit Debug Session ==="
echo "Building extension..."
make clean
make build
make install

echo ""
echo "Starting devkit with debug logging..."
echo "Logs: $LOGFILE"
echo "Press Ctrl+C to stop"
echo ""

echo "Session started at $(date)" >"$LOGFILE"

export G_MESSAGES_DEBUG=all
export SHELL_DEBUG=all
export MUTTER_DEBUG_DUMMY_MODE_SPECS=1920x1080

dbus-run-session -- bash -c "
  gnome-shell --devkit --wayland --virtual-monitor 1920x1080 &
  SHELL_PID=\$!
  sleep 5
  gnome-extensions enable ${UUID} || true
  wait \$SHELL_PID
" 2>&1 | tee -a "$LOGFILE"