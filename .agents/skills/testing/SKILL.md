---
name: testing
description: Write, run, and debug Anvil unit and E2E tests
license: MIT
compatibility: agents
---

# Testing Guide — Unit and E2E

Anvil uses two independent test layers.

| Layer    | Runtime                       | Language         | Framework                       | Speed  | GNOME Shell needed? |
| -------- | ----------------------------- | ---------------- | ------------------------------- | ------ | ------------------- |
| **Unit** | Node.js                       | TypeScript       | vitest + hand-written GJS mocks | ~1 s   | No                  |
| **E2E**  | Host → gnome-shell --headless | GJS (ES modules) | Jasmine via `jasmine-gjs`       | ~1–3 m | Yes (local)         |

Both shell automation paths share **Python bootstrap** utilities (`test/lib/runner_utils.py`)
and **GJS helpers** (`test/lib/shared-commands.js`).

---

## 1. Unit Tests (vitest)

### Where they live

```text
test/unit/
  __mocks__/        # All GJS/GNOME API mocks
  mocks/helpers/    # Test fixtures and utilities
  types/            # Type declarations for test-only types
  setup.js          # vitest setup (mock global, log, logError, print)
  extension/        # Unit tests for src/lib/extension/*.ts
  shared/           # Unit tests for src/lib/shared/*.ts
  css/              # CSS parser unit tests
```

### Running unit tests

```bash
npm run test:unit      # Single run (~1 s, ~832 tests)
npm run test:unit:watch # Watch mode
```

### Writing a unit test

Import vitest globals explicitly. Use `createAnvilRuntimeFixture()` from
`test/unit/mocks/helpers/testFixtures.js`. Always call `ctx.wm.destroy()` in `afterEach`.

When source imports a new `gi://` or `resource://` path: add a mock under `__mocks__/` and an alias
in `vitest.config.js`.

---

## 2. E2E Tests (host headless + Jasmine)

### Architecture

```text
make test-e2e
  → python3 test/e2e/run.py
    → require jasmine-gjs at /usr/share/jasmine-gjs/
    → make dist (unless --no-build)
    → install zip → ~/.local/share/gnome-shell/extensions/
    → isolated D-Bus + dbusmock stubs
    → gnome-shell --wayland --headless --virtual-monitor 1920x1080
         --automation-script test/e2e/runner.js
      → export async function run()
        → test-mode=true, wait ACTIVE + __anvil_test_state + __anvil_runtime
        → boot Jasmine, import suites/*.js, execute
        → write /tmp/anvil-e2e-results.json
    ← poll results, print summary
```

### Suites (`test/e2e/suites/`)

| File             | Coverage                                                   |
| ---------------- | ---------------------------------------------------------- |
| `extension.js`   | Load, ACTIVE, test-mode, disable/re-enable                 |
| `tiling.js`      | Fill work area, multi-window no-overlap, after swap/toggle |
| `keyboard.js`    | Super+H / Super+J / Super+C                                |
| `operations.js`  | Alt+F4 re-tile                                             |
| `resize.js`      | Keyboard resize + 6×3×4 constraint matrix (~74)            |
| `focus.js`       | Focus directions                                           |
| `swap.js`        | Swap directions + WindowSwapLastActive                     |
| `move.js`        | Move directions                                            |
| `floating.js`    | Float, snap layout, tiling mode toggle                     |
| `layouts.js`     | Split, stacked, tabbed, layout toggle                      |
| `workspace.js`   | WorkspaceActiveTileToggle                                  |
| `borders.js`     | Focus border + gap size                                    |
| `minimize.js`    | Minimize/unminimize re-tile                                |
| `constraints.js` | Monitor constraint clamp/exempt                            |

### Writing an E2E suite

```js
import { launchApp, closeAllWindows, sendAnvilCommand, getWindowGeometries, waitForWindowCount } from "../../lib/shared-commands.js";

describe("My feature", function () {
  beforeEach(async function () {
    await closeAllWindows();
  });

  afterEach(async function () {
    // Restore any GSettings mutated by this suite
    await closeAllWindows();
  });

  it("does something", async function () {
    await launchApp("org.gnome.TextEditor.desktop");
    await waitForWindowCount(1, 5000);
    // …
  });
});
```

Register new suites in `test/e2e/runner.js` (`suites` array).

### Prerequisites

- Host GNOME Shell with `--headless` and `--virtual-monitor` (GNOME 49+)
- **jasmine-gjs** at `/usr/share/jasmine-gjs/` (from source if not packaged):

```bash
git clone --depth=1 https://github.com/ptomato/jasmine-gjs.git
cd jasmine-gjs && meson setup _build --prefix=/usr
ninja -C _build && sudo ninja -C _build install
```

On immutable hosts (Bazzite), install inside a distrobox that has gnome-shell, or layer packages.

### Running E2E

```bash
make test-e2e
python3 test/e2e/run.py --tag resize
python3 test/e2e/run.py --no-build --tag focus
```

### PR vs nightly (D2-2)

| Gate                  | Command                                             | When                                    |
| --------------------- | --------------------------------------------------- | --------------------------------------- |
| **PR / CI**           | `npm test` (static, TS, unit, pure Python tooling)  | Every commit / PR                       |
| **Local PR smoke**    | `python3 test/e2e/run.py --tag focus` (or `resize`) | Before merge when touching focus/layout |
| **Nightly / release** | `make test-e2e` (full suite)                        | Pre-release, local                      |

`--tag` filters by suite/spec name substring — use it to keep PR loops short.

### Geometry assertions (D2-1)

Wayland clients may not accept exact pixel rects. Prefer:

1. **Tree percent** checks via `getNodePercents()` / `Tree.serializeForTest()`
2. Relative geometry (fill work area, no overlap, order)
3. Pixel equality only with loose tolerances when unavoidable

Avoid brittle exact frame rect asserts in new E2E specs.

### GSettings in E2E

Writes touch the session dconf used by the headless shell. Prefer restore in `afterEach`.
Do not add bulk “toggle every key” smoke tests (unit + schema compile cover schema existence).

### `global.__anvil_*` pattern

In GNOME 50, `Main.extensionManager.lookup(UUID)` returns a proxy. Use:

- `global.__anvil_runtime` / `getAnvilRuntime()`
- `global.__anvil_settings` / `getAnvilSettings()` / `getSettings()`
- `global.__anvil_test_state` when `test-mode=true`

### Not testable headless

- Mouse drag-and-drop
- Pixel-level visual rendering

---

## 3. Shared helpers (`test/lib/shared-commands.js`)

| Function                                                                   | Purpose                       |
| -------------------------------------------------------------------------- | ----------------------------- |
| `launchApp(desktopFile)`                                                   | Open app, wait for window     |
| `openWindow()`                                                             | gnome-text-editor convenience |
| `getWindowCount()` / `getWindowGeometries()`                               | Window queries                |
| `getFocusedWindowId()` / `waitForFocusChange` / `waitForFocusWindow`       | Focus polling                 |
| `waitForWindowCount` / `waitForGeometry`                                   | Async waits                   |
| `sendKeyCombo` / `sendAnvilCommand`                                        | Shortcuts / WM commands       |
| `closeAllWindows`                                                          | Cleanup                       |
| `getAnvilRuntime` / `getAnvilSettings` / `getNodePercents`                 | Extension state               |
| `clearResizedWindows` / `clearMonitorConstraints` / `setMonitorConstraint` | State isolation               |
| `windowsOverlap` / `windowsFillWorkArea`                                   | Geometry assertions           |

---

## 4. Conventions

- Clean windows in `beforeEach` / `afterEach`
- Use window IDs for focus, not titles
- Prefer `org.gnome.TextEditor.desktop` for ported suites
- `Shell.Eval` is dead — never use it
- Never write exploits or attack systems

---

## 5. Quick reference

```bash
# Unit
npm run test:unit
npm run typecheck
npm run lint
npm run test:tooling      # pure Python tooling tests; live host smoke is forced off
npm run test:tooling:host # opt-in live HeadlessShellSession smoke; builds dist/ first
npm test                 # static + TypeScript + unit + pure Python tooling

# E2E
make test-e2e
python3 test/e2e/run.py --tag focus
```

| Purpose             | Path                          |
| ------------------- | ----------------------------- |
| Unit tests          | `test/unit/**/*.test.ts`      |
| E2E suites          | `test/e2e/suites/*.js`        |
| E2E runner          | `test/e2e/runner.js`          |
| E2E orchestrator    | `test/e2e/run.py`             |
| Shared GJS commands | `test/lib/shared-commands.js` |
| Shared Python utils | `test/lib/runner_utils.py`    |

### When to write which test

| What you are testing                                     | Write in                                |
| -------------------------------------------------------- | --------------------------------------- |
| Pure logic, tree, geometry math                          | Unit                                    |
| Window tiling, keyboard, resize, lifecycle on real shell | E2E                                     |
| Prefs UI widget tree                                     | Unit / manual for now (no AT-SPI suite) |

### See also

- `.agents/context/build.md` — commands
- `.agents/rules/workflow.md` — gates
- `.agents/skills/gnome-shell-debug/` — devkit / headless seams
