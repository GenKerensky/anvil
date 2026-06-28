#!/usr/bin/env bash
# List session logs eligible for /dream distillation.
# Only session-YYYY-MM-DD.md in .agents/logs/ root (see AGENTS.md).
# Excludes .agents/logs/local/ (ephemeral, wiped by clean-local-logs.sh).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOGS_DIR="$(cd "$SCRIPT_DIR/../../../logs" && pwd -P)"

if [[ ! -d "$LOGS_DIR" ]]; then
  echo "No .agents/logs directory" >&2
  exit 0
fi

found=0
while IFS= read -r -d '' f; do
  printf '%s\n' "$f"
  found=1
done < <(find "$LOGS_DIR" -maxdepth 1 -type f -regextype posix-extended -regex '.*/session-[0-9]{4}-[0-9]{2}-[0-9]{2}\.md' -print0 | sort -z)

if [[ "$found" -eq 0 ]]; then
  echo "No session logs to distill" >&2
fi