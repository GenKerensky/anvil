#!/bin/bash
# Anvil Devkit Debug Session Launcher
# Captures all relevant debug output for troubleshooting terminal resize issues

set -e

echo "=== Anvil Devkit Debug Session ==="
echo "Building extension with debug symbols..."

# Build and install
cd /var/home/falco/Projects/anvil
make clean
make build
make install

echo ""
echo "=== Starting devkit session with debug logging ==="
echo "Logs will be written to: /tmp/anvil-debug-session.log"
echo ""
echo "To trigger the bug:"
echo "1. Open a terminal (e.g., kitty, alacritty, gnome-terminal)"
echo "2. Open neovim"
echo "3. Delete a character in normal mode (e.g., press 'x')"
echo "4. Or: Select text with mouse in opencode"
echo ""
echo "Press Ctrl+C to stop the session"
echo ""

# Launch devkit with debug flags
export G_MESSAGES_DEBUG=all
export SHELL_DEBUG=all
export MUTTER_DEBUG_DUMMY_MODE_SPECS=1920x1080

# Create log file with timestamp
LOGFILE="/tmp/anvil-debug-session.log"
echo "Session started at $(date)" > "$LOGFILE"

# Run gnome-shell devkit and capture logs
dbus-run-session -- bash -c '
    gnome-shell --devkit --wayland --virtual-monitor 1920x1080 &
    SHELL_PID=$!
    
    # Wait for shell to start
    sleep 5
    
    # Enable Anvil extension
    gnome-extensions enable anvil@GenKerensky.github.com || true
    
    # Keep session running
    wait $SHELL_PID
' 2>&1 | tee -a "$LOGFILE"
