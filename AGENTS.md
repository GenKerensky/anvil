# AGENTS.md

## Overview

Anvil is a GNOME Shell tiling extension (fork of Forge). It runs inside **GJS** (GNOME's JS runtime), not Node.js. Source is **TypeScript**, compiled to JavaScript via `tsc` into the `dist/` directory. Unit tests run in Node.js via vitest with hand-written mocks for all GJS/GNOME APIs.

## GNOME Shell Runtime Model

### Process separation

| File | Process | Available APIs | Unavailable |
|------|---------|---------------|-------------|
| `src/extension.ts` | gnome-shell | Clutter, St, Meta, Shell, `global`, Gio, GLib | Gtk |
| `src/prefs.ts` | isolated Gtk | Gtk4, Adwaita, Gio, GLib | Clutter, St, Meta, Shell, `global` |
| `src/stylesheet.css` | Shell UI only | — | Does NOT apply to prefs window |

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
npm run typecheck    # tsc --noEmit (type checking without emitting)
```

`make build` depends on: `clean` → `npm run build` (tsc) → `schemas` → `compilemsgs` → `metadata`. Generated files: `src/lib/prefs/metadata.js` (from git log), `src/schemas/gschemas.compiled`, `src/po/anvil.pot`, `*.mo`. Output directory: `dist/`.

## Test Commands (run in this order)

```bash
npm run typecheck    # tsc --noEmit
npm run lint         # eslint . && prettier --check
npm run test:unit    # vitest run (~767 tests, no GNOME runtime needed)
npm run test:watch   # vitest watch mode

# Full pipeline (CI order):
npm test             # typecheck → lint → unit → integration build → integration all
```

### Container integration tests (`test/integration/`)

Container-based tests run `gnome-shell --headless --wayland` inside Podman.
Communication with the shell uses a **JS D-Bus agent** (replaces the broken `Shell.Eval` API):

```bash
make test-integration              # Fedora 44 (default, GNOME 50)
make test-integration FEDORA_VERSION=43  # GNOME 49
make test-integration FEDORA_VERSION=42  # GNOME 48
make test-integration-all          # All three versions
```

The agent (`test/integration/agent/agent.js`) registers a D-Bus service (`org.gnome.Shell.AnvilTest`) inside gnome-shell via `--automation-script`. Behave test steps call it via Python wrappers (`call_agent`, `eval_test_state`). The agent must use **module-level code** (not `export async function run()`) because `gnome-shell --headless --wayland` loads the module but does **not** call `run()` — only `gnome-shell --devkit` does.

Tests are organized as Behave feature files in `test/integration/features/`. All integration test scenarios — extension lifecycle, tiling, gsettings, preferences UI, and AT-SPI tree — run via a single `behave` invocation.

Requires Podman + `glib2-devel` (`make dist` needs it). Container images are built per Fedora version. Test count: Behave steps across 5 feature files (extension_lifecycle, tiling, settings, preferences, atspi_tree).

### Devkit E2E tests (`test/e2e/`)

Local devkit-compositor tests that run on the host GNOME Shell:

```bash
make test-e2e                      # Local devkit compositor (host GNOME version)
```

Uses `gnome-shell --devkit --wayland --automation-script`. The `--devkit` flag **does** call `export async function run()` on the automation script. `run.py` (Python orchestrator) manages: isolated D-Bus → `dbus-daemon` → `gnome-shell --devkit` → extension install → wait for results JSON. Supports keyboard injection via `wtype` and screenshot via `gnome-screenshot`. 7 E2E tests (extension lifecycle, tiling geometry, keyboard shortcuts, Alt+F4 operations).

**Important**: `Shell.Eval` is broken system-wide (returns `(false, '')` for all expressions); D-Bus APIs (`org.gnome.Shell.Extensions.*`, `org.gnome.Shell.AnvilTest`) replace it everywhere.

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

### GJS automation-script API pitfalls

When writing scripts for `gnome-shell --automation-script`, remember:

- **Module-level code executes in both `--headless` and `--devkit`**, but `export async function run()` is only called by `--devkit`. For the container agent, use top-level promise chains.
- **`Gio.DBusConnection.register_object(path, iface, handler, userData, freeFunc)`** requires 5 args in GJS 1.88 (pass `null, null` for the last two).
- **`Gio.bus_own_name()`** creates a separate connection that can be GC'd — use `Gio.DBus.session` + `call_sync('RequestName')` + `register_object()` instead.
- **`GLib.Variant('(s)', value)`** for tuple types must wrap the string in an array: `['pong']` not `'pong'`. GJS 1.88 iterates a bare string, producing only the first character.
- **`Main.extensionManager.lookup(UUID).extWm`** can be `null` even when extension state is ACTIVE; use `global.__anvil_test_state.extWm` as the reliable fallback (requires `test-mode=true` set via `Gio.Settings` before extension enable).
- **`Gio.Settings({ schema_id })`** works inside automation scripts when `GSETTINGS_SCHEMA_DIR` env var points to the extension's schemas directory — set this in `start-session.sh` before launching gnome-shell.

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

Source in `src/lib/shared/*.ts` → tests in `test/unit/shared/*.test.ts`.
Source in `src/lib/extension/*.ts` → tests in `test/unit/extension/*.test.ts`.

## Test Architecture

```
test/
  unit/             # All vitest tests (hand-mocked GJS, no GNOME runtime)
    __mocks__/      # GJS/GNOME Shell mocks (gi://, resource://)
    mocks/helpers/  # Test fixtures (createMockWindow, createWindowManagerFixture)
    setup.js        # Vitest setup: mock global, log, etc.
    types/          # TypeScript declarations for test helpers
    css/            # CSS parser unit tests
    extension/      # Unit tests for src/lib/extension/ (WindowManager, Tree, etc.)
    shared/         # Unit tests for src/lib/shared/ (settings, logger, theme)
    window-operations.test.ts  # Mock integration test (vitest)
  e2e/              # Devkit-based E2E (gnome-shell --devkit --automation-script)
    run.py          # Python orchestrator: dbus-daemon → gnome-shell → wait for results
    runner.js       # ES module loaded by --automation-script; calls run()
    lib/            # Test framework & commands (describe/it/assert, launchApp, sendKeyCombo)
    suites/         # Test suites (extension, tiling, keyboard, operations)
  integration/      # Container-based integration (gnome-shell --headless --wayland)
    agent/agent.js  # D-Bus service inside gnome-shell (replaces Shell.Eval)
    run-tests.sh    # Runner: podman → install ext → wait for agent → run behave
    start-session.sh # Container entrypoint: D-Bus → mocks → gnome-shell
    set-env.sh      # Environment wrapper for all podman exec calls
    features/       # Behave BDD feature files and step definitions
      extension_lifecycle.feature  # Extension active/disabled state
      tiling.feature              # Tiling mode, layout settings, window open
      settings.feature            # All gsettings (gap, float, focus, effects)
      preferences.feature         # Preferences window UI (Dogtail/AT-SPI)
      atspi_tree.feature          # AT-SPI tree accessibility checks
      environment.py              # Behave hooks (screenshots on failure)
      steps/
        helpers.py      # Shared Python helpers (gsetting, D-Bus agent, Dogtail)
        agent_steps.py  # Step definitions for @agent-tagged features
        atspi_steps.py  # Step definitions for @atspi-tagged features
        preferences_steps.py  # Step definitions for @prefs-tagged features
```

## Key Conventions

- **Language**: TypeScript (not JavaScript). `tsc` compiles to JavaScript in `dist/`. The tsconfig uses `module: NodeNext, moduleResolution: NodeNext, target: ES2022`.
- **TypeScript strict mode**: Enabled (`strict: true`, `noImplicitAny: true`, `noImplicitThis: true`). One file uses `@ts-nocheck` (`src/lib/css/index.ts` — third-party CSS parser). All other source files are fully typed. See `TODO.md` for remaining `any` usage patterns.
- **GJS imports**: Source uses `gi://Gio`, `resource:///org/gnome/shell/...` paths. Unit tests remap these to `test/unit/__mocks__/` via vitest aliases. Type declarations come from `@girs/*` packages and `ambient.d.ts`.
- **Test globals**: `log`, `logError`, `print`, `global` are mocked in `test/unit/setup.js`.
- **ESLint**: Flat config (`eslint.config.js`) using `typescript-eslint` recommended rules. Test files have `vitest/no-focused-tests: error`. Third-party \`src/lib/css/index.ts\` has relaxed rules.
- **Prettier**: `printWidth: 100, tabWidth: 2` — wider than defaults.
- **Integration**: Uses GNOME Shell `--headless --wayland` in containers. No keyboard/pixel/drag-drop testing possible headless. All tests run via Behave BDD framework: D-Bus agent calls for extension state, gsettings for settings verification, and Dogtail/AT-SPI for preferences UI. Relies on a JS D-Bus agent (`test/integration/agent/agent.js`) loaded via `--automation-script` — NOT `Shell.Eval` (which is broken system-wide). See `test/integration/`.  
- **E2E**: Uses `gnome-shell --devkit --wayland` locally. Supports keyboard injection via `wtype` and screen capture via `gnome-screenshot`. Uses `export async function run()` in the automation script (devkit calls `run()`). See `test/e2e/`.
- **Container agent agent.js**: Uses module-level code (not `run()`), registers `org.gnome.Shell.AnvilTest` D-Bus service via `Gio.DBus.session` + `call_sync('RequestName')` + `register_object(path, iface, handler, null, null)`. All `GLib.Variant('(s)', ...)` calls must wrap strings in arrays.
- **`Shell.Eval` is dead**: Returns `(false, '')` for all expressions on this system. Never use it. D-Bus APIs (`org.gnome.Shell.Extensions.*`, `org.gnome.Shell.AnvilTest`) are the replacement.
- **Extension UUID**: `anvil@GenKerensky.github.com`
- **Install path**: `~/.local/share/gnome-shell/extensions/anvil@GenKerensky.github.com/`
- **Type declarations**: `ambient.d.ts` imports `@girs/gjs`, `@girs/gnome-shell/ambient`, `@girs/gnome-shell/extensions/global`. `gi://Shell` types in `test/unit/types/gi-shell.d.ts`.
- **Build output**: `dist/` is gitignored. `src/lib/prefs/metadata.js` is auto-generated during build and gitignored.
