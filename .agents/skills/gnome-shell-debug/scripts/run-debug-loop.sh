#!/usr/bin/env bash
# Agent debug loop entrypoint — sole owner of `make build debug`.
#
# Re-execs on Bazzite host via distrobox-host-exec when invoked inside Distrobox,
# then delegates to debug_loop.py with --no-build.

set -Eeuo pipefail

SCRIPT_PATH="$(readlink -f "${BASH_SOURCE[0]}")"
SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_PATH")" && pwd -P)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd -P)"
DIST_DIR="$PROJECT_ROOT/dist"

BUILD=1
RM_SESSION_DIR=0
FORWARD_ARGS=()
ORIGINAL_ARGS=("$@")

usage() {
  cat <<EOF
Usage: $0 [options] [-- debug_loop.py run options]

Runs a single headless agent debug iteration with JSON artifacts.

Options:
  --no-build         Skip 'make build debug' (also set on distrobox re-exec)
  --rm-session-dir   Delete session directory after iteration (default: keep)
  -h, --help         Show this help

Forwarded to debug_loop.py run:
  --script, --session-dir, --iteration, --timeout, --observe,
  --success-pattern, --results-path, --json, --dry-run

Examples:
  $0 --script test/debug/local/repro.js --json --iteration 1
  $0 --no-build --session-dir /tmp/anvil-debug-loop.abc --script test/debug/local/repro.js --iteration 2
EOF
}

while (($#)); do
  case "$1" in
    --no-build)
      BUILD=0
      # Wrapper always passes --no-build; do not forward a duplicate.
      shift
      ;;
    --rm-session-dir)
      RM_SESSION_DIR=1
      FORWARD_ARGS+=("$1")
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --)
      shift
      FORWARD_ARGS+=("$@")
      break
      ;;
    *)
      FORWARD_ARGS+=("$1")
      shift
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

export ANVIL_DEBUG_LOOP=1

if (( BUILD )) && [[ "${ANVIL_DEBUG_LOOP_ON_HOST:-0}" != "1" ]]; then
  echo "==> Building Anvil debug dist in $PROJECT_ROOT"
  make -C "$PROJECT_ROOT" build debug
fi

if [[ ! -f "$DIST_DIR/extension.js" || ! -f "$DIST_DIR/metadata.json" ]]; then
  echo "error: $DIST_DIR does not look built. Run 'make build debug' first or omit --no-build." >&2
  exit 1
fi

if [[ "${ANVIL_DEBUG_LOOP_ON_HOST:-0}" != "1" ]] && is_container && command -v distrobox-host-exec >/dev/null 2>&1; then
  echo "==> Re-executing on the Bazzite host via distrobox-host-exec"
  exec distrobox-host-exec env ANVIL_DEBUG_LOOP_ON_HOST=1 ANVIL_DEBUG_LOOP=1 \
    bash --noprofile --norc "$SCRIPT_PATH" --no-build "${ORIGINAL_ARGS[@]}"
fi

need_cmd python3
need_cmd gnome-shell
need_cmd gdbus
need_cmd gsettings

LOOP_ARGS=(run --no-build --keep-session-dir)
if (( RM_SESSION_DIR )); then
  LOOP_ARGS=(run --no-build --rm-session-dir)
fi

exec python3 "$SCRIPT_DIR/debug_loop.py" "${LOOP_ARGS[@]}" "${FORWARD_ARGS[@]}"