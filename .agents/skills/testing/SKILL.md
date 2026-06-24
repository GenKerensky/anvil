---
name: testing
description: Write, run, and debug Anvil unit, integration, and E2E tests
license: MIT
compatibility: agents
---

# Testing Guide — Unit, Integration, and E2E

Anvil uses three independent test layers. This skill covers how to write, run, and debug tests in all of them.

| Layer           | Runtime                                   | Language         | Framework                       | Speed | GNOME Shell needed? |
| --------------- | ----------------------------------------- | ---------------- | ------------------------------- | ----- | ------------------- |
| **Unit**        | Node.js                                   | TypeScript       | vitest + hand-written GJS mocks | ~2 s  | No                  |
| **Integration** | Podman container → gnome-shell --headless | GJS (ES modules) | Jasmine via `jasmine-gjs`       | ~40 s | Yes (in container)  |
| **E2E**         | Host → gnome-shell --headless             | GJS (ES modules) | Custom `describe`/`it`/`assert` | ~30 s | Yes (local)         |

All three share a common **Python bootstrap** layer (`test/lib/runner_utils.py`) that handles D-Bus, mock services, session lifecycle, and results collection.

---

## 1. Unit Tests (vitest)

### Where they live

```
test/unit/
  __mocks__/        # All GJS/GNOME API mocks
    gi/             # gi://ModuleName → hand-written JS mocks
      Gio.js, GLib.js, Meta.js, Shell.js, St.js, Clutter.js, Gtk.js, Gdk.js, Adw.js, GObject.js, Cairo.js
    shell/          # resource:// imports → mock Shell internals
      main.js, extension.js, config.js, prefs.js
  mocks/helpers/    # Test fixtures and utilities
    testFixtures.js # createMockWindow(), createWindowManagerFixture()
    signalMixin.js  # withSignals() for mock GObject signals
    treeHelpers.js  # Helpers for tree manipulation in tests
    globalSetup.js  # Global test environment setup
    index.js        # Public API of helpers
    index.d.ts      # TypeScript declarations for helpers
  types/            # Type declarations for test-only types
    gi-shell.d.ts   # Hand-written gi://Shell types
    meta-extensions.d.ts
    cairo.d.ts
    resource-modules.d.ts
  setup.js          # vitest setup (mock global, log, logError, print)
  css/              # CSS parser unit tests
  extension/        # Unit tests for src/lib/extension/*.ts
  shared/           # Unit tests for src/lib/shared/*.ts
```

### How mocking works

`vitest.config.js` aliases every `gi://` and `resource://` import to a hand-written JS mock:

```js
// vitest.config.js
resolve: {
  alias: {
    "gi://Gio": resolve(__dirname, "./test/unit/__mocks__/gi/Gio.js"),
    "resource:///org/gnome/shell/ui/main.js": resolve(__dirname, "./test/unit/__mocks__/shell/main.js"),
    // ... one entry per gi:// and resource:// import
  }
}
```

When source code imports `gi://Gio`, vitest loads `test/unit/__mocks__/gi/Gio.js` instead. All mock files are plain JavaScript (not TypeScript) because they run in Node.js and must be immediately loadable without compilation.

### Writing a unit test

Unit tests import directly from the TypeScript source (compiled by vitest internally):

```ts
// test/unit/extension/WindowManager-lifecycle.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createWindowManagerFixture } from "../mocks/helpers/testFixtures.js";

describe("WindowManager lifecycle", () => {
  let ctx: ReturnType<typeof createWindowManagerFixture>;

  beforeEach(() => {
    ctx = createWindowManagerFixture();
  });

  afterEach(() => {
    ctx.wm.destroy();
  });

  it("should create a tree root on construction", () => {
    expect(ctx.tree.root).toBeDefined();
    expect(ctx.tree.root!.nodeType).toBe("MONITOR");
  });
});
```

Key rules:

- Import `vitest` globals explicitly (`describe`, `it`, `expect`, `beforeEach`, `afterEach`, `vi`).
- Use `createWindowManagerFixture()` to get a fully wired `WindowManager` with mocked GNOME APIs.
- Use `createMockWindow()` to get a mock `Meta.Window` with signals, geometry, and workspace support.
- Always call `ctx.wm.destroy()` in `afterEach` to clean up signal handlers and idle callbacks.
- Mock `globalThis.log` / `logError` / `print` are installed by `test/unit/setup.js` automatically.

### Key mocks

| File                           | Exports                                                                        | Used for                              |
| ------------------------------ | ------------------------------------------------------------------------------ | ------------------------------------- |
| `__mocks__/gi/Gio.js`          | `Settings` (Map-backed), `File`, `FileCreateFlags`, etc.                       | GSettings, file I/O                   |
| `__mocks__/gi/Meta.js`         | `Rectangle`, `Window` (with signals), `Workspace`, `Display`, `Monitor`, enums | Window geometry, workspaces, monitors |
| `__mocks__/gi/GLib.js`         | `Variant`, `idle_add`, `timeout_add`, `Source.remove`                          | Async callbacks, timers               |
| `__mocks__/shell/main.js`      | `panel`, `wm`, `layoutManager`, `overview`                                     | Shell UI components                   |
| `__mocks__/shell/extension.js` | `Extension` base class with `getSettings()`                                    | Extension base class                  |

### Adding a new mock API

When source code imports a new `gi://` module or `resource://` path:

1. Create the mock file in `test/unit/__mocks__/gi/<Module>.js` (or `shell/<name>.js`).
2. Export the minimum viable API surface needed by the tests.
3. Add the alias entry to `vitest.config.js`.
4. Use `withSignals()` from `mocks/helpers/signalMixin.js` if the mock needs `connect`/`disconnect`/`emit`.

Example: adding a mock for `gi://GdkPixbuf`:

```js
// test/unit/__mocks__/gi/GdkPixbuf.js
export const Pixbuf = {
  new_from_file(path) {
    return { get_width: () => 16, get_height: () => 16 };
  },
};
```

```js
// vitest.config.js
"gi://GdkPixbuf": resolve(__dirname, "./test/unit/__mocks__/gi/GdkPixbuf.js"),
```

### Running unit tests

```bash
npm run test:unit      # Single run (~2 s)
npm run test:unit:watch # Watch mode
```

### Type checking unit tests

```bash
npm run typecheck          # tsc --noEmit on src/
npm run typecheck:test     # tsc --project tsconfig.test.json (includes test/)
```

---

## 2. Integration Tests (Jasmine + Containers)

### Architecture

```
make test-integration
  → python3 test/integration/run.py
    → podman run (systemd init)
      → gnome-headless.service
        → test/integration/start-session.sh
          → dbus-daemon
          → dbusmock stubs
          → at-spi-bus-launcher
          → gnome-shell --headless --wayland --automation-script test/integration/runner.js
            → jasmineBoot.js from /usr/share/jasmine-gjs/
            → imports specs/*.js
            → runs specs, writes /tmp/anvil-jasmine-results.json
    ← polls for results JSON, prints colored summary
```

### Writing a Jasmine spec

Integration specs are **GJS ES modules** executed inside the gnome-shell process. They use global `describe`/`it`/`expect` installed by `jasmineBoot.js`.

```js
// test/integration/specs/settings.js
describe("GSettings", () => {
  it("can change window-gap-size", () => {
    const settings = getSettings();
    const original = settings.get_uint("window-gap-size");
    settings.set_uint("window-gap-size", 42);
    expect(settings.get_uint("window-gap-size")).toBe(42);
    settings.set_uint("window-gap-size", original);
  });
});
```

Key rules:

- Use **module-level code** (not `export async function run()`). `--headless` does not call `run()`.
- All Jasmine globals (`describe`, `it`, `expect`, `beforeEach`, `afterEach`) are installed by `runner.js`.
- Import shared helpers from `specs/helpers.js`.
- Access GNOME APIs directly: `Meta`, `Gio`, `St`, `Shell`, `global`, `imports.ui.main`.

### AT-SPI for preferences UI testing

The preferences window is tested via `gi://Atspi` (accessibility tree). Pattern:

```js
const Atspi = imports.gi.Atspi;
Atspi.init();

const desktop = Atspi.get_desktop(0);
const app = findAccessible(desktop, {
  role: Atspi.Role.APPLICATION,
  name: "Anvil Preferences",
});

// Find a switch by label
const toggle = findAccessible(app, { role: Atspi.Role.TOGGLE_BUTTON, name: "Gapless" });
const isOn = toggle.get_state_set().contains(Atspi.StateType.CHECKED);

// Toggle it via accessibility action
toggle.get_action_iface().do_action(0);
```

Helper functions in `specs/helpers.js`:

- `findAccessible(root, criteria)` — recursive tree walk by role/name.
- `waitForAccessible(root, criteria, timeoutMs)` — polling variant.
- `hasState(node, stateType)` — check state set.
- `doAction(node)` — perform default action.
- `openPrefsWindow()` — D-Bus call to open preferences + wait for window.

### Container lifecycle

```bash
# Build container image (one-time per Fedora version)
make test-integration-build-all  # All versions
bash test/integration/build-container.sh 44  # Single version

# Run tests (auto-builds image if missing)
make test-integration FEDORA_VERSION=44  # GNOME 50
make test-integration FEDORA_VERSION=43  # GNOME 49
make test-integration FEDORA_VERSION=42  # GNOME 48
make test-integration-all               # All three
```

Container images are named `anvil-test-pod:fedora-<version>` and cached. They include `jasmine-gjs` installed from source (not in Fedora repos).

### Debugging integration failures

1. **Journal logs**: On failure, `run.py` saves `output/journal.log`.
2. **Keep container alive**: `python3 test/integration/run.py -v 44 --keep` leaves the container running for inspection.
3. **Run a single spec**: Edit `runner.js` to comment out unwanted spec imports.
4. **Screenshot**: On failure, `run.py` attempts `grim` screenshot capture inside the container.

---

## 3. E2E Tests (Devkit + Custom Framework)

### Architecture

```
make test-e2e
  → python3 test/e2e/run.py
    → dbus-daemon
    → dbusmock stubs (UPower, NetworkManager, Accounts, SessionManager, PowerProfiles)
    → gnome-shell --wayland --headless --virtual-monitor 1920x1080 --automation-script test/e2e/runner.js
      → waits for extension ACTIVE
      → calls run() (devkit calls run())
      → runAll(filterTag)
        → runs suites/*.js
        → writes /tmp/anvil-e2e-results.json
    ← polls for results JSON, prints colored summary
```

### Writing an E2E test

E2E tests use a minimal custom framework in `test/e2e/lib/framework.js`:

```js
// test/e2e/suites/tiling.js
const { describe, it, assert, assertEq, beforeEach, afterEach } = imports.framework;
const { launchApp, getWindowGeometries, getMonitorWorkArea } = imports.commands;

describe("Tiling geometry", () => {
  beforeEach(async () => {
    await closeAllWindows();
  });

  afterEach(async () => {
    await closeAllWindows();
  });

  it("single window fills work area", async () => {
    await launchApp("org.gnome.TextEditor.desktop");
    await sleep(500);

    const wins = getWindowGeometries();
    const work = getMonitorWorkArea();

    assertEq(wins.length, 1);
    assertEq(wins[0].x, work.x);
    assertEq(wins[0].y, work.y);
    assertEq(wins[0].width, work.width);
    assertEq(wins[0].height, work.height);
  });
});
```

Key rules:

- `describe`/`it` are **async-aware** — `it()` can return a Promise.
- `assert(condition, message)` throws on failure.
- `assertEq(actual, expected)` compares via `JSON.stringify`.
- `assertApprox(actual, expected, tolerance)` for float geometry.
- Always use `beforeEach`/`afterEach` to clean windows between tests.

### Shared helpers (`test/e2e/lib/commands.js`)

| Function                    | Purpose                                                             |
| --------------------------- | ------------------------------------------------------------------- |
| `launchApp(desktopFile)`    | Open a new window, wait for it to appear                            |
| `getWindowGeometries()`     | Array of `{title, x, y, width, height, minimized}`                  |
| `getWindowCount()`          | Count of non-minimized windows                                      |
| `sendKeyCombo(combo)`       | Send keyboard shortcuts ("super+h", "super+j", "super+c", "alt+f4") |
| `closeAllWindows()`         | Delete all windows on active workspace                              |
| `getMonitorWorkArea()`      | `{x, y, width, height}` for monitor 0                               |
| `takeScreenshot(path)`      | Via `org.gnome.Shell.Screenshot` D-Bus API                          |
| `getNodePercents()`         | Tree node percents from `extWm`                                     |
| `getAnvilWM()`              | Returns `global.__anvil_extWm` or fallback                          |
| `getAnvilSettings()`        | Returns `global.__anvil_settings`                                   |
| `clearMonitorConstraints()` | Resets monitor constraints GSettings                                |
| `setMonitorConstraint(...)` | Sets a single monitor constraint                                    |
| `clearResizedWindows()`     | Clears `_resizedWindows` Map (state bleed prevention)               |

### Running E2E tests

```bash
make test-e2e                          # Full suite (~30 s)
python3 test/e2e/run.py --tag resize   # Run only suites matching tag
python3 test/e2e/run.py --no-build     # Skip `make dist`, reuse existing build
```

### Keyboard injection

E2E tests send keyboard shortcuts via `wm.command(action)` directly (not via `wtype`) for reliability:

```js
const { sendKeyCombo } = imports.commands;
await sendKeyCombo("super+h"); // Changes split orientation
```

The `sendKeyCombo` function resolves the action name (e.g., `"toggle-split-orientation"`) and calls `wm.command(action)` on the real `WindowManager` instance.

### Screenshots on failure

On assertion failure, `runner.js` captures a screenshot via the Shell Screenshot D-Bus API:

```js
const screenshotPath = `/tmp/anvil-e2e-failure-${Date.now()}.png`;
takeScreenshot(screenshotPath);
```

---

## 4. Python Bootstrap Architecture

Both integration and E2E tests use the shared `test/lib/runner_utils.py` module.

### D-Bus session & mocks

```python
from test.lib.runner_utils import start_dbus_session, start_mocks

# 1. Start isolated D-Bus session bus
dbus_proc, dbus_addr = start_dbus_session()

# 2. Start mock D-Bus services
mocks = start_mocks(dbus_addr)
# Returns list of Popen objects for:
#   org.freedesktop.UPower
#   org.freedesktop.NetworkManager
#   net.hadess.PowerProfiles
#   org.freedesktop.Accounts
#   org.gnome.SessionManager (custom template)
```

### Shell readiness polling

```python
from test.lib.runner_utils import wait_for_shell_dbus

# Polls gdbus NameHasOwner until org.gnome.Shell appears
wait_for_shell_dbus(dbus_addr, timeout=40.0)
```

### Results collection

```python
from test.lib.runner_utils import wait_for_results, print_results

# Polls for JSON results file, parses, deletes, returns dict
results = wait_for_results("/tmp/anvil-e2e-results.json", timeout=600.0)
print_results(results, title="E2E Results")
```

### Results JSON schema

```json
{
  "results": [
    {
      "name": "Tiling geometry",
      "tests": [
        { "name": "single window fills work area", "passed": true, "pending": false, "error": null }
      ],
      "passed": 1,
      "failed": 0
    }
  ],
  "totalPassed": 81,
  "totalFailed": 0,
  "fatalError": null,
  "timestamp": "2026-05-17T17:00:00Z"
}
```

Both E2E and integration tests write to this schema. E2E writes to `/tmp/anvil-e2e-results.json`; integration writes to `/tmp/anvil-jasmine-results.json`.

---

## 5. Shared Command Module (`test/lib/shared-commands.js`)

Both E2E and integration tests import from a single shared module to avoid duplication:

```js
// E2E suite
import { launchApp, sendKeyCombo, getWindowGeometries } from "../../lib/shared-commands.js";

// Integration spec
import { launchApp, sendKeyCombo, getWindowGeometries } from "../lib/shared-commands.js";
```

### What's in the shared module

| Function                                    | Purpose                                                        |
| ------------------------------------------- | -------------------------------------------------------------- |
| `launchApp(desktopFile)`                    | Open any app, wait for window                                  |
| `openWindow()`                              | Convenience: open gnome-text-editor                            |
| `getWindowCount()`                          | Non-minimized window count                                     |
| `getWindowGeometries()`                     | Array of `{title, x, y, width, height, minimized}`             |
| `getFocusedWindowTitle()`                   | Title of focused window                                        |
| `getMonitorWorkArea()`                      | `{x, y, width, height}` for monitor 0                          |
| `windowsOverlap(wins)`                      | AABB overlap check                                             |
| `windowsFillWorkArea(wins, tolerance)`      | Area coverage ratio check                                      |
| `closeFocusedWindow(timeoutMs)`             | Delete focused window + poll until closed                      |
| `closeAllWindows()`                         | Delete all + poll until closed                                 |
| `getFocusedWindowId()`                      | `Meta.Window.get_id()` of focused window                       |
| `waitForWindowCount(target, timeoutMs)`     | Poll until window count equals target                          |
| `waitForGeometry(predicate, timeoutMs)`     | Poll until geometry predicate returns true                     |
| `waitForFocusChange(previousId, timeoutMs)` | Poll until focus changes from `previousId`                     |
| `waitForFocusWindow(expectedId, timeoutMs)` | Poll until a specific window ID is focused                     |
| `sendKeyCombo(combo)`                       | Simulate shortcuts ("super+h", "super+j", "super+c", "alt+f4") |
| `sendAnvilCommand(action)`                  | Direct `wm.command(action)` call                               |
| `getAnvilWM()`                              | Returns `global.__anvil_extWm` or fallback                     |
| `getAnvilSettings()`                        | Returns `global.__anvil_settings` or fallback                  |
| `getNodePercents()`                         | Tree node percents from `extWm`                                |
| `clearResizedWindows()`                     | Clears `_resizedWindows` Map                                   |
| `clearMonitorConstraints()`                 | Resets monitor constraints GSettings                           |
| `setMonitorConstraint(...)`                 | Sets a single monitor constraint                               |
| `takeScreenshot(path)`                      | D-Bus Screenshot API (devkit only)                             |
| `formatWindowState(wins)`                   | Human-readable debug string                                    |
| `isExtensionActive()`                       | Checks extension state === ACTIVE                              |
| `getExtensionErrors()`                      | Returns extension error array                                  |
| `sleep(ms)`                                 | Promise-based GLib timeout                                     |
| `getSettings()`                             | Cached `Gio.Settings` for Anvil schema                         |
| `getExtension()`                            | `Main.extensionManager.lookup(UUID)`                           |

### Integration-only helpers (AT-SPI)

`test/integration/specs/helpers.js` re-exports everything from `shared-commands.js` plus AT-SPI-specific helpers:

```js
import {
  findAccessible,
  waitForAccessible,
  openPrefsWindow,
  navigateToTab,
  findSwitch,
} from "./helpers.js";
```

| Function                                        | Purpose                            |
| ----------------------------------------------- | ---------------------------------- |
| `findAccessible(node, predicate, maxDepth)`     | Recursive AT-SPI tree walk         |
| `findAllAccessibles(node, predicate, maxDepth)` | Find all matching nodes            |
| `waitForAccessible(predicate, timeoutMs)`       | Polling tree walk                  |
| `hasState(node, stateType)`                     | Check `Atspi.StateType`            |
| `hasRole(node, roleName)`                       | Check role name                    |
| `getName(node)`                                 | Get accessible name                |
| `doAction(node)`                                | Perform default action             |
| `openPrefsWindow(timeoutMs)`                    | Open prefs via D-Bus + AT-SPI poll |
| `navigateToTab(prefsWindow, tabName)`           | Click page tab                     |
| `findSwitch(prefsWindow, switchName)`           | Find toggle button by label        |

### Adding new shared helpers

When you need a helper usable by both E2E and integration:

1. Add the function to `test/lib/shared-commands.js`.
2. Re-export it from `test/integration/specs/helpers.js`.
3. Import it in E2E suites from `../../lib/shared-commands.js`.
4. Import it in integration specs from `../lib/shared-commands.js` (or `./helpers.js`).

---

## 6. Conventions & Pitfalls

### State isolation

Always clean state in `beforeEach` / `afterEach`:

```js
beforeEach(async () => {
  await closeAllWindows();
  clearResizedWindows(); // Prevent _resizedWindows bleed
  clearMonitorConstraints(); // Reset constraints between tests
});
```

### No GSettings writes in devkit runners

The devkit E2E compositor shares the host's `~/.config/dconf/user` directly. Any `Gio.Settings` write from the E2E runner modifies the host's dconf database. **Never write GSettings from `runner.js` or E2E suites.** Use `getAnvilSettings()` only for reading.

For integration tests, the container has its own dconf database, so writes are safe.

### `global.__anvil_*` pattern

In GNOME 50, `Main.extensionManager.lookup(UUID)` returns a **proxy** that only forwards base `Extension` properties/methods. Custom fields (`extWm`, `settings`) are blocked.

**Always use these globals instead:**

- `global.__anvil_extWm` — the real `WindowManager` instance
- `global.__anvil_settings` — the real `Gio.Settings` object
- `global.__anvil_test_state` — test-only state (set when `test-mode=true`)

Set in `extension.ts`:

```js
global.__anvil_extWm = this.extWm;
global.__anvil_settings = this.settings;
```

### Devkit vs Headless sessions (see gnome-shell-debug skill)

See the `gnome-shell-debug` skill for the complete, non-duplicated facts on both seams (Devkit default; Headless when explicitly needed or self-sufficient for things like settings toggles).

Use `--headless --virtual-monitor 1920x1080` (exact monitors) for automated tests.

### `Shell.Eval` is dead

`Shell.Eval` returns `(false, '')` for all expressions on this system. **Never use it.** Use D-Bus APIs (`org.gnome.Shell.Extensions.*`) or direct GJS API calls instead.

### Jasmine bootstrap in containers

`jasmine-gjs` is installed from source (not in Fedora repos). The bootstrap sequence:

```js
// test/integration/runner.js
globalThis.jasmineImporter = imports["jasmine-gjs"];
imports.searchPath.push("/usr/share/jasmine-gjs");
const jasmineBoot = imports["jasmineBoot"];
const runner = new jasmineBoot.Runner();
runner.installAPI(globalThis); // Installs describe/it/expect as globals
const env = runner.env;
// ... register reporters, import specs ...
env.execute(); // Does NOT call System.exit()
```

### `GLib.Variant` tuple syntax

For tuple types, wrap the string in an array:

```js
// CORRECT
new GLib.Variant("(s)", ["pong"]);

// WRONG — GJS 1.88 iterates a bare string, producing only the first character
new GLib.Variant("(s)", "pong");
```

---

## 7. Quick Reference

### Commands

```bash
# Unit
npm run test:unit
npm run test:unit:watch
npm run typecheck
npm run typecheck:test

# Integration (requires Podman)
make test-integration FEDORA_VERSION=44
make test-integration-all
make test-integration-build-all

# E2E (requires host GNOME Shell)
make test-e2e
python3 test/e2e/run.py --tag resize
python3 test/e2e/run.py --no-build

# Full pipeline
npm test
```

### File paths

| Purpose                  | Path                                |
| ------------------------ | ----------------------------------- |
| Unit tests               | `test/unit/**/*.test.ts`            |
| Unit mocks               | `test/unit/__mocks__/**/*.js`       |
| Integration specs        | `test/integration/specs/*.js`       |
| Integration runner       | `test/integration/runner.js`        |
| Integration orchestrator | `test/integration/run.py`           |
| Integration container    | `test/integration/Containerfile`    |
| E2E suites               | `test/e2e/suites/*.js`              |
| E2E runner               | `test/e2e/runner.js`                |
| E2E orchestrator         | `test/e2e/run.py`                   |
| Shared Python utils      | `test/lib/runner_utils.py`          |
| Shared GJS commands      | `test/lib/shared-commands.js`       |
| E2E framework            | `test/e2e/lib/framework.js`         |
| Integration helpers      | `test/integration/specs/helpers.js` |

### Test counts (as of 2026-05-17)

| Layer       | Count                |
| ----------- | -------------------- |
| Unit        | 801                  |
| Integration | ~115+ (8 spec files) |
| E2E         | 81                   |

### Results files

| Layer       | Path                              |
| ----------- | --------------------------------- |
| E2E         | `/tmp/anvil-e2e-results.json`     |
| Integration | `/tmp/anvil-jasmine-results.json` |

### Key environment variables

| Variable                   | Set by                       | Purpose                                 |
| -------------------------- | ---------------------------- | --------------------------------------- |
| `DBUS_SESSION_BUS_ADDRESS` | `runner_utils.py`            | D-Bus session bus address               |
| `GSETTINGS_SCHEMA_DIR`     | `start-session.sh`, `run.py` | Points to extension schemas             |
| `WAYLAND_DISPLAY`          | `run.py`                     | Wayland socket name (e.g., `wayland-1`) |
| `XDG_RUNTIME_DIR`          | `start-session.sh`           | Runtime directory for sockets           |

### When to write which test

| What you are testing                                        | Write in                                           |
| ----------------------------------------------------------- | -------------------------------------------------- |
| Pure logic, tree algorithms, geometry math                  | Unit test                                          |
| GSettings read/write, preferences UI state                  | Integration test                                   |
| Window tiling behavior, keyboard shortcuts, resize clamping | Integration test (primary) or E2E test (dev loop)  |
| Extension lifecycle (enable/disable)                        | Any layer (integration is fastest with real shell) |

### See also

- `AGENTS.md` — Router to `.agents/context/` and `.agents/rules/`
- `.agents/context/build.md` — Build and test commands
- `.agents/context/debugging.md` — High-level pointers (seams owned by debug skill)
- `.agents/rules/workflow.md` — Agent workflow and test gates
- `.agents/skills/review/` — Pre-submission review checklist
- `.agents/skills/gnome-shell-debug/` — Devkit Seam (default) and Headless Seam, launchers, LG, GDB, logs
