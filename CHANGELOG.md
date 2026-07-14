# Changelog

All notable changes to this fork are documented here.

## Anvil — a fork of Forge

This project is a fork of [Forge](https://github.com/forge-ext/forge) by
Jose Maranan, adapted for GNOME 50+ with improved code quality, automated
testing, and ongoing maintainability.

### 2026 — Unreleased

#### Changed

- **Consolidated real-shell tests into host E2E** — Removed Podman container
  integration tests (`test/integration/`, multi-Fedora CI matrix). Unique
  behavioral suites (focus, swap, move, floating, layouts, workspace, borders,
  minimize, constraints, richer lifecycle/tiling) now live under
  `test/e2e/suites/`. Canonical command: `make test-e2e`. Requires host
  `jasmine-gjs`. CI remains unit-only; E2E is a local/pre-release gate.
- **Conditional-wait helpers in shared-commands.js** — Polling helpers for
  reliable window operations in headless tests: `waitForWindowCount`,
  `waitForGeometry`, `waitForFocusChange`, `waitForFocusWindow`,
  `getFocusedWindowId`.
- **Window-ID-based focus detection** — E2E suites use
  `getFocusedWindowId()` instead of titles for focus assertions.
- **Reduced resize settle delay** — `COMMAND_DELAY` lowered from 600ms to
  250ms across all resize tests, speeding up the 74 data-driven resize tests
  while maintaining reliability via conditional-wait polling.
- **Fixed Jasmine timeout configuration in runner.js** — Uses
  `jasmine.DEFAULT_TIMEOUT_INTERVAL = 15000` correctly as a global property,
  ensuring the configured 15s timeout actually applies to all specs.

#### Fixed

- **Unsafe mode ownership** — Test mode no longer sets GNOME Shell's global
  `context.unsafe_mode`; automation continues through direct in-process GJS APIs.
- **4-window focus cycle test navigation** — The 4-window focus test now
  uses a proper 2×2 grid navigation cycle (Right → Down → Left → Up)
  instead of an incorrect linear pattern, ensuring all four directions are
  exercised and at least 2 distinct windows are visited.

### 2026 — Anvil 1.0.0

#### Added

- **GNOME 50 compatibility** — Updated all GIRS type packages, D-Bus API
  calls, and import paths for GNOME Shell 50+.
- **ESM support** — Replaced `imports.byteArray.toString()` with
  `new TextDecoder().decode()` throughout (`lib/shared/settings.js`,
  `lib/shared/theme.js`). GNOME 50 runs JS in strict ESM context.
- **Unit test suite** — 182 tests covering utility functions, tiling tree
  structure, color conversion, and logger. Runs under vitest with
  hand-written GJS mocks.
- **E2E test suite** — 12 tests running a headless GNOME Shell session in a
  Podman container; tests lifecycle, tiling, settings, disable/re-enable,
  and preferences dialog.
- **Test-mode setting** — `test-mode` gschema key exposes a narrow in-process
  automation probe without enabling GNOME Shell unsafe mode.
- **`getTestState()`** — In-process test-probe method for E2E assertions.
- **TypeScript type checking** — Added `tsconfig.json` with GNOME 50 GIRS
  type definitions; JSDoc type annotations added throughout.
- **ESLint** — Added eslint flat config with Prettier integration.
- **Containerized testing** — `Containerfile`, `build-container.sh`,
  `run-tests.sh`, and `tests.sh` for reproducible CI testing on Fedora
  42/43/44.
- **Border radius setting** — Added border radius control to appearance
  preferences.

#### Changed

- **Renamed from Forge to Anvil** — All user-facing strings, D-Bus paths,
  GSettings schemas, config directories, and extension UUID updated.
- **Libadwaita preferences** — Updated preferences to use Adw widgets
  (GNOME 50 requirement).
- **CSS parser attribution** — Restored full MIT license notice for
  reworkcss/css code (`lib/css/index.js`).
- **Test runner uses D-Bus API** — Replaced `Shell.Eval` calls with
  `org.gnome.Shell.Extensions.GetExtensionInfo` D-Bus methods (required
  under ESM).
- **`prefs.js` constructor** — Changed from `...args` rest param to single
  `args` to match updated GJS API.
- **About dialog** — Updated name/icon; URL defaults to app homepage.

#### Fixed

- **`Makefile` metadata generation** — Added `@type` JSDoc annotation to
  pass `tsc --noEmit` when the commit list is empty.
- **Various null-safety guards** — Added optional chaining and null checks
  in window manager, tree, config manager, and theme code.
- **`for...in` → indexed `for`** in `RGBAToHexA` (`lib/shared/theme.js`).
- **`hexAToRGBA` return types** — Explicit `Number()` coercion instead of
  relying on unary `+` string coercion.
- **`Gtk.accelerator_valid` null safety** — Default `mods ?? 0` in keyboard
  prefs.
- **Tab/decoration cleanup** — Removed stale `null` assignments after
  removing children from window group.
- **`GrabOp.RESIZING_UNKNOWN` → `KEYBOARD_RESIZING_UNKNOWN`** — Updated
  for GNOME 50 enum rename.
- **`COMPOSITOR` grab op removed** from DND tiling trigger — GNOME 50
  overview handles this separately.
- **Removed unused Gtk import** in `floating.js`.

#### Removed

- **`schemas/org.gnome.shell.extensions.forge.gschema.xml`** — Replaced by
  `org.gnome.shell.extensions.anvil.gschema.xml`.
- **Old TSGiRS type deps** — Replaced `@girs/clutter-12`, `@girs/meta-12`,
  `@girs/st-12` with `-18` variants for GNOME 50.

### Upstream Forge

See https://github.com/forge-ext/forge for upstream history.
