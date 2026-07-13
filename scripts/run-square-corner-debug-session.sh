#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_PATH="$(readlink -f "${BASH_SOURCE[0]}")"
PROJECT_ROOT="$(cd "$(dirname "$SCRIPT_PATH")/.." && pwd -P)"
DEVKIT_LAUNCHER="$PROJECT_ROOT/.agents/skills/gnome-shell-debug/scripts/run-devkit-session.sh"
FIXTURE_LAUNCHER="$PROJECT_ROOT/scripts/launch-square-corner-fixture.sh"

exec "$DEVKIT_LAUNCHER" \
  --terminal-cmd "$(printf '%q' "$FIXTURE_LAUNCHER")" \
  "$@"
