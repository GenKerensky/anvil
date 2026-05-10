#!/usr/bin/env bash
# Anvil E2E Test Cases
# This file is SOURCED by run-tests.sh and has access to all helper functions:
#   assert_eq, assert_js, eval_js, get_extension_errors, set_setting, get_setting,
#   send_keystroke, send_key_combo, run_test_section, do_in_pod, screenshot
#
# Do NOT run this file directly.
#
# IMPORTANT: These tests avoid org.gnome.Shell.Eval for complex expressions
# because in GNOME Shell 45+ the eval scope may not have access to shell
# internals under ESM. Instead we use:
#   - org.gnome.Shell.Extensions (GetExtensionInfo, GetExtensionErrors, etc.)
#   - gsettings for settings checks
#   - gnome-extensions CLI for lifecycle
#   - global.__anvil_test_state.getTestState() (simple flag access via Eval)

UUID="anvil@GenKerensky.github.com"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# Extract the numeric state from GetExtensionInfo output.
get_ext_state() {
  local INFO
  INFO=$(do_in_pod gdbus call --session \
    --dest org.gnome.Shell \
    --object-path /org/gnome/Shell \
    --method org.gnome.Shell.Extensions.GetExtensionInfo \
    "'${UUID}'" 2>/dev/null) || { echo "-1"; return 1; }
  echo "${INFO}" | grep -oP "'state':\s*<\K[0-9.]+(?=>)" | cut -d. -f1
}

# Assert that a numeric field in GetExtensionInfo equals expected value.
assert_ext_state() {
  local DESCRIPTION="${1}"
  local EXPECTED="${2}"
  local ACTUAL
  ACTUAL=$(get_ext_state)
  assert_eq "${DESCRIPTION}" "${ACTUAL}" "${EXPECTED}"
}

# Evaluate a JS expression against the extension's test state.
# Calls global.__anvil_test_state.getTestState(), parses JSON, and returns
# the specified field value as a string. Returns "null" on failure.
eval_test_state() {
  local EXPR="${1}"
  eval_js "global.__anvil_test_state ? JSON.parse(global.__anvil_test_state.getTestState()).${EXPR} : null"
}

# ---------------------------------------------------------------------------
# 1. Extension Lifecycle
# ---------------------------------------------------------------------------

test_extension_lifecycle() {
  run_test_section "Extension Lifecycle"

  assert_ext_state "extension is ACTIVE" "1"

  local ERRORS
  ERRORS=$(get_extension_errors)
  assert_eq "extension has no errors" "${ERRORS}" "(@as [],)"

  local RESULT
  RESULT=$(get_setting "test-mode")
  assert_eq "test-mode is enabled" "${RESULT}" "true"
}

# ---------------------------------------------------------------------------
# 2. Basic Tiling
# ---------------------------------------------------------------------------

test_tiling_basic() {
  run_test_section "Basic Tiling"

  local RESULT
  RESULT=$(get_setting "tiling-mode-enabled")
  assert_eq "tiling mode is enabled by default" "${RESULT}" "true"

  do_in_pod bash -c "nohup gnome-text-editor --new-window >/dev/null 2>&1 &"
  sleep 5

  assert_eq "tree exists after window open" "$(eval_test_state "treeExists")" "true"

  # Keyboard-driven: close window via Alt+F4 (xdotool on DISPLAY=:99)
  send_key_combo "alt" "F4"
  sleep 2
}

# ---------------------------------------------------------------------------
# 3. Settings
# ---------------------------------------------------------------------------

test_settings() {
  run_test_section "Settings"

  local ORIGINAL
  ORIGINAL=$(get_setting "window-gap-size")
  set_setting "window-gap-size" "8"
  local RESULT
  RESULT=$(get_setting "window-gap-size")
  assert_eq "window-gap-size can be set" "${RESULT}" "uint32 8"
  set_setting "window-gap-size" "${ORIGINAL}"

  set_setting "tiling-mode-enabled" "false"
  RESULT=$(get_setting "tiling-mode-enabled")
  assert_eq "tiling-mode-enabled can be disabled" "${RESULT}" "false"

  set_setting "tiling-mode-enabled" "true"
  RESULT=$(get_setting "tiling-mode-enabled")
  assert_eq "tiling-mode-enabled can be re-enabled" "${RESULT}" "true"

  RESULT=$(get_setting "focus-border-toggle")
  assert_eq "focus-border-toggle is accessible" \
    "$([[ "${RESULT}" == "true" || "${RESULT}" == "false" ]] && echo "ok")" "ok"
}

# ---------------------------------------------------------------------------
# 4. Disable / Re-enable
# ---------------------------------------------------------------------------

test_extension_disable_reenable() {
  run_test_section "Disable / Re-enable"

  do_in_pod gdbus call --session \
    --dest org.gnome.Shell \
    --object-path /org/gnome/Shell \
    --method org.gnome.Shell.Extensions.DisableExtension \
    "'${UUID}'" 2>/dev/null || true
  sleep 3

  assert_ext_state "extension is INACTIVE after disable" "2"

  do_in_pod gdbus call --session \
    --dest org.gnome.Shell \
    --object-path /org/gnome/Shell \
    --method org.gnome.Shell.Extensions.EnableExtension \
    "'${UUID}'" 2>/dev/null || true
  sleep 4

  assert_ext_state "extension is ACTIVE after re-enable" "1"

  local ERRORS
  ERRORS=$(get_extension_errors)
  assert_eq "extension has no errors after re-enable" "${ERRORS}" "(@as [],)"
}

# ---------------------------------------------------------------------------
# 5. Preferences (D-Bus)
# ---------------------------------------------------------------------------

test_preferences() {
  run_test_section "Preferences"

  do_in_pod gdbus call --session \
    --dest org.gnome.Shell \
    --object-path /org/gnome/Shell \
    --method org.gnome.Shell.Extensions.OpenExtensionPrefs \
    "'${UUID}'" "''" "@a{sv} {}" 2>/dev/null || true
  sleep 8

  local ERRORS
  ERRORS=$(get_extension_errors)
  assert_eq "extension has no errors after opening prefs" "${ERRORS}" "(@as [],)"

  send_key_combo "alt" "F4"
  sleep 2
}

# ---------------------------------------------------------------------------
# 7. Layout Modes
#
# Verifies that stacked and tabbed tiling mode settings are accessible and
# that the tree structure correctly reflects enabled modes. Visual rendering
# of layout changes cannot be verified in a headless container.
# ---------------------------------------------------------------------------

test_layout_modes() {
  run_test_section "Layout Modes"

  assert_eq "stacked mode enabled by default" \
    "$(get_setting "stacked-tiling-mode-enabled")" "true"

  assert_eq "tabbed mode enabled by default" \
    "$(get_setting "tabbed-tiling-mode-enabled")" "true"

  do_in_pod bash -c "nohup gnome-text-editor --new-window >/dev/null 2>&1 &"
  sleep 5

  assert_eq "tiling enabled after window open" \
    "$(eval_test_state "tilingEnabled")" "true"

  # Toggle stacked mode via gsettings
  set_setting "stacked-tiling-mode-enabled" "false"
  assert_eq "stacked mode can be disabled" \
    "$(get_setting "stacked-tiling-mode-enabled")" "false"

  set_setting "stacked-tiling-mode-enabled" "true"
  assert_eq "stacked mode can be re-enabled" \
    "$(get_setting "stacked-tiling-mode-enabled")" "true"

  # Toggle tabbed mode via gsettings
  set_setting "tabbed-tiling-mode-enabled" "false"
  assert_eq "tabbed mode can be disabled" \
    "$(get_setting "tabbed-tiling-mode-enabled")" "false"

  set_setting "tabbed-tiling-mode-enabled" "true"
  assert_eq "tabbed mode can be re-enabled" \
    "$(get_setting "tabbed-tiling-mode-enabled")" "true"

  # Auto-split setting
  assert_eq "auto-split enabled by default" \
    "$(get_setting "auto-split-enabled")" "true"
  set_setting "auto-split-enabled" "false"
  assert_eq "auto-split can be disabled" \
    "$(get_setting "auto-split-enabled")" "false"
  set_setting "auto-split-enabled" "true"

  # Drag-and-drop center layout setting
  assert_eq "dnd-center-layout default" \
    "$(get_setting "dnd-center-layout")" "'tabbed'"

  send_key_combo "alt" "F4"
  sleep 2
}

# ---------------------------------------------------------------------------
# 8. Floating Mode
#
# Verifies the float-always-on-top setting. The window-toggle-float keybinding
# (<Super>c) cannot be tested because the headless compositor does not
# implement the virtual keyboard protocol required by wtype.
# ---------------------------------------------------------------------------

test_floating_mode() {
  run_test_section "Floating Mode"

  assert_eq "float-always-on-top default" \
    "$(get_setting "float-always-on-top-enabled")" "true"

  set_setting "float-always-on-top-enabled" "false"
  assert_eq "float-always-on-top can be disabled" \
    "$(get_setting "float-always-on-top-enabled")" "false"

  set_setting "float-always-on-top-enabled" "true"
  assert_eq "float-always-on-top can be re-enabled" \
    "$(get_setting "float-always-on-top-enabled")" "true"
}

# ---------------------------------------------------------------------------
# 9. Window Effects (Settings)
#
# Verifies that border-effect settings can be read and written. Visual
# verification of rendered borders, colors, and preview hints cannot be
# performed in a headless container — those require pixel-level checks
# on the compositor output.
# ---------------------------------------------------------------------------

test_window_effects() {
  run_test_section "Window Effects"

  # Focus border toggle
  set_setting "focus-border-toggle" "false"
  assert_eq "focus-border can be disabled" \
    "$(get_setting "focus-border-toggle")" "false"
  set_setting "focus-border-toggle" "true"
  assert_eq "focus-border can be re-enabled" \
    "$(get_setting "focus-border-toggle")" "true"

  # Split border toggle
  set_setting "split-border-toggle" "false"
  assert_eq "split-border can be disabled" \
    "$(get_setting "split-border-toggle")" "false"
  set_setting "split-border-toggle" "true"
  assert_eq "split-border can be re-enabled" \
    "$(get_setting "split-border-toggle")" "true"

  # Focus border size
  local SIZE
  SIZE=$(get_setting "focus-border-size")
  assert_eq "focus-border-size accessible" \
    "$(echo "${SIZE}" | grep -c "uint32")" "1"

  # Split border color
  local COLOR
  COLOR=$(get_setting "split-border-color")
  assert_eq "split-border-color accessible" \
    "$(echo "${COLOR}" | grep -c "rgba")" "1"

  # Preview hint toggle
  set_setting "preview-hint-enabled" "false"
  assert_eq "preview-hint can be disabled" \
    "$(get_setting "preview-hint-enabled")" "false"
  set_setting "preview-hint-enabled" "true"
  assert_eq "preview-hint can be re-enabled" \
    "$(get_setting "preview-hint-enabled")" "true"

  # Tab decoration toggle
  set_setting "showtab-decoration-enabled" "false"
  assert_eq "showtab-decoration can be disabled" \
    "$(get_setting "showtab-decoration-enabled")" "false"
  set_setting "showtab-decoration-enabled" "true"
  assert_eq "showtab-decoration can be re-enabled" \
    "$(get_setting "showtab-decoration-enabled")" "true"

  # Window gap hidden on single
  set_setting "window-gap-hidden-on-single" "true"
  assert_eq "gap-hidden-on-single can be set" \
    "$(get_setting "window-gap-hidden-on-single")" "true"
  set_setting "window-gap-hidden-on-single" "false"
  assert_eq "gap-hidden-on-single can be reset" \
    "$(get_setting "window-gap-hidden-on-single")" "false"
}

# ---------------------------------------------------------------------------
# 10. Focus Pointer
#
# Verifies that focus-related settings are accessible. Actual pointer
# movement cannot be verified in a headless container (no way to query
# the pointer position via D-Bus).
# ---------------------------------------------------------------------------

test_focus_pointer() {
  run_test_section "Focus Pointer"

  assert_eq "move-pointer-focus default" \
    "$(get_setting "move-pointer-focus-enabled")" "false"
  set_setting "move-pointer-focus-enabled" "true"
  assert_eq "move-pointer-focus can be enabled" \
    "$(get_setting "move-pointer-focus-enabled")" "true"
  set_setting "move-pointer-focus-enabled" "false"
  assert_eq "move-pointer-focus can be disabled" \
    "$(get_setting "move-pointer-focus-enabled")" "false"

  assert_eq "focus-on-hover default" \
    "$(get_setting "focus-on-hover-enabled")" "false"
  set_setting "focus-on-hover-enabled" "true"
  assert_eq "focus-on-hover can be enabled" \
    "$(get_setting "focus-on-hover-enabled")" "true"
  set_setting "focus-on-hover-enabled" "false"
  assert_eq "focus-on-hover can be disabled" \
    "$(get_setting "focus-on-hover-enabled")" "false"

  assert_eq "auto-exit-tabbed default" \
    "$(get_setting "auto-exit-tabbed")" "true"
  set_setting "auto-exit-tabbed" "false"
  assert_eq "auto-exit-tabbed can be disabled" \
    "$(get_setting "auto-exit-tabbed")" "false"
  set_setting "auto-exit-tabbed" "true"
  assert_eq "auto-exit-tabbed can be re-enabled" \
    "$(get_setting "auto-exit-tabbed")" "true"
}

# ---------------------------------------------------------------------------
# 11. UI Widget Tree (Dogtail / AT-SPI)
#
# Uses the accessibility bus to inspect and interact with the extension
# preferences window. Requires:
#   - at-spi2-core, at-spi2-atk, python3-dogtail installed
#   - NO_AT_BRIDGE not set
#   - toolkit-accessibility gsetting enabled
# ---------------------------------------------------------------------------

test_dogtail_ui() {
  run_test_section "UI Widget Tree (BDD / Behave)"

  local OUTPUT
  local EXIT_CODE=0
  local REPORT_NAME="behave-report-$(date +%Y%m%d-%H%M%S).html"

  OUTPUT=$(do_in_pod bash -c "cd /usr/local/share/anvil-tests && behave --no-skipped -f html-pretty -o /tmp/${REPORT_NAME} -f pretty 2>&1") || EXIT_CODE=$?

  echo "${OUTPUT}"

  # Copy the HTML report out of the container
  mkdir -p "${OUTPUT_DIR}"
  do_in_pod cat "/tmp/${REPORT_NAME}" > "${OUTPUT_DIR}/${REPORT_NAME}" 2>/dev/null \
    && echo "HTML report: ${OUTPUT_DIR}/${REPORT_NAME}" \
    || echo "Warning: Could not copy HTML report"

  # Parse behave output for step-level pass/fail counts
  local PY_PASS PY_FAIL
  PY_PASS=$(echo "${OUTPUT}" | grep -oP '[0-9]+(?= step[s]? passed)' | tail -1 || echo "0")
  PY_FAIL=$(echo "${OUTPUT}" | grep -oP '[0-9]+(?= step[s]? failed)' | tail -1 || echo "0")

  PASS_COUNT=$((PASS_COUNT + PY_PASS))
  FAIL_COUNT=$((FAIL_COUNT + PY_FAIL))

  if [[ "${EXIT_CODE}" -ne 0 ]] && [[ "${PY_FAIL}" -eq 0 ]]; then
    # Behave failed before any steps ran (e.g. import error)
    FAIL_COUNT=$((FAIL_COUNT + 1))
    FAILED_TESTS+=("test_dogtail_ui (behave crashed)")
  fi
}

# ---------------------------------------------------------------------------
# Entry point — called by run-tests.sh
# ---------------------------------------------------------------------------

run_all_tests() {
  test_extension_lifecycle        || true
  test_tiling_basic               || true
  test_settings                   || true
  test_extension_disable_reenable || true
  test_preferences                || true
  test_layout_modes               || true
  test_floating_mode              || true
  test_window_effects             || true
  test_focus_pointer              || true
  test_dogtail_ui                 || true
}
