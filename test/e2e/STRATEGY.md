# Anvil E2E & Integration Testing Strategy

> **GNOME 50 / mutter 50.1 update:** The `--nested` flag (which enabled the
> Xvfb-based approach with xdotool keyboard injection and ImageMagick pixel
> capture) was removed in GNOME 50. `gnome-shell --headless --wayland` is the
> only compositor mode that works in a container without a real GPU. All E2E
> tests must therefore use D-Bus APIs, gsettings, and `Shell.Eval` — keyboard
> keybinding and pixel-level visual tests are not feasible. See `TESTS.md`
> for the current test status.

## Overview

There is no turnkey framework for automated GNOME Shell extension testing. The community
has converged on a practical, battle-tested strategy combining container-based session
isolation, D-Bus control, and screenshot diffing. This document captures all research
findings and defines the recommended approach for Anvil specifically.

---

## The Ecosystem Landscape

### What Does Not Exist

- No dedicated GNOME Shell extension testing framework
- No npm package analogous to Playwright or Cypress for the GNOME Shell
- No GJS-native mock library for the Shell runtime
- The official `gjs.guide` has no dedicated testing page — the community guidance is sparse
  and focuses almost entirely on manual nested-session workflows

### What Does Exist

| Tool | Purpose | Wayland? |
|---|---|---|
| `gnome-shell-pod` | Podman container images running a full GNOME Shell on Xvfb | ✅ (nested) |
| `dbus-run-session` | Spawns an isolated D-Bus session for a command | ✅ |
| `org.gnome.Shell.Eval` | Execute arbitrary JS inside the live Shell process over D-Bus | ✅ |
| `org.gnome.Shell.Extensions.*` | Install, enable, disable, reload extensions over D-Bus | ✅ |
| `xdotool` | Keyboard and mouse simulation (X11/Xvfb) | X11 only |
| `wtype` | Keyboard simulation via `zwp_virtual_keyboard_v1` Wayland protocol | ✅ |
| `ydotool` | Kernel-level input via `uinput` (mouse + keyboard) | ✅ (needs `/dev/uinput`) |
| `libei` | Compositor-level emulated input, used by GNOME Remote Desktop | ✅ (future-proof) |
| `AT-SPI2` / `pyatspi` | Accessibility tree inspection and action triggering over D-Bus | ✅ (inspection) / ⚠️ (input) |
| `dogtail` | High-level Python wrapper over AT-SPI2 | ✅ (inspection) / ⚠️ (input) |
| ImageMagick | Screenshot capture from Xvfb framebuffer and pixel diffing | — |

---

## The Reference Implementation: Burn-My-Windows

The best real-world example of automated GNOME Shell extension E2E testing is
[Burn-My-Windows](https://github.com/Schneegans/Burn-My-Windows) by Simon Schneegans.
Its architecture is the de facto community standard.

### Core Approach

```
GitHub push / PR
    │
    ▼
GitHub Actions (matrix: Fedora 39 / 40 / 41 × gnome-xsession)
    │
    ├── apt install: imagemagick, libglib2.0-dev
    ├── make  →  builds anvil extension zip
    └── sudo tests/run-tests.sh -v {39|40|41} -s gnome-xsession
            │
            ├── podman run ghcr.io/schneegans/gnome-shell-pod-{version}
            ├── podman cp extension.zip → container
            ├── gnome-extensions install + enable
            ├── systemctl --user start gnome-xsession@:99
            ├── gsettings set test-mode true  (freeze animations)
            └── For each test scenario:
                    ├── gsettings / gdbus calls to configure state
                    ├── xdotool keydown/keyup to trigger keybindings
                    ├── podman cp /opt/Xvfb_screen0 → convert xwd → PNG
                    └── find-target.sh  (template match vs reference image)
                            └── on failure: save screenshot + journalctl → upload artifact → exit 1
```

### Key Implementation Details

**Container startup:**
```bash
IMAGE="ghcr.io/schneegans/gnome-shell-pod-${FEDORA_VERSION}"
POD=$(podman run --rm --cap-add=SYS_NICE --cap-add=IPC_LOCK -td "${IMAGE}")
```

**Running commands inside the container** (the `set-env.sh` wrapper sets all required
D-Bus environment variables):
```bash
do_in_pod() {
  podman exec --user gnomeshell --workdir /home/gnomeshell "${POD}" set-env.sh "$@"
}
```

**Keystroke simulation** — `xdotool key` with a 12ms default is too fast for Xvfb.
Always use separate `keydown`/`keyup` with a sleep:
```bash
send_keystroke() {
  do_in_pod xdotool keydown "${1}"
  sleep 0.5
  do_in_pod xdotool keyup "${1}"
}
```

**Screenshot and visual assertion:**
```bash
find_target() {
  podman cp "${POD}:/opt/Xvfb_screen0" - | tar xf - \
    --to-command "convert xwd:- ${WORK_DIR}/screen.png"
  POS=$(./tests/find-target.sh "${WORK_DIR}/screen.png" "tests/references/${1}") || true
  if [[ -z "${POS}" ]]; then
    fail "${1}" "${2}"
  fi
}
```

**The `test-mode` pattern** — the single most important design principle. The extension
exposes a `test-mode` GSettings key that freezes animations at a deterministic frame,
making screenshot comparisons reproducible across runs:
```bash
gsettings --schemadir ~/.local/share/gnome-shell/extensions/${UUID}/schemas \
    set org.gnome.shell.extensions.your-ext "test-mode" true
```

Without this, any time-based animation makes pixel diffing inherently flaky.

**Failure handling** — on any assertion failure, save a screenshot and dump journalctl,
then upload both as GitHub Actions artifacts:
```bash
fail() {
  # Save screenshot to tests/output/
  # Run: do_in_pod journalctl --user -b > tests/output/journal.log
  exit 1
}
```

---

## The `org.gnome.Shell` D-Bus API

This is the most powerful tool available for testing a tiling window manager. It allows
test scripts to reach directly into the running Shell process and inspect or mutate state.

### `org.gnome.Shell` interface

**Bus:** `org.gnome.Shell`  **Object path:** `/org/gnome/Shell`

| Method | Signature | Notes |
|---|---|---|
| `Eval` | `(script: s) → (success: b, result: s)` | **Execute arbitrary JS in the Shell process.** The primary test primitive. |
| `FocusSearch` | `() → ()` | Focus the overview search bar |
| `ShowApplications` | `() → ()` | Open the app grid |
| `GrabAccelerator` | `(accelerator: s, modeFlags: u, grabFlags: u) → (action: u)` | Register a global keybinding |
| `UngrabAccelerator` | `(action: u) → (success: b)` | Release a keybinding |

**Properties:**
- `OverviewActive: b` (read/write) — open or close the overview programmatically
- `ShellVersion: s` (read)

### `org.gnome.Shell.Extensions` interface

**Bus:** `org.gnome.Shell`  **Object path:** `/org/gnome/Shell`

| Method | Signature | Notes |
|---|---|---|
| `EnableExtension` | `(uuid: s) → (success: b)` | Enable by UUID |
| `DisableExtension` | `(uuid: s) → (success: b)` | Disable by UUID |
| `ReloadExtension` | `(uuid: s) → ()` | Hot-reload extension code |
| `GetExtensionInfo` | `(uuid: s) → (info: a{sv})` | Full metadata + state |
| `GetExtensionErrors` | `(uuid: s) → (errors: as)` | Errors that caused ERROR state |
| `ListExtensions` | `() → (extensions: a{sa{sv}})` | All installed extensions |
| `OpenExtensionPrefs` | `(uuid: s, parent: s, options: a{sv}) → ()` | Open prefs dialog |
| `UninstallExtension` | `(uuid: s) → (success: b)` | Uninstall |

**Extension state values** (from `GetExtensionInfo`'s `state` key):

| Value | Meaning |
|---|---|
| `1` | ACTIVE |
| `2` | INACTIVE |
| `3` | ERROR |
| `4` | OUT_OF_DATE |
| `5` | DOWNLOADING |
| `6` | INITIALIZED |
| `7` | DEACTIVATING |
| `8` | ACTIVATING |
| `99` | UNINSTALLED |

**Signal:** `ExtensionStateChanged(uuid: s, state: a{sv})` — fired on any state transition.

### Using `Eval` as a test primitive

`Eval` executes JavaScript in the Shell's own GJS context and returns the result as a
JSON string. This is the key to **state-based assertions** rather than purely visual ones:

```bash
# Call via gdbus from inside the container
do_in_pod gdbus call --session \
  --dest org.gnome.Shell \
  --object-path /org/gnome/Shell \
  --method org.gnome.Shell.Eval \
  "JSON.stringify({ version: imports.misc.config.PACKAGE_VERSION })"
# Returns: (true, '{"version":"47.0"}')
```

```bash
# Assert that the extension is loaded and its WindowManager exists
do_in_pod gdbus call --session \
  --dest org.gnome.Shell \
  --object-path /org/gnome/Shell \
  --method org.gnome.Shell.Eval \
  "
    const ext = global.get_extension_by_uuid?.('anvil@genkerensky.com')
             ?? imports.misc.extensionUtils.getExtensionByUuid('anvil@genkerensky.com');
    JSON.stringify({ enabled: !!ext, hasWm: !!ext?.stateObj?.extWm })
  "
# Returns: (true, '{"enabled":true,"hasWm":true}')
```

---

## gnome-shell-pod Container Images

Maintained by Simon Schneegans at `ghcr.io/schneegans/gnome-shell-pod-{version}`.

| Image tag | Fedora version | GNOME Shell version |
|---|---|---|
| `gnome-shell-pod-39` | Fedora 39 | 45 |
| `gnome-shell-pod-40` | Fedora 40 | 46 |
| `gnome-shell-pod-41` | Fedora 41 | 47 |
| `gnome-shell-pod-rawhide` | Fedora Rawhide | latest (weekly rebuild) |

Each image provides:
- A `gnomeshell` user with auto-login via `systemd-logind`
- `Xvfb` running on `:99`, with the framebuffer exposed at `/opt/Xvfb_screen0`
- `set-env.sh` — sets all required `DISPLAY`, `DBUS_SESSION_BUS_ADDRESS`, `XDG_*`
  environment variables before running a command
- `wait-user-bus.sh` — blocks until the user D-Bus session is available
- `xdotool`, `gsettings`, `gnome-extensions` CLI pre-installed

**Anvil's `shell-version` in `metadata.json`** covers 45–50.1, so the relevant images are
`39`, `40`, `41`, and `rawhide`.

---

## Recommended Architecture for Anvil

Anvil's correctness is primarily **structural** (the tiling tree) rather than visual
(rendered effects). This means `Eval`-based state assertions are more valuable than
screenshot diffing alone. The recommended approach combines both.

### Test Pyramid

```
                    ┌──────────────────────┐
                    │       E2E / CI       │  gnome-shell-pod + xdotool + Eval + screenshots
                    │      (~10 tests)     │  "tiling a window puts it in the tree"
                    │                      │  "layout changes after keybinding"
                    └──────────┬───────────┘
                               │
              ┌────────────────┴────────────────┐
              │    Integration (local headless)  │  dbus-run-session + gnome-shell --nested
              │         (~30 tests)              │  "window manager enables/disables cleanly"
              │                                  │  "gsettings changes propagate"
              └────────────────┬────────────────┘
                               │
         ┌─────────────────────┴─────────────────────┐
         │              Unit (vitest)                 │  Already set up ✓
         │              (~182+ tests)                 │  Pure logic, tree operations, utils
         └────────────────────────────────────────────┘
```

### Test Categories for a Tiling WM

| Category | Mechanism | Example assertion |
|---|---|---|
| **Extension lifecycle** | `GetExtensionInfo` → check `state == 1` | Extension enables without errors |
| **Extension errors** | `GetExtensionErrors` | Zero errors after enable |
| **Layout tree structure** | `Eval` → inspect `extWm.tree` | Root node has two children after split |
| **Keybinding effects** | `xdotool key super+h` → `Eval` → assert tree | Layout is HSPLIT after horizontal split key |
| **Window tiling** | Open app → `Eval` → assert node added | New window becomes a WINDOW node |
| **Float/tile toggle** | Keybinding → `Eval` → `node.isFloat()` | Window enters float mode |
| **Multi-monitor layout** | `MUTTER_DEBUG_DUMMY_MODE_SPECS=3840x1080` → `Eval` | Two MONITOR nodes in tree |
| **Workspace isolation** | Create workspace → open windows → `Eval` | Each workspace has independent subtree |
| **Gap settings** | `gsettings set gap-size 10` → visual diff | Window gaps match setting value |
| **Preferences dialog** | `OpenExtensionPrefs` → AT-SPI2 / screenshot | Prefs window opens and shows correct tabs |

---

## Concrete Implementation Plan

### Step 1: Add a `test-mode` GSettings key

Add to `schemas/org.gnome.shell.extensions.anvil.gschema.xml`:

```xml
<key name="test-mode" type="b">
  <default>false</default>
  <summary>Test mode</summary>
  <description>
    When true, disables animations and exposes internal state for automated testing.
    Must never be set to true in production.
  </description>
</key>
```

When `test-mode` is true, the extension should:
- Skip or freeze CSS animations
- Expose a `getTestState()` method on the extension object that returns a JSON-serialisable
  summary of the tree structure

### Step 2: Add a test state helper to the extension

In `extension.js`, expose a method that test scripts can call via `Eval`:

```js
// Only available when test-mode is enabled
getTestState() {
  if (!this.settings.get_boolean("test-mode")) return null;
  return JSON.stringify(this.extWm.tree.toDebugObject());
}
```

### Step 3: Create `tests/run-tests.sh`

A bash script following the Burn-My-Windows pattern:

```bash
#!/usr/bin/env bash
# Usage: ./tests/run-tests.sh -v 41 -s gnome-xsession

set -e

FEDORA_VERSION="41"
SESSION="gnome-xsession"
UUID="anvil@genkerensky.com"

while [[ $# -gt 0 ]]; do
  case "$1" in
    -v) FEDORA_VERSION="$2"; shift 2 ;;
    -s) SESSION="$2"; shift 2 ;;
    *)  echo "Unknown argument: $1"; exit 1 ;;
  esac
done

IMAGE="ghcr.io/schneegans/gnome-shell-pod-${FEDORA_VERSION}"
WORK_DIR=$(mktemp -d)
POD=$(podman run --rm --cap-add=SYS_NICE --cap-add=IPC_LOCK -td "${IMAGE}")

trap 'podman stop "${POD}"; rm -rf "${WORK_DIR}"' INT TERM EXIT

do_in_pod() {
  podman exec --user gnomeshell --workdir /home/gnomeshell "${POD}" set-env.sh "$@"
}

send_keystroke() {
  do_in_pod xdotool keydown "${1}"
  sleep 0.5
  do_in_pod xdotool keyup "${1}"
}

set_setting() {
  do_in_pod gsettings --schemadir \
    "/home/gnomeshell/.local/share/gnome-shell/extensions/${UUID}/schemas" \
    set "org.gnome.shell.extensions.anvil" "${1}" "${2}"
}

eval_js() {
  do_in_pod gdbus call --session \
    --dest org.gnome.Shell \
    --object-path /org/gnome/Shell \
    --method org.gnome.Shell.Eval \
    "${1}"
}

screenshot() {
  podman cp "${POD}:/opt/Xvfb_screen0" - \
    | tar xf - --to-command "convert xwd:- ${WORK_DIR}/screen.png"
}

fail() {
  echo "FAIL: ${1}"
  screenshot
  cp "${WORK_DIR}/screen.png" "tests/output/failure-${1//\//-}.png"
  do_in_pod journalctl --user -b > "tests/output/journal.log" || true
  exit 1
}

assert_eval() {
  local DESCRIPTION="${1}"
  local SCRIPT="${2}"
  local EXPECTED="${3}"
  local RESULT
  RESULT=$(eval_js "${SCRIPT}" | sed "s/(true, '\(.*\)')/\1/")
  if [[ "${RESULT}" != "${EXPECTED}" ]]; then
    echo "FAIL: ${DESCRIPTION}"
    echo "  Expected: ${EXPECTED}"
    echo "  Got:      ${RESULT}"
    fail "${DESCRIPTION}"
  fi
  echo "PASS: ${DESCRIPTION}"
}

mkdir -p tests/output

# --- Install and start ---
do_in_pod wait-user-bus.sh
sleep 2

podman cp "${UUID}.zip" "${POD}:/home/gnomeshell/"
do_in_pod gnome-extensions install "${UUID}.zip"
do_in_pod gsettings set org.gnome.shell welcome-dialog-last-shown-version "999"
do_in_pod gsettings set org.gnome.mutter center-new-windows true

do_in_pod systemctl --user start "${SESSION}@:99"
sleep 10

do_in_pod gnome-extensions enable "${UUID}"
sleep 3

set_setting "test-mode" "true"

# Close overview if open (GNOME 40+)
send_keystroke "super"
sleep 2

# --- Tests ---

# 1. Extension loaded without errors
ERRORS=$(do_in_pod gdbus call --session \
  --dest org.gnome.Shell \
  --object-path /org/gnome/Shell \
  --method org.gnome.Shell.Extensions.GetExtensionErrors \
  "'${UUID}'" | tr -d "()'")
if [[ -n "${ERRORS// }" ]]; then
  fail "extension-has-errors: ${ERRORS}"
fi
echo "PASS: extension loaded without errors"

# 2. Extension state is ACTIVE (1)
STATE=$(do_in_pod gdbus call --session \
  --dest org.gnome.Shell \
  --object-path /org/gnome/Shell \
  --method org.gnome.Shell.Extensions.GetExtensionInfo \
  "'${UUID}'" | grep -o "'state': <[0-9]*>" | grep -o '[0-9]*')
if [[ "${STATE}" != "1" ]]; then
  fail "extension-not-active: state=${STATE}"
fi
echo "PASS: extension is ACTIVE"

# 3. WindowManager is initialized
assert_eval \
  "window-manager-initialized" \
  "JSON.stringify(!!global.get_extension_by_uuid?.('${UUID}')?.stateObj?.extWm)" \
  '"true"'

# 4. Tiling a window adds it to the tree
do_in_pod gnome-terminal &
sleep 3
assert_eval \
  "tiled-window-in-tree" \
  "
    const wm = global.get_extension_by_uuid?.('${UUID}')?.stateObj?.extWm;
    const tree = wm?.tree;
    JSON.stringify(tree ? tree._root.childNodes.length > 0 : false)
  " \
  '"true"'

# 5. Horizontal split keybinding changes layout
send_keystroke "super+h"
sleep 1
assert_eval \
  "horizontal-split-layout" \
  "
    const wm = global.get_extension_by_uuid?.('${UUID}')?.stateObj?.extWm;
    const ws = wm?.currentMonWs;
    JSON.stringify(ws?.layout ?? null)
  " \
  '"HSPLIT"'

echo ""
echo "All tests passed."
```

### Step 4: Add a GitHub Actions workflow

Create `.github/workflows/e2e.yml`:

```yaml
name: E2E Tests

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    name: GNOME Shell ${{ matrix.gnome }} (${{ matrix.session }})
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        gnome: ["39", "40", "41"]  # GNOME Shell 45, 46, 47
        session: ["gnome-xsession"]

    steps:
      - uses: actions/checkout@v4

      - name: Install dependencies
        run: |
          sudo apt-get update -qq
          sudo apt-get install -y gettext imagemagick libglib2.0-dev

      - name: Build Anvil
        run: make dist

      - name: Run E2E tests
        run: sudo tests/run-tests.sh -v ${{ matrix.gnome }} -s ${{ matrix.session }}

      - name: Upload failure artifacts
        uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: failure-${{ matrix.gnome }}-${{ matrix.session }}
          path: tests/output/
```

---

## Local Development Workflow

The project already has `make test-nested`, which starts a nested Wayland session:

```bash
# Terminal 1: start nested shell
make test-nested

# Terminal 2: open a window inside the nested session
make test-open CMD=gnome-terminal

# Terminal 3: query state via D-Bus from outside the nested session
WAYLAND_DISPLAY=wayland-anvil dbus-run-session -- bash -c '
  gdbus call --session \
    --dest org.gnome.Shell \
    --object-path /org/gnome/Shell \
    --method org.gnome.Shell.Eval \
    "JSON.stringify(!!global.get_extension_by_uuid?.('anvil@genkerensky.com'))"
'
```

To run integration tests locally without CI:

```bash
# Build and install the extension in debug mode
make test

# In a second terminal, after the nested shell has started:
WAYLAND_DISPLAY=wayland-anvil ./tests/run-local.sh
```

---

## Input Simulation Tool Reference

### `xdotool` (X11/Xvfb — used in gnome-shell-pod)

Works on X11 and Xvfb. The standard choice inside `gnome-shell-pod`.

```bash
# IMPORTANT: always use separate keydown/keyup with a sleep
# The default 12ms between keydown/keyup is too fast for Xvfb
xdotool keydown "super"
sleep 0.5
xdotool keyup "super"

# Combo keys
xdotool keydown "super+h"
sleep 0.5
xdotool keyup "super+h"

# Mouse
xdotool mousemove 960 540
xdotool click 1
```

### `wtype` (Wayland-native)

Uses `zwp_virtual_keyboard_v1` Wayland protocol. Works in a real Wayland session.

```bash
# Type text
wtype "hello"

# Modifier + key combos
wtype -M super h -m super

# Named key press/release
wtype -P Return -p Return
```

### `ydotool` (kernel-level, `uinput`)

Works on both X11 and Wayland by injecting at the Linux kernel level. Requires
`/dev/uinput` access (typically needs the `input` group or root).

```bash
ydotool type "hello"
ydotool key 29:1 108:1 108:0 29:0  # Ctrl+L (raw key codes)
ydotool mousemove --absolute -x 960 -y 540
ydotool click 0xC0  # left button
```

### AT-SPI2 via `pyatspi` / `dogtail` (accessibility tree)

For asserting UI state without screenshot diffing. Works on both X11 and Wayland for
tree inspection; input injection has caveats on Wayland.

```python
import pyatspi

desktop = pyatspi.Registry.getDesktop(0)
for app in desktop:
    print(app.name, app.getRoleName())

# Trigger an accessible action
button = find_by_name(desktop, "Close")
button.queryAction().doAction(0)  # "click"
```

Useful for preferences dialog testing (checking that settings widgets exist and have
correct values) without needing visual reference images.

---

## D-Bus Cheat Sheet

All commands assume they are run from inside the `gnome-shell-pod` container via
`set-env.sh`, or from a terminal with the correct `DBUS_SESSION_BUS_ADDRESS` set.

```bash
# Enable extension
gdbus call --session \
  --dest org.gnome.Shell --object-path /org/gnome/Shell \
  --method org.gnome.Shell.Extensions.EnableExtension \
  "'anvil@genkerensky.com'"

# Check extension state (1 = ACTIVE)
gdbus call --session \
  --dest org.gnome.Shell --object-path /org/gnome/Shell \
  --method org.gnome.Shell.Extensions.GetExtensionInfo \
  "'anvil@genkerensky.com'"

# Check extension errors
gdbus call --session \
  --dest org.gnome.Shell --object-path /org/gnome/Shell \
  --method org.gnome.Shell.Extensions.GetExtensionErrors \
  "'anvil@genkerensky.com'"

# Reload extension after code change (no Shell restart needed)
gdbus call --session \
  --dest org.gnome.Shell --object-path /org/gnome/Shell \
  --method org.gnome.Shell.Extensions.ReloadExtension \
  "'anvil@genkerensky.com'"

# Evaluate JS in the Shell context
gdbus call --session \
  --dest org.gnome.Shell --object-path /org/gnome/Shell \
  --method org.gnome.Shell.Eval \
  "'global.display.get_n_monitors()'"

# Open extension preferences
gdbus call --session \
  --dest org.gnome.Shell --object-path /org/gnome/Shell \
  --method org.gnome.Shell.Extensions.OpenExtensionPrefs \
  "'anvil@genkerensky.com'" "'' " "{}"

# Set an extension GSettings key
gsettings \
  --schemadir ~/.local/share/gnome-shell/extensions/anvil@genkerensky.com/schemas \
  set org.gnome.shell.extensions.anvil "gap-size" "10"

# Get an extension GSettings key
gsettings \
  --schemadir ~/.local/share/gnome-shell/extensions/anvil@genkerensky.com/schemas \
  get org.gnome.shell.extensions.anvil "gap-size"
```

---

## References

- [Burn-My-Windows `tests/run-tests.sh`](https://github.com/Schneegans/Burn-My-Windows/blob/main/tests/run-tests.sh)
- [Burn-My-Windows CI workflow](https://github.com/Schneegans/Burn-My-Windows/blob/main/.github/workflows/checks.yml)
- [gnome-shell-pod container images](https://github.com/Schneegans/gnome-shell-pod)
- [`org.gnome.Shell` D-Bus XML](https://gitlab.gnome.org/GNOME/gnome-shell/-/blob/main/data/dbus-interfaces/org.gnome.Shell.xml)
- [`org.gnome.Shell.Extensions` D-Bus XML](https://gitlab.gnome.org/GNOME/gnome-shell/-/blob/main/data/dbus-interfaces/org.gnome.Shell.Extensions.xml)
- [AT-SPI2 API docs](https://docs.gtk.org/atspi2/)
- [pyatspi on PyPI](https://pypi.org/project/pyatspi/)
- [dogtail on PyPI](https://pypi.org/project/dogtail/)
- [wtype (Wayland keyboard input)](https://github.com/atx/wtype)
- [ydotool (kernel-level input)](https://github.com/ReimuNotMoe/ydotool)
- [libei (compositor-level input emulation)](https://gitlab.freedesktop.org/libinput/libei)
- [gjs.guide — Extension Development](https://gjs.guide/extensions/development/creating.html)