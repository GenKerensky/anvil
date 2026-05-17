#!/usr/bin/env bash
# set-env.sh — Sets all required environment variables for the headless Wayland
# gnome-shell session inside the container, then executes the given command.
#
# This script is copied into /usr/local/bin/ inside the container and is used
# as a wrapper for every `podman exec` call from the test harness:
#
#   podman exec --user gnomeshell ... set-env.sh gsettings set ...
#   podman exec --user gnomeshell ... set-env.sh gdbus call ...
#   podman exec --user gnomeshell ... set-env.sh wtype -M super h -m super

export XDG_RUNTIME_DIR="/run/user/1000"
export DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/1000/bus"
export XDG_DATA_HOME="/home/gnomeshell/.local/share"
export XDG_CONFIG_HOME="/home/gnomeshell/.config"
export XDG_CACHE_HOME="/home/gnomeshell/.cache"
export XDG_SESSION_TYPE="wayland"
export XDG_SESSION_CLASS="user"
export GNOME_SHELL_SESSION_MODE="user"
export WAYLAND_DISPLAY="wayland-0"
export HOME="/home/gnomeshell"
export USER="gnomeshell"
export LOGNAME="gnomeshell"
export GSETTINGS_SCHEMA_DIR="/home/gnomeshell/.local/share/gnome-shell/extensions/anvil@GenKerensky.github.com/schemas"
exec "$@"
