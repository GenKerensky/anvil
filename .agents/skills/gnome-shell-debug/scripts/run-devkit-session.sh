#!/usr/bin/env bash
# Start an isolated nested GNOME Shell devkit session (Devkit Seam) for testing Anvil.
#
# This is the primary deep launcher adapter for the Devkit Seam (default).
# Use the Headless Seam (documented in SKILL.md) for automation or self-sufficient
# tasks such as settings toggles.
#
# This is intended for the common Anvil dev setup where builds run in a Fedora
# Distrobox, but GNOME Shell itself must run on the Bazzite host. The script
# builds dist/ in the current environment, then re-execs itself on the host via
# distrobox-host-exec when needed.

set -Eeuo pipefail

UUID="anvil@GenKerensky.github.com"
SCRIPT_PATH="$(readlink -f "${BASH_SOURCE[0]}")"
PROJECT_ROOT="$(cd "$(dirname "$SCRIPT_PATH")/../../../.." && pwd -P)"
DIST_DIR="$PROJECT_ROOT/dist"

BUILD=1
LAUNCH_TERMINAL=1
TERMINAL_CMD=""
KEEP_TEMP=0
EXTRA_SHELL_ARGS=()
ORIGINAL_ARGS=("$@")

usage() {
  cat <<EOF
Usage: $0 [options]

Starts a nested GNOME Shell --devkit session using $DIST_DIR as the Anvil
extension, with temporary XDG data/config/cache dirs so your real GNOME session
is not modified.

Options:
  --no-build             Do not run 'make build debug' first
  --no-terminal          Do not auto-launch a terminal inside the nested session
  --terminal-cmd CMD     Command to launch inside the nested session
                         Default: first available of ptyxis, kgx, gnome-terminal,
                         alacritty, kitty, foot, wezterm, xterm
  --keep-temp            Keep the temporary XDG/session directory after exit
  --shell-arg ARG        Extra argument passed to gnome-shell (repeatable)
  -h, --help             Show this help

Examples:
  $0
  $0 --no-build
  $0 --terminal-cmd 'ptyxis --new-window'
EOF
}

while (($#)); do
  case "$1" in
    --no-build)
      BUILD=0
      shift
      ;;
    --no-terminal)
      LAUNCH_TERMINAL=0
      shift
      ;;
    --terminal-cmd)
      if [[ $# -lt 2 ]]; then
        echo "error: --terminal-cmd requires an argument" >&2
        exit 2
      fi
      TERMINAL_CMD="$2"
      shift 2
      ;;
    --keep-temp)
      KEEP_TEMP=1
      shift
      ;;
    --shell-arg)
      if [[ $# -lt 2 ]]; then
        echo "error: --shell-arg requires an argument" >&2
        exit 2
      fi
      EXTRA_SHELL_ARGS+=("$2")
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "error: unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

is_container() {
  if command -v systemd-detect-virt >/dev/null 2>&1 && systemd-detect-virt --container --quiet; then
    return 0
  fi
  [[ -f /.dockerenv || -f /run/.containerenv || -n "${container:-}" ]] && return 0
  grep -qaE 'docker|podman|container|libpod' /proc/1/cgroup 2>/dev/null
}

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "error: required command not found: $1" >&2
    exit 1
  fi
}

if (( BUILD )); then
  echo "==> Building Anvil debug dist in $PROJECT_ROOT"
  make -C "$PROJECT_ROOT" build debug
fi

if [[ ! -f "$DIST_DIR/extension.js" || ! -f "$DIST_DIR/metadata.json" ]]; then
  echo "error: $DIST_DIR does not look built. Run 'make build debug' first or omit --no-build." >&2
  exit 1
fi

# If invoked inside Distrobox, build in the container but launch GNOME Shell on
# the host. /home is shared, so the host can read this script and dist/.
if [[ "${ANVIL_DEVKIT_ON_HOST:-0}" != "1" ]] && is_container && command -v distrobox-host-exec >/dev/null 2>&1; then
  echo "==> Re-executing on the Bazzite host via distrobox-host-exec"
  exec distrobox-host-exec env ANVIL_DEVKIT_ON_HOST=1 bash --noprofile --norc "$SCRIPT_PATH" --no-build "${ORIGINAL_ARGS[@]}"
fi

need_cmd gnome-shell
need_cmd dbus-run-session
need_cmd gdbus
need_cmd gsettings

if ! gnome-shell --help 2>&1 | grep -q -- '--devkit'; then
  echo "error: this gnome-shell does not support --devkit" >&2
  exit 1
fi

SESSION_DIR="$(mktemp -d -t anvil-devkit.XXXXXX)"
LOG_FILE="$SESSION_DIR/gnome-shell.log"
INNER_SCRIPT="$SESSION_DIR/run-inside-dbus.sh"
XDG_DATA_HOME_DEVKIT="$SESSION_DIR/data"
XDG_CONFIG_HOME_DEVKIT="$SESSION_DIR/config"
XDG_CACHE_HOME_DEVKIT="$SESSION_DIR/cache"

cleanup() {
  local status=$?
  if (( KEEP_TEMP )); then
    echo "==> Kept devkit session directory: $SESSION_DIR"
    echo "==> GNOME Shell log: $LOG_FILE"
  else
    rm -rf "$SESSION_DIR"
  fi
  exit "$status"
}
trap cleanup EXIT

mkdir -p \
  "$XDG_DATA_HOME_DEVKIT/gnome-shell/extensions" \
  "$XDG_CONFIG_HOME_DEVKIT" \
  "$XDG_CACHE_HOME_DEVKIT"
ln -sfn "$DIST_DIR" "$XDG_DATA_HOME_DEVKIT/gnome-shell/extensions/$UUID"

cat > "$INNER_SCRIPT" <<'INNER'
#!/usr/bin/env bash
set -Eeuo pipefail

launch_terminal() {
  if [[ "${LAUNCH_TERMINAL}" != "1" ]]; then
    return 0
  fi

  echo "==> Launching terminal inside nested session"
  local -a nested_env=(env "WAYLAND_DISPLAY=${NESTED_WAYLAND_DISPLAY}")
  if [[ -n "${NESTED_X11_DISPLAY:-}" ]]; then
    nested_env+=("DISPLAY=${NESTED_X11_DISPLAY}")
  fi
  if [[ -n "${NESTED_XAUTHORITY:-}" ]]; then
    nested_env+=("XAUTHORITY=${NESTED_XAUTHORITY}")
  fi

  if [[ -n "${TERMINAL_CMD}" ]]; then
    "${nested_env[@]}" bash -lc "${TERMINAL_CMD}" >/dev/null 2>&1 &
    return 0
  fi

  if command -v ptyxis >/dev/null 2>&1; then
    "${nested_env[@]}" ptyxis --new-window >/dev/null 2>&1 &
  elif command -v kgx >/dev/null 2>&1; then
    "${nested_env[@]}" kgx >/dev/null 2>&1 &
  elif command -v gnome-terminal >/dev/null 2>&1; then
    "${nested_env[@]}" gnome-terminal >/dev/null 2>&1 &
  elif command -v alacritty >/dev/null 2>&1; then
    "${nested_env[@]}" alacritty >/dev/null 2>&1 &
  elif command -v kitty >/dev/null 2>&1; then
    "${nested_env[@]}" kitty >/dev/null 2>&1 &
  elif command -v foot >/dev/null 2>&1; then
    "${nested_env[@]}" foot >/dev/null 2>&1 &
  elif command -v wezterm >/dev/null 2>&1; then
    "${nested_env[@]}" wezterm start >/dev/null 2>&1 &
  elif command -v xterm >/dev/null 2>&1; then
    "${nested_env[@]}" xterm >/dev/null 2>&1 &
  else
    echo "warning: no known terminal found on host; open one manually with:"
    echo "  WAYLAND_DISPLAY=${NESTED_WAYLAND_DISPLAY} DBUS_SESSION_BUS_ADDRESS=${DBUS_SESSION_BUS_ADDRESS} ptyxis"
  fi
}

wait_for_shell_dbus() {
  for _ in $(seq 1 150); do
    if gdbus call --session \
      --dest org.gnome.Shell \
      --object-path /org/gnome/Shell \
      --method org.gnome.Shell.Extensions.ListExtensions >/dev/null 2>&1; then
      return 0
    fi
    if ! kill -0 "${SHELL_PID}" 2>/dev/null; then
      echo "error: gnome-shell exited before D-Bus became ready" >&2
      exit 1
    fi
    sleep 0.2
  done
  echo "error: timed out waiting for org.gnome.Shell on isolated D-Bus" >&2
  exit 1
}

wait_for_extension_active() {
  local info=""
  for _ in $(seq 1 150); do
    info="$(gdbus call --session \
      --dest org.gnome.Shell \
      --object-path /org/gnome/Shell \
      --method org.gnome.Shell.Extensions.GetExtensionInfo \
      "${UUID}" 2>&1 || true)"
    # Accept state 1 / 1.0 (GVariant repr in some versions) or enabled true
    if [[ "${info}" == *"state"* && ( "${info}" == *"<1>"* || "${info}" == *"<uint32 1>"* || "${info}" == *"<1.0>"* ) ]] || [[ "${info}" == *"enabled': <true>"* ]]; then
      return 0
    fi
    sleep 0.2
  done
  echo "error: extension did not become ACTIVE. Last GetExtensionInfo output:" >&2
  echo "${info}" >&2
  exit 1
}

wait_for_nested_display() {
  NESTED_WAYLAND_DISPLAY=""
  NESTED_X11_DISPLAY=""
  NESTED_XAUTHORITY=""
  for _ in $(seq 1 150); do
    NESTED_WAYLAND_DISPLAY="$(grep -oE "Using Wayland display name 'wayland-[0-9]+'" "${LOG_FILE}" | tail -1 | grep -oE 'wayland-[0-9]+' || true)"
    NESTED_X11_DISPLAY="$(grep -oE 'Using public X11 display :[0-9]+' "${LOG_FILE}" | awk '{print $5}' | tail -1 || true)"
    if [[ -n "${NESTED_WAYLAND_DISPLAY}" ]]; then
      if [[ -n "${NESTED_X11_DISPLAY}" ]]; then
        local xwayland_pid arg_index
        # Mutter starts Xwayland lazily. Trigger it before launching an X11
        # client, then pass its newly-created authority file to that client.
        DISPLAY="${NESTED_X11_DISPLAY}" xprop -root >/dev/null 2>&1 || true
        for _ in $(seq 1 25); do
          xwayland_pid="$(pgrep -P "${SHELL_PID}" -x Xwayland 2>/dev/null | tail -n 1 || true)"
          if [[ -n "${xwayland_pid}" && -r "/proc/${xwayland_pid}/cmdline" ]]; then
            local -a xwayland_args=()
            readarray -d '' -t xwayland_args < "/proc/${xwayland_pid}/cmdline"
            for arg_index in "${!xwayland_args[@]}"; do
              if [[ "${xwayland_args[$arg_index]}" == "-auth" ]]; then
                NESTED_XAUTHORITY="${xwayland_args[$((arg_index + 1))]:-}"
                break
              fi
            done
            [[ -n "${NESTED_XAUTHORITY}" ]] && break
          fi
          sleep 0.1
        done
      fi
      export NESTED_WAYLAND_DISPLAY NESTED_X11_DISPLAY
      return 0
    fi
    if ! kill -0 "${SHELL_PID}" 2>/dev/null; then
      echo "error: gnome-shell exited before announcing Wayland display" >&2
      exit 1
    fi
    sleep 0.2
  done
  echo "error: timed out waiting for nested Wayland display name" >&2
  exit 1
}

update_activation_environment() {
  local dict="{'WAYLAND_DISPLAY': '${NESTED_WAYLAND_DISPLAY}'"
  if [[ -n "${NESTED_X11_DISPLAY}" ]]; then
    dict="${dict}, 'DISPLAY': '${NESTED_X11_DISPLAY}'"
  fi
  dict="${dict}}"

  gdbus call --session \
    --dest org.freedesktop.DBus \
    --object-path /org/freedesktop/DBus \
    --method org.freedesktop.DBus.UpdateActivationEnvironment \
    "${dict}" >/dev/null 2>&1 || true
}

cleanup_inner() {
  if [[ -n "${TAIL_PID:-}" ]]; then
    kill "${TAIL_PID}" 2>/dev/null || true
  fi
  if [[ -n "${SHELL_PID:-}" ]]; then
    kill "${SHELL_PID}" 2>/dev/null || true
    wait "${SHELL_PID}" 2>/dev/null || true
  fi
}
trap cleanup_inner EXIT INT TERM

: > "${LOG_FILE}"
tail -n +1 -F "${LOG_FILE}" &
TAIL_PID=$!

# Prime the isolated session's settings before GNOME Shell starts.
gsettings set org.gnome.shell welcome-dialog-last-shown-version 999 >/dev/null 2>&1 || true
gsettings set org.gnome.mutter center-new-windows true >/dev/null 2>&1 || true
gsettings set org.gnome.mutter auto-maximize false >/dev/null 2>&1 || true
gsettings set org.gnome.shell.extensions.anvil test-mode true >/dev/null 2>&1 || true

# Disable all other extensions (GSConnect, Blur My Shell, etc.) to reduce
# crashes, St criticals, and flakiness in the nested devkit session.
gsettings set org.gnome.shell enabled-extensions "['${UUID}']" >/dev/null 2>&1 || true

echo "==> Starting nested GNOME Shell devkit"
echo "==> Log: ${LOG_FILE}"

gnome-shell --wayland --devkit "$@" >>"${LOG_FILE}" 2>&1 &
SHELL_PID=$!

wait_for_shell_dbus
wait_for_nested_display
update_activation_environment

echo "==> Nested WAYLAND_DISPLAY=${NESTED_WAYLAND_DISPLAY} DISPLAY=${NESTED_X11_DISPLAY:-<none>}"

echo "==> Enabling ${UUID}"
gdbus call --session \
  --dest org.gnome.Shell \
  --object-path /org/gnome/Shell \
  --method org.gnome.Shell.Extensions.EnableExtension \
  "${UUID}" || true
wait_for_extension_active

echo "==> ${UUID} is ACTIVE"

echo "==> Disabling all extensions except ${UUID} at runtime"
OTHER_EXTS=$(gdbus call --session \
  --dest org.gnome.Shell \
  --object-path /org/gnome/Shell \
  --method org.gnome.Shell.Extensions.ListExtensions 2>/dev/null | \
  grep -oE "'[a-zA-Z0-9@._-]+'" | tr -d "'" | grep -v "^${UUID}$" | sort -u || true)
for ext in $OTHER_EXTS; do
  gdbus call --session \
    --dest org.gnome.Shell \
    --object-path /org/gnome/Shell \
    --method org.gnome.Shell.Extensions.DisableExtension \
    "$ext" >/dev/null 2>&1 || true
done

launch_terminal

cat <<EOF

Devkit session is running.
To test the terminal resize issue:
  1. Use the terminal in the nested GNOME Shell window.
  2. Open nvim/tmux/opencode/etc.
  3. Delete characters or paste content and watch for resize flicker.

Stop with Ctrl+C in this terminal.
Rebuild/retest loop:
  make build debug
  .agents/skills/gnome-shell-debug/scripts/run-devkit-session.sh --no-build

EOF

wait "${SHELL_PID}"
INNER
chmod +x "$INNER_SCRIPT"

export UUID
export LOG_FILE
export LAUNCH_TERMINAL
export TERMINAL_CMD
export XDG_DATA_HOME="$XDG_DATA_HOME_DEVKIT"
export XDG_CONFIG_HOME="$XDG_CONFIG_HOME_DEVKIT"
export XDG_CACHE_HOME="$XDG_CACHE_HOME_DEVKIT"
export GSETTINGS_SCHEMA_DIR="$DIST_DIR/schemas"

cat <<EOF
==> Isolated devkit profile: $SESSION_DIR
==> Extension symlink: $XDG_DATA_HOME_DEVKIT/gnome-shell/extensions/$UUID -> $DIST_DIR
==> Starting isolated D-Bus session
EOF

dbus-run-session -- bash "$INNER_SCRIPT" "${EXTRA_SHELL_ARGS[@]}"
