#!/usr/bin/env bash
# Anvil E2E Test Runner
# Usage: ./test/e2e/run-tests.sh [-v FEDORA_VERSION] [-k]
#   -v  Fedora version (42, 43, 44). Default: 44
#   -k  Keep container running after tests (useful for debugging)
#
# The test session runs gnome-shell --headless --wayland inside the container.
# This is the correct headless mode for GNOME 50, which is phasing out X11
# login sessions. The headless Wayland compositor needs no Xvfb or DRM device.

set -euo pipefail

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
FEDORA_VERSION="44"
KEEP_CONTAINER="false"

while [[ $# -gt 0 ]]; do
  case "${1}" in
    -v) FEDORA_VERSION="${2}"; shift 2 ;;
    -k) KEEP_CONTAINER="true"; shift ;;
    *)  echo "Unknown argument: ${1}"; exit 1 ;;
  esac
done

# ---------------------------------------------------------------------------
# Paths and identifiers
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

UUID="anvil@genkerensky.com"
IMAGE="anvil-test-pod:fedora-${FEDORA_VERSION}"
SCHEMA_ID="org.gnome.shell.extensions.anvil"
SCHEMA_DIR="/home/gnomeshell/.local/share/gnome-shell/extensions/${UUID}/schemas"
OUTPUT_DIR="${SCRIPT_DIR}/output"
# The Wayland socket name created by gnome-shell --headless inside the container.
# gnome-shell picks wayland-0 by default when XDG_RUNTIME_DIR is clean.
WAYLAND_DISPLAY_NAME="wayland-0"

# ---------------------------------------------------------------------------
# Test counters and bookkeeping
# ---------------------------------------------------------------------------
PASS_COUNT=0
FAIL_COUNT=0
TEST_NAMES=()
FAILED_TESTS=()

# ---------------------------------------------------------------------------
# Trap / cleanup
# ---------------------------------------------------------------------------
POD=""  # set after container starts

cleanup() {
  if [[ -n "${POD}" ]] && [[ "${KEEP_CONTAINER}" == "false" ]]; then
    echo "Stopping container ${POD}..."
    podman stop "${POD}" 2>/dev/null || true
  elif [[ -n "${POD}" ]]; then
    echo "Container left running: ${POD}"
    echo "To stop: podman stop ${POD}"
  fi
}

trap cleanup EXIT INT TERM

# ---------------------------------------------------------------------------
# Core helpers
# ---------------------------------------------------------------------------

# Run a command inside the container as the gnomeshell user with the correct
# environment (DISPLAY, DBUS_SESSION_BUS_ADDRESS, etc.) via set-env.sh.
do_in_pod() {
  podman exec --user gnomeshell --workdir /home/gnomeshell "${POD}" set-env.sh "$@"
}

# Press and release a key or key combo using wtype, which speaks the Wayland
# virtual-keyboard protocol and works with gnome-shell --headless --wayland.
#
# Key format follows wtype conventions:
#   send_keystroke "Return"
#   send_keystroke "super+h"      — modifier+key via wrapper below
#
# For modifier combos use send_key_combo instead.
send_keystroke() {
  local KEY="${1}"
  do_in_pod wtype -k "${KEY}"
  sleep 0.3
}

# Send a modifier+key combination via wtype.
# MOD can be a single modifier or comma-separated: "shift,super"
# Usage: send_key_combo super h     →  Super+H
#        send_key_combo shift,super s  →  Shift+Super+S
#        send_key_combo alt F4
send_key_combo() {
  local MOD="${1}"
  local KEY="${2}"
  local CMD="wtype"
  local IFS=","
  for m in ${MOD}; do
    CMD="${CMD} -M ${m}"
  done
  CMD="${CMD} -k ${KEY}"
  for m in ${MOD}; do
    CMD="${CMD} -m ${m}"
  done
  do_in_pod bash -c "${CMD}"
  sleep 0.3
}

# Write a GSettings key for the Anvil schema.
set_setting() {
  local KEY="${1}"
  local VALUE="${2}"
  do_in_pod gsettings --schemadir "${SCHEMA_DIR}" set "${SCHEMA_ID}" "${KEY}" "${VALUE}"
}

# Read a GSettings key for the Anvil schema.
get_setting() {
  local KEY="${1}"
  do_in_pod gsettings --schemadir "${SCHEMA_DIR}" get "${SCHEMA_ID}" "${KEY}"
}

# Evaluate a JavaScript snippet inside GNOME Shell via org.gnome.Shell.Eval.
# Returns the inner value after stripping the (true/false, '...') D-Bus wrapper.
eval_js() {
  local SCRIPT="${1}"
  local RAW
  RAW=$(do_in_pod gdbus call --session \
    --dest org.gnome.Shell \
    --object-path /org/gnome/Shell \
    --method org.gnome.Shell.Eval \
    "${SCRIPT}" 2>/dev/null) || { echo "null"; return 1; }
  # Strip (true, '...') or (false, '...') D-Bus wrapper to get the raw value.
  # sed: remove the outer parens, boolean, comma, and surrounding quotes.
  echo "${RAW}" | sed "s/^(true, '\\(.*\\)')$/\\1/" \
                | sed "s/^(false, '\\(.*\\)')$/\\1/"
}

# Get extension errors via D-Bus, returning "()" on success or error details.
get_extension_errors() {
  do_in_pod gdbus call --session \
    --dest org.gnome.Shell \
    --object-path /org/gnome/Shell \
    --method org.gnome.Shell.Extensions.GetExtensionErrors \
    "'${UUID}'" 2>/dev/null || echo "(@as [],)"
}

# Capture the current Wayland framebuffer using grim and save it as a PNG.
# grim speaks the wlr-screencopy Wayland protocol, which gnome-shell --headless
# exposes via the wlr-screencopy-unstable-v1 interface.
screenshot() {
  local NAME="${1:-screenshot}"
  mkdir -p "${OUTPUT_DIR}"
  do_in_pod grim "/tmp/${NAME}.png" 2>/dev/null \
    && podman cp "${POD}:/tmp/${NAME}.png" "${OUTPUT_DIR}/${NAME}.png" 2>/dev/null \
    || echo "Warning: Could not capture screenshot (grim may not support this compositor)"
}

# ---------------------------------------------------------------------------
# Assertion helpers
# ---------------------------------------------------------------------------

# Assert that ACTUAL equals EXPECTED; record pass/fail and screenshot on failure.
assert_eq() {
  local DESCRIPTION="${1}"
  local ACTUAL="${2}"
  local EXPECTED="${3}"
  TEST_NAMES+=("${DESCRIPTION}")
  if [[ "${ACTUAL}" == "${EXPECTED}" ]]; then
    echo "  ✓ ${DESCRIPTION}"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    echo "  ✗ ${DESCRIPTION}"
    echo "    Expected: ${EXPECTED}"
    echo "    Actual:   ${ACTUAL}"
    FAIL_COUNT=$((FAIL_COUNT + 1))
    FAILED_TESTS+=("${DESCRIPTION}")
    screenshot "fail-${DESCRIPTION// /-}"
  fi
}

# Evaluate a JS snippet inside the Shell and assert the result equals EXPECTED.
assert_js() {
  local DESCRIPTION="${1}"
  local SCRIPT="${2}"
  local EXPECTED="${3}"
  local RESULT
  RESULT=$(eval_js "${SCRIPT}") || RESULT="eval-error"
  assert_eq "${DESCRIPTION}" "${RESULT}" "${EXPECTED}"
}

# Print a labelled section header in the test output.
run_test_section() {
  local NAME="${1}"
  echo ""
  echo "── ${NAME} ──"
}

# ---------------------------------------------------------------------------
# Pre-flight checks
# ---------------------------------------------------------------------------

if ! command -v podman &>/dev/null; then
  echo "Error: podman is not installed or not in PATH."
  echo "Please install podman and try again."
  exit 1
fi

if ! podman image exists "${IMAGE}"; then
  echo "Error: Container image '${IMAGE}' not found."
  echo "Build it first with:"
  echo "  ./test/e2e/build-container.sh ${FEDORA_VERSION}"
  exit 1
fi

if [[ ! -f "${PROJECT_ROOT}/${UUID}.zip" ]]; then
  echo "Error: Extension archive '${UUID}.zip' not found in project root."
  echo "Build it first with:"
  echo "  make dist"
  exit 1
fi

# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------

mkdir -p "${OUTPUT_DIR}"

echo "Anvil E2E Tests — Fedora ${FEDORA_VERSION} / headless Wayland"
echo "══════════════════════════════════"

# Start the container
POD=$(podman run --rm --cap-add=SYS_NICE --cap-add=IPC_LOCK -td "${IMAGE}")
echo "Container: ${POD:0:12}"

# Wait for the user D-Bus socket to appear
do_in_pod wait-user-bus.sh
sleep 2

# Suppress the GNOME first-run welcome dialog
do_in_pod gsettings set org.gnome.shell welcome-dialog-last-shown-version "999" 2>/dev/null || true

# Center newly opened windows so positions are predictable
do_in_pod gsettings set org.gnome.mutter center-new-windows true 2>/dev/null || true

# The gnome-headless.service unit is enabled in graphical.target.wants inside
# the container image, so it starts automatically with systemd.
# It runs: start-session.sh → session D-Bus + dbusmock stubs + gnome-shell --headless --wayland
# We poll for the Wayland socket and then the Shell D-Bus name.
echo "Waiting for GNOME Shell headless Wayland session..."
echo "(gnome-headless.service starts automatically via systemd)"
# Step 1: Wait for the Wayland socket to appear in XDG_RUNTIME_DIR.
for i in $(seq 1 40); do
  if do_in_pod test -S "/run/user/1000/${WAYLAND_DISPLAY_NAME}"; then
    echo "Wayland socket ready after ${i}s"
    break
  fi
  if [[ "${i}" -eq 40 ]]; then
    echo "Error: Wayland socket /run/user/1000/${WAYLAND_DISPLAY_NAME} did not appear." >&2
    do_in_pod journalctl -u gnome-headless.service --no-pager 2>/dev/null || true
    exit 1
  fi
  sleep 1
done

# Step 2: Wait for org.gnome.Shell to appear on the D-Bus session bus.
# The session D-Bus daemon started by start-session.sh uses the same fixed
# address (/run/user/1000/bus) that set-env.sh connects to.
for i in $(seq 1 40); do
  if do_in_pod gdbus call --session \
      --dest org.gnome.Shell \
      --object-path /org/gnome/Shell \
      --method org.gnome.Shell.Eval "'1'" &>/dev/null; then
    echo "GNOME Shell D-Bus ready after ${i}s"
    break
  fi
  if [[ "${i}" -eq 40 ]]; then
    echo "Error: org.gnome.Shell D-Bus name did not become available." >&2
    do_in_pod journalctl -u gnome-headless.service --no-pager 2>/dev/null || true
    exit 1
  fi
  sleep 1
done

# Give Shell a moment to fully settle after D-Bus registration
sleep 2

# Copy the extension archive into the container and install it
# The extension must be installed AFTER gnome-shell starts, because the
# system-level gnome-headless.service boots the shell before we get here.
# Install the zip, then restart the service so the shell picks up the new extension.
podman cp "${PROJECT_ROOT}/${UUID}.zip" "${POD}:/home/gnomeshell/"
do_in_pod gnome-extensions install --force "${UUID}.zip"

# Restart gnome-shell so it discovers the freshly installed extension
do_in_pod sudo systemctl restart gnome-headless.service
sleep 2

# Step 3: Re-wait for gnome-shell D-Bus after restart
for i in $(seq 1 40); do
  if do_in_pod gdbus call --session \
      --dest org.gnome.Shell \
      --object-path /org/gnome/Shell \
      --method org.gnome.Shell.Eval "'1'" &>/dev/null; then
    echo "GNOME Shell ready after restart (${i}s)"
    break
  fi
  if [[ "${i}" -eq 40 ]]; then
    echo "Error: org.gnome.Shell did not become ready after restart." >&2
    do_in_pod journalctl -u gnome-headless.service --no-pager 2>/dev/null || true
    exit 1
  fi
  sleep 1
done

sleep 2

# Put the extension into test mode BEFORE enabling it so the extension's
# enable() method can set global.context.unsafe_mode = true for Shell.Eval.
set_setting "test-mode" "true"

# Enable the extension
do_in_pod gnome-extensions enable "${UUID}"
sleep 3

# ---------------------------------------------------------------------------
# Test cases
# ---------------------------------------------------------------------------

source "${SCRIPT_DIR}/tests.sh"
run_all_tests

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

echo ""
echo "══════════════════════════════════"
echo "Results: ${PASS_COUNT} passed, ${FAIL_COUNT} failed"

if [[ ${FAIL_COUNT} -gt 0 ]]; then
  echo "Failed tests:"
  for t in "${FAILED_TESTS[@]}"; do
    echo "  - ${t}"
  done
  echo "Logs and screenshots: ${OUTPUT_DIR}/"
  # Save the systemd journal for post-mortem inspection
  mkdir -p "${OUTPUT_DIR}"
  do_in_pod journalctl --user -b --no-pager 2>/dev/null > "${OUTPUT_DIR}/journal.log" || true
  exit 1
fi

echo "All tests passed ✓"
