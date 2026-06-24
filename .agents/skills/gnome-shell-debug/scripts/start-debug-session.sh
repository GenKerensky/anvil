#!/usr/bin/env bash
# Legacy quick capture (Devkit Seam) to /tmp/anvil-debug-session.log.
# Prefer run-devkit-session.sh (the deep launcher for the default Devkit Seam).
# See SKILL.md for the two seams (devkit default; headless only when called for or self-sufficient).
set -euo pipefail

SCRIPT_PATH="$(readlink -f "${BASH_SOURCE[0]}")"
SCRIPTS_DIR="$(cd "$(dirname "$SCRIPT_PATH")" && pwd -P)"
UUID="anvil@GenKerensky.github.com"
LOGFILE="/tmp/anvil-debug-session.log"

echo "=== Anvil Devkit Debug Session ==="
echo ""
echo "This script will:"
echo "1. Build and install the extension with debug logging"
echo "2. Start a devkit GNOME Shell session"
echo "3. Capture all logs to $LOGFILE"
echo ""
echo "Press Enter to start, or Ctrl+C to cancel"
read

"$SCRIPTS_DIR/quick-debug-build.sh"

echo ""
echo "Starting devkit session..."
echo "Logs: $LOGFILE"
echo ""

{
  echo "=== Anvil Debug Session Started at $(date) ==="
  gnome-shell --version 2>&1 || true
  echo ""
} >"$LOGFILE"

export G_MESSAGES_DEBUG=all
export SHELL_DEBUG=all

dbus-run-session -- bash -c "
  gnome-shell --devkit --wayland --virtual-monitor 1920x1080 &
  SHELL_PID=\$!
  sleep 8
  gnome-extensions enable ${UUID} || true
  echo 'GNOME Shell devkit running. PID:' \$SHELL_PID
  echo 'Trigger the bug now. Press Ctrl+C to stop.'
  wait \$SHELL_PID
" 2>&1 | tee -a "$LOGFILE"

echo ""
echo "=== Session ended ==="
echo "Logs saved to: $LOGFILE"
echo "  grep -iE 'anvil|resize|error' $LOGFILE | tail -100"