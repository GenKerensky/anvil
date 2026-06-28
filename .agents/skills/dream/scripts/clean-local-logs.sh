#!/usr/bin/env bash
# Remove ephemeral files from .agents/logs/local/ (keeps .gitkeep).
# Called at the end of every /dream run.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOCAL_DIR="$(cd "$SCRIPT_DIR/../../../logs/local" && pwd -P)"

if [[ ! -d "$LOCAL_DIR" ]]; then
  echo "0"
  exit 0
fi

count=0
while IFS= read -r -d '' f; do
  rm -f "$f"
  count=$((count + 1))
done < <(find "$LOCAL_DIR" -mindepth 1 -maxdepth 1 ! -name '.gitkeep' -print0 2>/dev/null)

echo "$count"