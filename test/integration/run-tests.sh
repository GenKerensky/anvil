#!/usr/bin/env bash
# Anvil E2E Test Runner
# Usage: ./test/integration/run-tests.sh [-v FEDORA_VERSION] [-k]
#   -v  Fedora version (42, 43, 44). Default: 44
#   -k  Keep container running after tests (useful for debugging)
#
# The test session runs gnome-shell --headless --wayland inside the container.
# Keyboard-driven keybinding tests and pixel-level visual tests are not
# feasible with this mode (GNOME 50 removed the --nested flag). All testing
# uses D-Bus methods, gsettings, and Shell.Eval.

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

UUID="anvil@GenKerensky.github.com"
IMAGE="anvil-test-pod:fedora-${FEDORA_VERSION}"
SCHEMA_ID="org.gnome.shell.extensions.anvil"
SCHEMA_DIR="/home/gnomeshell/.local/share/gnome-shell/extensions/${UUID}/schemas"
SERVICE_NAME="org.gnome.Shell.AnvilTest"
OBJECT_PATH="/org/gnome/Shell/AnvilTest"
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
# virtual-keyboard protocol. In practice, gnome-shell --headless --wayland
# does NOT implement zwp_virtual_keyboard_v1, so these functions serve as
# no-ops / documentation of what keyboard tests would look like if available.
#
# Key format follows wtype conventions:
#   send_keystroke "Return"
#   send_keystroke "super+h"
#
# For modifier combos use send_key_combo instead.
send_keystroke() {
  local KEY="${1}"
  do_in_pod wtype -k "${KEY}" 2>/dev/null || true
  sleep 0.3
}

# Send a modifier+key combination via wtype.
# Usage: send_key_combo super h     →  Super+H
#        send_key_combo alt F4     →  Alt+F4
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
  do_in_pod bash -c "${CMD}" 2>/dev/null || true
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

# Get extension errors via D-Bus, returning "()" on success or error details.
get_extension_errors() {
  do_in_pod gdbus call --session \
    --dest org.gnome.Shell \
    --object-path /org/gnome/Shell \
    --method org.gnome.Shell.Extensions.GetExtensionErrors \
    "'${UUID}'" 2>/dev/null || echo "(@as [],)"
}

# Capture the current Wayland framebuffer using grim.
# grim speaks the wlr-screencopy Wayland protocol, which gnome-shell --headless
# may or may not expose. If grim fails, the warning is non-fatal.
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
# It runs: start-session.sh → session D-Bus + dbusmock stubs +
#                               gnome-shell --headless --wayland
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

# Copy the updated start-session.sh and set-env.sh into the container (the
# image has the old versions baked in, but we need new versions with:
#   - GSETTINGS_SCHEMA_DIR so the automation agent can create Gio.Settings
#   - --automation-script support for the JS test agent
podman cp "${SCRIPT_DIR}/start-session.sh" "${POD}:/usr/local/bin/start-session.sh"
podman cp "${SCRIPT_DIR}/set-env.sh" "${POD}:/usr/local/bin/set-env.sh"
do_in_pod sudo chmod 0755 /usr/local/bin/start-session.sh /usr/local/bin/set-env.sh

# Copy the JS test agent into the container (will be loaded by --automation-script)
AGENT_DIR="/home/gnomeshell/agent"
do_in_pod mkdir -p "${AGENT_DIR}"
podman cp "${SCRIPT_DIR}/agent/agent.js" "${POD}:${AGENT_DIR}/agent.js"

# Restart gnome-shell so it discovers the freshly installed extension.
# Write the automation script path to a marker file that start-session.sh reads.
# This is more reliable than systemctl set-environment (which has inheritance
# issues through sudo + systemd user switching).
do_in_pod bash -c "echo '${AGENT_DIR}/agent.js' > /tmp/anvil-automation-script"
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

# Step 4: Wait for the AnvilTest agent D-Bus service to be available
echo "Waiting for AnvilTest agent…"
for i in $(seq 1 40); do
  if do_in_pod gdbus call --session \
      --dest "${SERVICE_NAME}" \
      --object-path "${OBJECT_PATH}" \
      --method "org.gnome.Shell.AnvilTest.Ping" &>/dev/null; then
    echo "AnvilTest agent ready after ${i}s"
    break
  fi
  if [[ "${i}" -eq 40 ]]; then
    echo "Error: AnvilTest agent did not become ready." >&2
    do_in_pod journalctl -u gnome-headless.service --no-pager 2>/dev/null || true
    exit 1
  fi
  sleep 1
done

sleep 2

# ---------------------------------------------------------------------------
# Test cases (Behave BDD)
# ---------------------------------------------------------------------------

set +e

# Enable the extension via gnome-extensions (the agent also tries via JS API,
# but this is the authoritative mechanism)
echo "Enabling extension..."
do_in_pod gnome-extensions enable "${UUID}" 2>&1 || echo "Warning: gnome-extensions enable returned $?"
sleep 3

# Verify behave is available
echo "Checking behave availability..."
do_in_pod bash -c "which behave && behave --version" 2>&1 || echo "Warning: behave not found"

# Copy updated feature files and step definitions into the container
echo "Copying feature files into container..."
podman cp "${SCRIPT_DIR}/features/." "${POD}:/usr/local/share/anvil-tests/features/" 2>&1 || echo "Warning: podman cp features failed"

# Run all Behave features (agent gsettings, AT-SPI tree, preferences)
echo "Starting Behave test suite..."
REPORT_NAME="behave-report-$(date +%Y%m%d-%H%M%S).html"
OUTPUT=$(do_in_pod bash -c "cd /usr/local/share/anvil-tests && behave --no-skipped -f html-pretty -o /tmp/${REPORT_NAME} -f pretty 2>&1")
EXIT_CODE=$?

echo "${OUTPUT}"

# Copy the HTML report out of the container
mkdir -p "${OUTPUT_DIR}"
do_in_pod cat "/tmp/${REPORT_NAME}" > "${OUTPUT_DIR}/${REPORT_NAME}" 2>/dev/null \
  && echo "HTML report: ${OUTPUT_DIR}/${REPORT_NAME}" \
  || echo "Warning: Could not copy HTML report"

# Parse behave output for step-level pass/fail counts
PY_PASS=$(echo "${OUTPUT}" | grep -oP '[0-9]+(?= step[s]? passed)' | tail -1 || echo "0")
PY_FAIL=$(echo "${OUTPUT}" | grep -oP '[0-9]+(?= step[s]? failed)' | tail -1 || echo "0")

PASS_COUNT=$((PASS_COUNT + PY_PASS))
FAIL_COUNT=$((FAIL_COUNT + PY_FAIL))

if [[ "${EXIT_CODE}" -ne 0 ]] && [[ "${PY_FAIL}" -eq 0 ]]; then
  FAIL_COUNT=$((FAIL_COUNT + 1))
  FAILED_TESTS+=("behave (crashed before any steps)")
fi

set -e

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
