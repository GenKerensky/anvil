#!/bin/bash
# Anvil Devkit Debug Session Launcher
# Captures all relevant debug output for troubleshooting terminal resize issues

set -e

echo "=== Anvil Devkit Debug Session ==="
echo ""
echo "This script will:"
echo "1. Build and install the extension with debug logging"
echo "2. Start a devkit GNOME Shell session"
echo "3. Capture all logs to /tmp/anvil-debug-session.log"
echo ""
echo "To trigger the bug:"
echo "1. Open a terminal (e.g., kitty, alacritty, gnome-terminal)"
echo "2. Open neovim"
echo "3. Delete a character in normal mode (e.g., press 'x')"
echo "4. Or: Select text with mouse in opencode"
echo "5. Watch for unexpected terminal resizing"
echo ""
echo "Press Enter to start, or Ctrl+C to cancel"
read

cd /var/home/falco/Projects/anvil

echo "Building extension with debug logging..."
./scripts/quick-debug-build.sh

echo ""
echo "Starting devkit session..."
echo "Logs will be written to: /tmp/anvil-debug-session.log"
echo ""

# Create log file with timestamp
LOGFILE="/tmp/anvil-debug-session.log"
echo "=== Anvil Debug Session Started at $(date) ===" > "$LOGFILE"
echo "=== GNOME Shell Version ===" >> "$LOGFILE"
gnome-shell --version >> "$LOGFILE" 2>&1 || true
echo "" >> "$LOGFILE"

# Launch devkit with debug flags and capture all output
export G_MESSAGES_DEBUG=all
export SHELL_DEBUG=all

dbus-run-session -- bash -c '
    # Start gnome-shell devkit in background
    gnome-shell --devkit --wayland --virtual-monitor 1920x1080 &
    SHELL_PID=$!
    
    # Wait for shell to start
    echo "Waiting for GNOME Shell to start..."
    sleep 8
    
    # Enable Anvil extension
    echo "Enabling Anvil extension..."
    gnome-extensions enable anvil@GenKerensky.github.com || true
    
    echo "GNOME Shell devkit running. PID: $SHELL_PID"
    echo "Trigger the bug now. Press Ctrl+C to stop."
    
    # Keep session running
    wait $SHELL_PID
' 2>&1 | tee -a "$LOGFILE"

echo ""
echo "=== Session ended ==="
echo "Logs saved to: $LOGFILE"
echo ""
echo "To analyze the logs, share the file or run:"
echo "  grep -i 'terminal\\|resize\\|enforce\\|move:' $LOGFILE | tail -100"
