#!/usr/bin/env bash
# Anvil E2E — Session Startup (headless Wayland compositor)
#
# Starts a session D-Bus at a fixed address, launches python-dbusmock stubs
# for services gnome-shell expects at startup, then runs
# gnome-shell --headless --wayland.
#
# NOTE: gnome-shell --headless --wayland is the only compositor mode that
# works in a container without real GPU. GNOME 50 / mutter 50.1 removed the
# --nested flag (which previously allowed Xvfb + xdotool keyboard injection).
# Keyboard-driven and pixel-level visual tests are not feasible with this
# approach; use D-Bus APIs and gsettings for all testing.

set -euo pipefail

export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/1000}"
export DBUS_SESSION_BUS_ADDRESS="unix:path=${XDG_RUNTIME_DIR}/bus"

mkdir -p "${XDG_RUNTIME_DIR}"
chmod 0700 "${XDG_RUNTIME_DIR}"

# Start a session D-Bus daemon at the fixed address
dbus-daemon --session --address="${DBUS_SESSION_BUS_ADDRESS}" --fork

# Mock D-Bus services that gnome-shell requires at startup.
# Without these, gnome-shell will emit fatal errors or crash on boot.
# AccountsService needs --system bus which dbus-broker rejects, but
# the error is non-fatal — gnome-shell falls back gracefully.
python3 -m dbusmock --system \
    org.freedesktop.Accounts \
    /org/freedesktop/Accounts \
    org.freedesktop.Accounts &

python3 -m dbusmock \
    org.freedesktop.UPower \
    /org/freedesktop/UPower \
    org.freedesktop.UPower &

python3 -m dbusmock \
    org.freedesktop.NetworkManager \
    /org/freedesktop/NetworkManager \
    org.freedesktop.NetworkManager &

python3 -m dbusmock \
    net.hadess.PowerProfiles \
    /net/hadess/PowerProfiles \
    net.hadess.PowerProfiles &

python3 -m dbusmock \
    org.gnome.SessionManager \
    /org/gnome/SessionManager \
    org.gnome.SessionManager &

# Give mocks a moment to register their bus names
sleep 1

# Enable the accessibility toolkit so GTK/GNOME Shell export AT-SPI trees
# for Dogtail-based UI testing.
gsettings set org.gnome.desktop.interface toolkit-accessibility true 2>/dev/null || true

# Start the AT-SPI bus launcher so the accessibility registry is available.
# Without this, the gnome-shell a11y bridge will not initialize and Dogtail
# will see an empty tree.  --a11y=1 forces accessibility enablement.
/usr/libexec/at-spi-bus-launcher --launch-immediately --a11y=1 2>/dev/null &
sleep 2

exec gnome-shell --headless --wayland
