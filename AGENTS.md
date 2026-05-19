# AGENTS.md

## Overview

Anvil is a GNOME Shell tiling extension (fork of Forge). It runs inside **GJS** (GNOME's JS runtime), not Node.js. Source is **TypeScript**, compiled to JavaScript via `tsc` into the `dist/` directory. Unit tests run in Node.js via vitest with hand-written mocks for all GJS/GNOME APIs.

## GNOME Shell Runtime Model

### Process separation

| File                 | Process       | Available APIs                                | Unavailable                        |
| -------------------- | ------------- | --------------------------------------------- | ---------------------------------- |
| `src/extension.ts`   | gnome-shell   | Clutter, St, Meta, Shell, `global`, Gio, GLib | Gtk                                |
| `src/prefs.ts`       | isolated Gtk  | Gtk4, Adwaita, Gio, GLib                      | Clutter, St, Meta, Shell, `global` |
| `src/stylesheet.css` | Shell UI only | —                                             | Does NOT apply to prefs window     |

Once loaded, an extension effectively becomes part of GNOME Shell — it can access and
modify **any** internal Shell JS code or C library exposed via GObject-Introspection.

### Toolkit stack

```
St (buttons, entries, CSS)  →  builds on Clutter
Clutter (Actors, layouts)    →  base widget toolkit
Mutter / Meta                →  window/compositor API (displays, workspaces, windows)
Shell / global               →  Shell utilities + global state object
```

GObject-Introspection bridges all C libraries to GJS — `gi://Gio`, `gi://St`, etc.

### `extension.ts` lifecycle (critical — get this wrong and the shell breaks)

1. `constructor(metadata)` — called **once** on load. Set up translations only.
   Do **NOT** connect signals, modify Shell, or create UI.
2. `enable()` — called on login, unlock, or manual enable. Create UI, connect
   signals, modify Shell behavior.
3. `disable()` — called on lock, disable, or uninstall. **Must undo everything
   from `enable()`**. Leaving stale signals/UI is the #1 reason extensions
   are rejected.

### `metadata.json` key fields

- `uuid`: `anvil@GenKerensky.github.com` — install folder must match
- `settings-schema`: e.g. `org.gnome.shell.extensions.anvil` — makes `getSettings()` work without args
- `session-modes`: `["user", "unlock-dialog"]` to persist through lock screen
- `shell-version`: array of strings, major version only since GNOME 40 (e.g. `["45","46","47","48","49","50","50.1"]`)

### Installed extension layout (matches `dist/` build output)

```
~/.local/share/gnome-shell/extensions/anvil@GenKerensky.github.com/
├── extension.js
├── metadata.json
├── prefs.js
├── stylesheet.css
├── schemas/
│   ├── gschemas.compiled
│   └── org.gnome.shell.extensions.anvil.gschema.xml
├── locale/<lang>/LC_MESSAGES/anvil.mo
├── config/windows.json
├── lib/
├── resources/
└── LICENSE
```

## Build Commands

```bash
make dev             # Build + install in dev mode (restart shell to load)
make build           # tsc → dist/ + copy static assets
make install         # Install dist/ → ~/.local/share/gnome-shell/extensions/
make dist            # Build → .zip artifact
make clean           # Remove dist/, src/schemas/gschemas.compiled, src/lib/prefs/metadata.js
npm run format       # Prettier (printWidth 100, tabWidth 2)
npm run build        # tsc only (compile TS → dist/)
npm run typecheck             # tsc --noEmit + tsconfig.test + tsconfig.e2e + tsconfig.integration (all type checks)
npm run typecheck:e2e         # tsc --project tsconfig.e2e.json (E2E GJS files only)
npm run typecheck:integration # tsc --project tsconfig.integration.json (integration GJS files only)
npm run typecheck:all         # same as npm run typecheck
```

`make build` depends on: `clean` → `npm run build` (tsc) → `schemas` → `compilemsgs` → `metadata`. Generated files: `src/lib/prefs/metadata.js` (from git log), `src/schemas/gschemas.compiled`, `src/po/anvil.pot`, `*.mo`. Output directory: `dist/`.

## Test Commands (run in this order)

```bash
npm run typecheck    # tsc --noEmit (4 tsconfigs: src, unit, e2e, integration)
npm run lint         # eslint . && prettier --check
npm run test:unit    # vitest run (~767 tests, no GNOME runtime needed)
npm run test:unit:watch   # vitest watch mode

# Full pipeline (CI order):
npm test             # typecheck → lint → unit → integration build → integration all
```

### Container integration tests (`test/integration/`)

Container-based tests run `gnome-shell --headless --wayland` inside Podman.
Tests are written as **Jasmine specs** (via `jasmine-gjs`) that run entirely inside the
gnome-shell process via `--automation-script`:

```bash
make test-integration              # Fedora 44 (default, GNOME 50)
make test-integration FEDORA_VERSION=43  # GNOME 49
make test-integration FEDORA_VERSION=42  # GNOME 48
make test-integration-all          # All three versions
```

`test/integration/runner.js` is loaded by `--automation-script`. It uses module-level
promise chains (not `export async function run()` — headless does not call `run()`).
On startup it sets `test-mode=true`, waits for the extension to be ACTIVE, bootstraps
Jasmine from the system-installed `jasmine-gjs` package (`/usr/share/jasmine-gjs/`),
imports all spec files, runs `env.execute()`, and writes results to
`/tmp/anvil-jasmine-results.json`. `run.py` polls for that file.

Jasmine specs live in `test/integration/specs/`. Preferences UI tests use `gi://Atspi`
(same AT-SPI bus as the old Dogtail tests, but from GJS directly).

`jasmine-gjs` is not in the Fedora repos — it is built from source as a container layer
(`git clone + meson + ninja install`, ~6 seconds). The `jasmine` CLI is not used; only
`/usr/share/jasmine-gjs/jasmineBoot.js` is imported programmatically.

Requires Podman + `glib2-devel` (`make dist` needs it). Container images are built per
Fedora version. Test count: 4 spec files covering extension lifecycle, tiling, settings,
preferences UI (gi://Atspi), and AT-SPI tree.

### Devkit E2E tests (`test/e2e/`)

Local devkit-compositor tests that run on the host GNOME Shell:

```bash
make test-e2e                      # Local devkit compositor (host GNOME version)
```

Uses `gnome-shell --devkit --wayland --automation-script`. The `--devkit` flag **does** call `export async function run()` on the automation script. `run.py` (Python orchestrator) manages: isolated D-Bus → `dbus-daemon` → `gnome-shell --devkit` → extension install → wait for results JSON. Supports keyboard injection via `wtype` and screenshot via `gnome-screenshot`. 7 E2E tests (extension lifecycle, tiling geometry, keyboard shortcuts, Alt+F4 operations).

**Important**: `Shell.Eval` is broken system-wide (returns `(false, '')` for all expressions); D-Bus APIs (`org.gnome.Shell.Extensions.*`) and direct GJS API calls replace it everywhere.

## Pre-commit Hook

Husky runs `lint-staged` then `npm run test:unit` on every commit. Commits are blocked if unit tests fail.

## Agent Instructions

**After every `.ts` or `.js` source file change**, run these commands in order before considering the task complete:

```bash
npm run typecheck    # tsc --noEmit — must pass with 0 errors
npm run lint         # eslint . && prettier --check — must pass with 0 errors
```

If either fails, fix the errors before proceeding. The only acceptable warnings are:

- `@typescript-eslint/no-explicit-any` (tracked in `TODO.md` for strict-mode cleanup)
- `eslint-disable` directive mismatches on files being converted from `@ts-nocheck`

**When editing existing source files**, always preserve the original author's comments (copyright headers, section markers like `// Gnome imports`, JSDoc descriptions, `@deprecated` annotations, TODO notes, and inline explanations) as long as they remain relevant and accurate after the change. Only remove comments that are factually wrong, superseded by the edit, or were placeholders already addressed.

For `.ts` test file changes, `npm run test:unit` must also pass.

For integration test changes (`test/integration/`), `npm run test:integration` must pass against at least Fedora 44 (default).

For E2E test changes (`test/e2e/`), `make test-e2e` must pass.

For `.js` test file changes in `test/e2e/` or `test/integration/`, `npm run typecheck:e2e` or `npm run typecheck:integration` must also pass respectively.

### GJS automation-script API pitfalls

When writing scripts for `gnome-shell --automation-script`, remember:

- **Module-level code executes in both `--headless` and `--devkit`**, but `export async function run()` is only called by `--devkit`. For the container runner, use top-level promise chains.
- **`GLib.Variant('(s)', value)`** for tuple types must wrap the string in an array: `['pong']` not `'pong'`. GJS 1.88 iterates a bare string, producing only the first character.
- **`Main.extensionManager.lookup(UUID).extWm`** can be `null` even when extension state is ACTIVE; use `global.__anvil_test_state.extWm` as the reliable fallback (requires `test-mode=true` set via `Gio.Settings` before extension enable).
- **`Gio.Settings({ schema_id })`** works inside automation scripts when `GSETTINGS_SCHEMA_DIR` env var points to the extension's schemas directory — set this in `start-session.sh` before launching gnome-shell.
- **jasmine-gjs bootstrap**: Import `jasmineBoot.js` from `file:///usr/share/jasmine-gjs/jasmineBoot.js`. Must first set `globalThis.jasmineImporter = imports['jasmine-gjs']` with the correct `imports.searchPath` so jasmineBoot can find the jasmine core. Call `runner.installAPI(globalThis)` to install `describe`/`it`/`expect` etc. as globals, then `env.execute()` to run specs — does NOT call `System.exit()`.
- **`gi://Atspi` tree walking**: Call `Atspi.init()` before any Atspi calls. Use `Atspi.get_desktop(0)` to get the root, then `node.get_child_count()` / `node.get_child_at_index(i)`. Check switch state with `node.get_state_set().contains(Atspi.StateType.CHECKED)`. Click via `node.get_action_iface().do_action(0)`. Wrap all Atspi calls in try/catch — stale nodes throw.

## Architecture

```
src/
  extension.ts          # Entry point loaded by GNOME Shell
  prefs.ts              # Preferences window entry point
  ambient.d.ts          # Type declarations
  stylesheet.css        # Shell theme overrides
  lib/
    extension/          # Core tiling: tree, windows, keybindings, utils, theme
    shared/             # Shared between extension + prefs: logger, settings, theme
    prefs/              # Preferences UI (metadata.js is gitignored + auto-generated)
    css/                # CSS parsing (@ts-nocheck — third-party library)
  config/windows.json   # Default window override config
  po/                   # Translation files (POT, PO, MO)
  resources/            # Static assets (icons)
  schemas/              # GSettings schemas
  types/                # TypeScript declaration files
```

### tsconfig hierarchy

Four tsconfigs, each targeting a distinct layer. E2E and integration share a GJS base so they don't inherit the main source's `rootDir: "./src"`.

| Config                      | Extends             | `rootDir` | Includes                                                                 | Purpose                              |
| --------------------------- | ------------------- | --------- | ------------------------------------------------------------------------ | ------------------------------------ |
| `tsconfig.json`             | —                   | `./src`   | `src/**/*.ts`, `src/**/*.d.ts`                                           | Main source → `dist/`                |
| `tsconfig.gjs-base.json`    | —                   | `.`       | — (base only)                                                            | Shared GJS test compiler options     |
| `tsconfig.test.json`        | `tsconfig.json`     | `.`       | `src/**/*.ts`, `test/unit/**/*.ts`, vitest types                         | Unit tests (Node.js/vitest)          |
| `tsconfig.e2e.json`         | `tsconfig.gjs-base` | `.`       | `test/e2e/**/*.js`, `test/lib/shared-commands.js`, GJS types             | E2E automation scripts               |
| `tsconfig.integration.json` | `tsconfig.gjs-base` | `.`       | `test/integration/**/*.js`, `test/lib/shared-commands.js`, jasmine types | Integration specs                    |
| `test/tsconfig.json`        | `tsconfig.gjs-base` | `.`       | `test/**/*.js`, `test/**/*.ts`, `test/**/*.d.ts`                         | IDE discoverability (not used in CI) |

`test/tsconfig.json` is not run in CI — it exists so VS Code (and other LSP clients) can resolve types when you open any file under `test/`. The per-layer configs are used by `npm run typecheck`.

Source in `src/lib/shared/*.ts` → tests in `test/unit/shared/*.test.ts`.
Source in `src/lib/extension/*.ts` → tests in `test/unit/extension/*.test.ts`.

## Test Architecture

Three layers, from fastest to slowest. All are required for confident changes.

| Layer           | Runtime                                   | Language         | Framework                       | Location            | Time  |
| --------------- | ----------------------------------------- | ---------------- | ------------------------------- | ------------------- | ----- |
| **Unit**        | Node.js (vitest)                          | TypeScript       | vitest + hand-written GJS mocks | `test/unit/`        | ~2 s  |
| **Integration** | Podman container → gnome-shell --headless | GJS (ES modules) | Jasmine via jasmine-gjs         | `test/integration/` | ~40 s |
| **E2E**         | Host → gnome-shell --headless             | GJS (ES modules) | Custom `describe`/`it`/`assert` | `test/e2e/`         | ~30 s |

```
test/
  lib/              # Shared utilities for both test environments
    runner_utils.py       # _info/_pass/_fail, start_dbus_session, start_mocks,
                          # wait_for_shell_dbus, wait_for_results, print_results
    shared-commands.js     # Shared GJS helpers (launchApp, sendKeyCombo, geometry, constraints)
  unit/             # All vitest tests (hand-mocked GJS, no GNOME runtime)
    __mocks__/      # GJS/GNOME Shell mocks (gi://, resource://)
    mocks/helpers/  # Test fixtures (createMockWindow, createWindowManagerFixture)
    setup.js        # Vitest setup: mock global, log, etc.
    types/          # TypeScript declarations for test helpers
    css/            # CSS parser unit tests
    extension/      # Unit tests for src/lib/extension/ (WindowManager, Tree, etc.)
    shared/         # Unit tests for src/lib/shared/ (settings, logger, theme)
    window-operations.test.ts  # Mock integration test (vitest)
  e2e/              # Devkit-based E2E (gnome-shell --headless --automation-script)
    run.py          # Python orchestrator: DevkitSession → dbus-daemon → gnome-shell → results
    runner.js       # ES module loaded by --automation-script; calls run()
    lib/            # Test framework & commands (describe/it/assert)
    suites/         # Test suites (extension, tiling, keyboard, operations, resize)
  integration/      # Container-based integration (gnome-shell --headless --wayland)
    runner.js       # Automation-script: boots Jasmine, runs specs, writes results JSON
    run.py          # Python orchestrator: ContainerSession → podman → results JSON
    start-session.sh # Container entrypoint: D-Bus → mocks → gnome-shell (bash, systemd ExecStart)
    set-env.sh      # Environment wrapper for all podman exec calls
    specs/          # Jasmine spec files (GJS ES modules, run inside gnome-shell)
      helpers.js              # AT-SPI helpers + re-exports from shared-commands.js
      extension-lifecycle.js  # Extension active/disabled state
      tiling.js               # Tiling mode, layout settings, geometry
      keyboard.js             # Keyboard shortcuts (Super+H, Super+J, Super+C)
      operations.js           # Window close + re-tile
      resize.js               # Resize clamping/exemption (74 data-driven tests)
      constraints.js          # Monitor constraint GSettings + geometry
      settings.js             # All gsettings (gap, float, focus, effects)
      preferences.js          # Preferences window UI (gi://Atspi) + AT-SPI tree
```

### Running individual layers

```bash
# Unit tests — no GNOME Shell needed
npm run test:unit

# Integration tests — requires Podman, builds container if missing
make test-integration           # Fedora 44 (GNOME 50)
make test-integration FEDORA_VERSION=43  # GNOME 49
make test-integration FEDORA_VERSION=42  # GNOME 48
make test-integration-all       # All three versions

# E2E tests — requires host GNOME Shell, runs on --headless compositor
make test-e2e

# Full CI pipeline (runs all layers in order)
npm test
```

### When to run what

| Change type                   | Must pass                                                            | Should also pass            |
| ----------------------------- | -------------------------------------------------------------------- | --------------------------- |
| Source `.ts` or `.js`         | `npm run typecheck`, `npm run lint`                                  | `npm run test:unit`         |
| Unit test `.test.ts`          | `npm run test:unit`                                                  | `npm run typecheck`         |
| Integration spec `.js`        | `make test-integration` (Fedora 44), `npm run typecheck:integration` | `make test-integration-all` |
| E2E suite `.js`               | `make test-e2e`, `npm run typecheck:e2e`                             | —                           |
| E2E lib `.js`                 | `npm run typecheck:e2e`                                              | `make test-e2e`             |
| Integration runner `.js`      | `npm run typecheck:integration`                                      | `make test-integration`     |
| GSettings schema              | `make test-integration FEDORA_VERSION=44`                            | `make test-e2e`             |
| `src/lib/extension/window.ts` | All three layers                                                     | All Fedora versions         |

For deep documentation on writing tests for each layer, load the **testing** skill:

```
Use the skill tool to load the "testing" skill for full testing guidance.
```

## Key Conventions

- **Language**: TypeScript (not JavaScript). `tsc` compiles to JavaScript in `dist/`. The tsconfig uses `module: NodeNext, moduleResolution: NodeNext, target: ES2022`.
- **TypeScript strict mode**: Enabled (`strict: true`, `noImplicitAny: true`, `noImplicitThis: true`). One file uses `@ts-nocheck` (`src/lib/css/index.ts` — third-party CSS parser). All other source files are fully typed. See `TODO.md` for remaining `any` usage patterns.
- **GJS imports**: Source uses `gi://Gio`, `resource:///org/gnome/shell/...` paths. Unit tests remap these to `test/unit/__mocks__/` via vitest aliases. Type declarations come from `@girs/*` packages and `ambient.d.ts`.
- **Test globals**: `log`, `logError`, `print`, `global` are mocked in `test/unit/setup.js`.
- **ESLint**: Flat config (`eslint.config.js`) using `typescript-eslint` recommended rules. Test files have `vitest/no-focused-tests: error`. Third-party \`src/lib/css/index.ts\` has relaxed rules.
- **Prettier**: `printWidth: 100, tabWidth: 2` — wider than defaults.
- **Integration**: Uses GNOME Shell `--headless --wayland` in containers. No keyboard/pixel/drag-drop testing possible headless. All tests run as Jasmine specs inside gnome-shell via `--automation-script`, using `gi://Gio` for GSettings and `gi://Atspi` for preferences UI checks. See `test/integration/`.
- **E2E**: Uses `gnome-shell --devkit --wayland` locally. Supports keyboard injection via `wtype` and screen capture via `gnome-screenshot`. Uses `export async function run()` in the automation script (devkit calls `run()`). See `test/e2e/`.
- **Container runner.js**: Uses module-level code (not `run()`), bootstraps `jasmineBoot.js` from `/usr/share/jasmine-gjs/`, installs Jasmine globals, imports spec files, runs `env.execute()`, writes results JSON. No D-Bus service registration required.
- **`Shell.Eval` is dead**: Returns `(false, '')` for all expressions on this system. Never use it. D-Bus APIs (`org.gnome.Shell.Extensions.*`) and direct GJS API calls are the replacement.
- **Extension UUID**: `anvil@GenKerensky.github.com`
- **Install path**: `~/.local/share/gnome-shell/extensions/anvil@GenKerensky.github.com/`
- **Type declarations**: `ambient.d.ts` imports `@girs/gjs`, `@girs/gnome-shell/ambient`, `@girs/gnome-shell/extensions/global`. `gi://Shell` types in `test/unit/types/gi-shell.d.ts`.
- **Build output**: `dist/` is gitignored. `src/lib/prefs/metadata.js` is auto-generated during build and gitignored.

## Headless / Devkit Debugging Guide

### `--devkit` vs `--headless`

GNOME 49+ replaced `--nested` with `--devkit` (a Wayland-native compositor, not X11-based). For automated testing there are two launch modes:

| Flag         | Behavior                                                                           | Use case              |
| ------------ | ---------------------------------------------------------------------------------- | --------------------- |
| `--devkit`   | Starts the full Mutter Development Kit GUI (mutter-devkit) + a headless compositor | Interactive debugging |
| `--headless` | Starts only the headless compositor, no devkit GUI                                 | CI / automated tests  |

Both support `--automation-script` and both call `export async function run()` on the script.

### Setting the dummy monitor resolution

**Do NOT use `MUTTER_DEBUG_DUMMY_MODE_SPECS`** — that env var only works for the old `--nested` (X11) backend. For GNOME 50's native/headless backend, use the `--virtual-monitor` CLI flag:

```bash
# CORRECT: single 1920×1080 monitor
gnome-shell --wayland --headless --virtual-monitor 1920x1080 --automation-script test.js

# WRONG: creates a second unwanted 1280×800 monitor alongside your desired size
gnome-shell --wayland --devkit --virtual-monitor 1920x1080 --automation-script test.js
```

The `--devkit` flag always adds its own 1280×800 dummy monitor in addition to any `--virtual-monitor` you specify, giving you **two** monitors. `--headless` gives you exactly the monitors you ask for.

### Launching manually for debugging

```bash
# Minimal headless session with a single 1920×1080 monitor
dbus-run-session gnome-shell \
  --wayland --headless \
  --virtual-monitor 1920x1080 \
  --automation-script /tmp/my-test.js
```

To verify the resolution inside the script:

```javascript
const display = global.display;
for (let i = 0; i < display.get_n_monitors(); i++) {
  const g = display.get_monitor_geometry(i);
  log(`Monitor ${i}: ${g.width}x${g.height}`);
}
```

### Important gotchas

1. **Screenshots don't work in `--headless`** — `gnome-screenshot` and the Shell Screenshot D-Bus API need a real framebuffer. Use `--devkit` if you need visual debugging.
2. **Keyboard injection via `wtype` works in both** — as long as `WAYLAND_DISPLAY` is set to the nested socket.
3. **Devkit creates a viewer window** — the mutter-devkit binary opens a GTK window showing the compositor output. This steals focus and can interfere with automated key injection.
4. **`MUTTER_DEBUG_DUMMY_MODE_SPECS` is ignored** by the headless/native backend. It only affects the legacy `--nested` X11 backend.
5. **`--virtual-monitor` can be given multiple times** for multi-monitor tests: `--virtual-monitor 1920x1080 --virtual-monitor 1280x720`.
6. **Work area ≠ monitor geometry** — the top panel (32 px) reduces the work area height. For 1920×1080: `workArea = {x:0, y:32, width:1920, height:1048}`.

### Related source files (Mutter 50)

- `src/core/meta-context-main.c` — parses `--virtual-monitor`, `--headless`, `--devkit` flags
- `src/backends/native/meta-monitor-manager-native.c` — creates virtual monitors via `meta_monitor_manager_native_create_virtual_monitor()`
- `src/backends/native/meta-virtual-monitor-native.c` — native virtual monitor implementation
- `src/core/meta-mdk.c` — devkit launcher (spawns `mutter-devkit` binary)

## Session Status (2026-05-17)

### Goal

Fix tiling window resize snap-back bug and preferences default-ON bug, with thorough E2E test coverage across layouts, constraint states, and directions.

### Fixed Bugs

| Bug                                                                                       | File                                                      | Line(s)                                 | Fix                                                                                            |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `resizePairForWindow.nodeValue` cast assumes `Meta.Window` but can be `St.Bin` (CON node) | `src/lib/extension/window.ts`                             | ~3139                                   | Guard `Logger.debug` template with `isWindow()` check before `get_title()`                     |
| `index! +/- 1` OOB access in both `diffParent` branches                                   | `src/lib/extension/window.ts`                             | 3182-3187, 3242-3248                    | Add bounds check: `if (index === null \|\| index < 0 \|\| index >= childNodes.length) return;` |
| GNOME 50 proxy blocks `ext.getSettings()` in constraint helpers                           | `src/lib/extension/window.ts`, `test/e2e/lib/commands.js` | extension.ts:94-98, commands.js:263-285 | Expose `global.__anvil_settings = this.settings` in `enable()`, use it directly in helpers     |
| GNOME 50 proxy blocks `ext.settings` (custom property)                                    | `test/e2e/lib/commands.js`                                | 253-258                                 | Use `ext.getSettings()` (base method, forwarded by proxy) instead of `ext.settings`            |
| `_resizedWindows` race with async Wayland `size-changed` signals                          | `src/lib/extension/window.ts`                             | ~139, ~1939, ~3055                      | Change `Set<number>` → `Map<number, number>`; require count ≥ 2 for exemption                  |
| `isOrthogonalResize()` geometry heuristic fails for non-uniform layouts                   | `test/e2e/suites/resize.js`                               | ~163                                    | Check `parent.isHSplit()` / `parent.isVSplit()` from tree structure as primary heuristic       |
| `_resizedWindows` state bleed between tests                                               | `test/e2e/lib/commands.js`, `test/e2e/suites/resize.js`   | commands.js:~270, resize.js:~281        | Add `clearResizedWindows()` helper; call in `beforeEach`                                       |

### Key Design Decisions

- **`global.__anvil_extWm`** is set in `enable()` always (not just test-mode), bypassing GNOME 50's lookup proxy
- **`global.__anvil_settings`** is set in `enable()` always, same reason — `getSettings()` is blocked by proxy too
- **No GSettings writes from runner.js** — devkit shares host's `~/.config/dconf/user` directly
- **Devkit window exempt** via `src/config/windows.json` entry (`org.gnome.Shell`, `DevKit`, float)
- **Resolution fixed** to 1920×1080 via `--headless --virtual-monitor 1920x1080` (not `--devkit`, which creates a second 1280×800 dummy monitor)
- **`ext.getSettings()`** (base Extension method, proxied) for constraint read/write in test helpers
- **`sendKeyCombo()`** / **`getAnvilWM()`** use `global.__anvil_extWm` (always set)
- **`_resizedWindows`** is now `Map<number, number>` tracking resize counts per window; exemption requires count ≥ 2
- **First resize always clamped** because count = 1 after `_handleGrabOpEnd()`; async Wayland `size-changed` renders still see count = 1
- **Second resize exempt** because count = 2 after second `_handleGrabOpEnd()`

### E2E Test Results

| Suite                      | Before    | After     | Notes                                                |
| -------------------------- | --------- | --------- | ---------------------------------------------------- |
| Extension Lifecycle        | 1/1       | 1/1       | .                                                    |
| Window Tiling              | 2/2       | 2/2       | .                                                    |
| Keyboard Shortcuts         | 3/3       | 3/3       | .                                                    |
| Window Operations          | 1/1       | 1/1       | .                                                    |
| Resize (baseline)          | 2/2       | 2/2       | .                                                    |
| Resize (data-driven 6×3×4) | 12/72     | 72/72     | All pass with count-based exemption + tree heuristic |
| **Total**                  | **21/81** | **81/81** | **+60, 0 failures**                                  |

### Integration Test Results (after unification)

- **~115+ tests** (up from ~35)
- New specs: `keyboard.js` (3), `operations.js` (1), `resize.js` (74), `constraints.js` (4)
- Enhanced `tiling.js` (+4 layout tests)
- All ported specs use `test/lib/shared-commands.js` (single source of truth)

### Unit Test Results

- **801/801 passing** (0 failures)
- Updated `WindowManager-monitors.test.ts` to use `Map.set()` instead of `Set.add()`

### Test Configuration

```
gnome-shell --wayland --headless --virtual-monitor 1920x1080
Work area: x=0 y=32 w=1920 h=1048
Constraint limit: 0.35 × 1920 = 672 width, 0.35 × 1048 = 366 height
Devkit connector: "Meta-0" (not "DP-1" or "HDMI-1")
```

### Relevant Files

- `src/lib/extension/window.ts` — `_handleResizing` (line ~3091), `enforceUltrawideSize`, `_getMonitorConnector`, `_getMonitorConstraints`, `_resizedWindows Map`
- `src/lib/extension/wm.ts` — `grabMode`, `decomposeGrabOp`, `allowResizeGrabOp`
- `src/extension.ts` — `enable()` sets `global.__anvil_extWm`, `global.__anvil_settings`
- `src/lib/prefs/monitors.ts` — default-ON fix, constraint UI
- `src/config/windows.json` — devkit exemption entry
- `test/e2e/lib/commands.js` — `getAnvilWM()`, `getAnvilSettings()`, `clearMonitorConstraints()`, `setMonitorConstraint()`, `clearResizedWindows()`
- `test/e2e/suites/resize.js` — 74 resize tests with tree-based `isOrthogonalResize()`
- `test/unit/extension/WindowManager-monitors.test.ts` — updated for `Map`-based `_resizedWindows`
- `src/extension.ts` — `enable()` sets `global.__anvil_extWm`, `global.__anvil_settings`
- `src/lib/prefs/monitors.ts` — default-ON fix, constraint UI
- `src/config/windows.json` — devkit exemption entry
- `test/e2e/lib/commands.js` — `getAnvilWM()`, `getAnvilSettings()`, `clearMonitorConstraints()`, `setMonitorConstraint()`, `clearResizedWindows()`
- `test/e2e/suites/resize.js` — 74 resize tests with tree-based `isOrthogonalResize()`
- `test/unit/extension/WindowManager-monitors.test.ts` — updated for `Map`-based `_resizedWindows`
