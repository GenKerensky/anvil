# Changelog

All notable changes to this fork are documented here.

## Anvil — a fork of Forge

This project is a fork of [Forge](https://github.com/forge-ext/forge) by
Jose Maranan, adapted for GNOME 50+ with improved code quality, automated
testing, and ongoing maintainability.

### 2026 — Unreleased

#### Added

- **Spec filter for integration tests** — `SPEC=<name>` variable on
  `make test-integration` runs only matching spec files (exact filename match,
  `.js` extension optional). Supports comma-separated values
  (`SPEC=resize,keyboard`). Unknown spec names produce a warning log without
  crashing. Omit `SPEC` to run all 16 specs (backward compatible).

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
- **Test-mode setting** — `test-mode` gschema key enables `unsafe_mode` when
  set, allowing `org.gnome.Shell.Eval` D-Bus calls in ESM context.
- **`getTestState()`** — D-Bus-accessible method on extension for E2E
  assertions.
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
