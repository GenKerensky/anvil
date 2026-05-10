# AGENTS.md

## Overview

Anvil is a GNOME Shell tiling extension (fork of Forge). It runs inside **GJS** (GNOME's JS runtime), not Node.js. Source is **TypeScript**, compiled to JavaScript via `tsc` into the `dist/` directory. Unit tests run in Node.js via vitest with hand-written mocks for all GJS/GNOME APIs.

## GNOME Shell Runtime Model

### Process separation

| File | Process | Available APIs | Unavailable |
|------|---------|---------------|-------------|
| `extension.ts` | gnome-shell | Clutter, St, Meta, Shell, `global`, Gio, GLib | Gtk |
| `prefs.ts` | isolated Gtk | Gtk4, Adwaita, Gio, GLib | Clutter, St, Meta, Shell, `global` |
| `stylesheet.css` | Shell UI only | — | Does NOT apply to prefs window |

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
make clean           # Remove dist/, schemas/gschemas.compiled, metadata.js
npm run format       # Prettier (printWidth 100, tabWidth 2)
npm run build        # tsc only (compile TS → dist/)
npm run typecheck    # tsc --noEmit (type checking without emitting)
```

`make build` depends on: `clean` → `npm run build` (tsc) → `schemas` → `compilemsgs` → `metadata`. Generated files: `lib/prefs/metadata.js` (from git log), `schemas/gschemas.compiled`, `po/anvil.pot`, `*.mo`. Output directory: `dist/`.

## Test Commands (run in this order)

```bash
npm run typecheck    # tsc --noEmit
npm run lint         # eslint . && prettier --check
npm run test:unit    # vitest run (~182 tests, no GNOME runtime needed)
npm run test:watch   # vitest watch mode

# Full pipeline (CI order):
npm test             # typecheck → lint → unit → e2e build → e2e all
```

E2E tests require Podman + `glib2-devel` (`make dist` needs it). Container images are built per Fedora version:

```bash
make test-e2e              # Fedora 44 (default, GNOME 50)
make test-e2e FEDORA_VERSION=43  # GNOME 49
make test-e2e FEDORA_VERSION=42  # GNOME 48
make test-e2e-all          # All three versions
```

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

For `.ts` test file changes, `npm run test:unit` must also pass.

For E2E test changes (`test/e2e/`), `npm run test:e2e` must pass against at least Fedora 44 (default).

## Architecture

```
extension.ts          # Entry point loaded by GNOME Shell
prefs.ts              # Preferences window entry point
lib/
  extension/          # Core tiling: tree, windows, keybindings, utils, theme
  shared/             # Shared between extension + prefs: logger, settings, theme
  prefs/              # Preferences UI (metadata.js is gitignored + auto-generated)
  css/                # CSS parsing (@ts-nocheck — third-party library)
config/windows.json   # Default window override config
```

Source in `lib/shared/*.ts` → tests in `test/shared/*.test.ts`.
Source in `lib/extension/*.ts` → tests in `test/extension/*.test.ts`.

## Key Conventions

- **Language**: TypeScript (not JavaScript). `tsc` compiles to JavaScript in `dist/`. The tsconfig uses `module: NodeNext, moduleResolution: NodeNext, target: ES2022`.
- **TypeScript strict mode**: Not yet enabled (`noImplicitAny: false, noImplicitThis: false`). Seven files use `@ts-nocheck` due to GObject property patterns (`window.ts`, `tree.ts`, `keybindings.ts`, `indicator.ts`, `theme.ts`, `floating.ts`, `extension-theme-manager.ts`). A follow-up pass will remove these and enable strict mode (see `TODO.md`).
- **GJS imports**: Source uses `gi://Gio`, `resource:///org/gnome/shell/...` paths. Unit tests remap these to `test/__mocks__/` via vitest aliases. Type declarations come from `@girs/*` packages and `ambient.d.ts`.
- **Test globals**: `log`, `logError`, `print`, `global` are mocked in `test/setup.js`.
- **ESLint**: Flat config (`eslint.config.js`) using `typescript-eslint` recommended rules. Test files have `vitest/no-focused-tests: error`. Third-party `lib/css/index.ts` has relaxed rules.
- **Prettier**: `printWidth: 100, tabWidth: 2` — wider than defaults.
- **E2E**: Uses GNOME Shell `--headless --wayland` (not `--nested` which was removed in GNOME 50). No keyboard/pixel/drag-drop testing possible headless. D-Bus, gsettings, and Dogtail/AT-SPI only.
- **Extension UUID**: `anvil@GenKerensky.github.com`
- **Install path**: `~/.local/share/gnome-shell/extensions/anvil@GenKerensky.github.com/`
- **Type declarations**: `ambient.d.ts` imports `@girs/gjs`, `@girs/gnome-shell/ambient`, `@girs/gnome-shell/extensions/global`. `gi://Shell` types in `test/types/gi-shell.d.ts`.
- **Build output**: `dist/` is gitignored. `lib/prefs/metadata.js` is auto-generated during build and gitignored.
