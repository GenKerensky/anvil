#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_PATH="$(readlink -f "${BASH_SOURCE[0]}")"
PROJECT_ROOT="$(cd "$(dirname "$SCRIPT_PATH")/.." && pwd -P)"
APP_DIR="$PROJECT_ROOT/test/debug/fixtures/electron-square-corners"

if [[ -z "${WAYLAND_DISPLAY:-}" && -z "${DISPLAY:-}" ]]; then
  echo "error: no Wayland or X11 display is available" >&2
  echo "Run this through scripts/run-square-corner-debug-session.sh." >&2
  exit 1
fi

electron_args=("$APP_DIR")
if [[ -n "${WAYLAND_DISPLAY:-}" ]]; then
  electron_args=(--ozone-platform=wayland "$APP_DIR")
fi

if command -v electron >/dev/null 2>&1; then
  exec electron "${electron_args[@]}"
fi

if ! command -v npx >/dev/null 2>&1; then
  echo "error: neither electron nor npx is installed" >&2
  exit 1
fi

echo "==> electron is not installed; using the cached npx Electron runtime"
exec npx --yes electron "${electron_args[@]}"
