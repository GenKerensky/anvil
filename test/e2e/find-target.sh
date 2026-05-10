#!/usr/bin/env bash
# Finds a reference image within a screenshot using ImageMagick template matching.
# Usage: ./find-target.sh <screenshot.png> <reference.png> [threshold]
# Exits 0 and prints coordinates if found, exits 1 if not found.
#
# Requires: imagemagick

set -euo pipefail

SCREENSHOT="${1:?Usage: find-target.sh <screenshot.png> <reference.png> [threshold]}"
REFERENCE="${2:?Usage: find-target.sh <screenshot.png> <reference.png> [threshold]}"
THRESHOLD="${3:-0.15}"  # normalized mean square error threshold

if [[ ! -f "${SCREENSHOT}" ]]; then
  echo "Screenshot not found: ${SCREENSHOT}" >&2
  exit 1
fi

if [[ ! -f "${REFERENCE}" ]]; then
  echo "Reference image not found: ${REFERENCE}" >&2
  exit 1
fi

# Use ImageMagick's compare with RMSE metric to find best match location
# We use 'subimage-search' to locate the reference within the screenshot
RESULT=$(compare -metric RMSE -subimage-search \
  "${SCREENSHOT}" "${REFERENCE}" \
  /dev/null 2>&1) || true

# compare exits 1 even on success when metric > 0, so we parse the output
# Output format: "XXXXXX (normalized) @ XX,YY"
NORMALIZED=$(echo "${RESULT}" | grep -oP '\(\K[0-9.]+(?=\))' | head -1) || true
COORDS=$(echo "${RESULT}" | grep -oP '@ \K[0-9]+,[0-9]+' | head -1) || true

if [[ -z "${NORMALIZED}" ]] || [[ -z "${COORDS}" ]]; then
  exit 1
fi

# Check if the normalized error is within the acceptable threshold
# Use awk for float comparison
WITHIN_THRESHOLD=$(awk "BEGIN { print (${NORMALIZED} <= ${THRESHOLD}) ? \"yes\" : \"no\" }")

if [[ "${WITHIN_THRESHOLD}" == "yes" ]]; then
  echo "${COORDS}"
  exit 0
else
  exit 1
fi
