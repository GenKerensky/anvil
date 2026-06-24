# Review

Comprehensive pre-submission checklist for getting the Anvil extension approved on [extensions.gnome.org](https://extensions.gnome.org). Based on the [GNOME Shell Extensions Review Guidelines](https://gjs.guide/extensions/review-guidelines/review-guidelines.html) and the [GNOME Shell development experience](https://lknuth.dev/writings/making_gnome_shell_extensions/).

## Quick Check

Run this single command to verify all automated checks:

```bash
npm test && make test-e2e-all
```

This runs: typecheck → lint → unit tests → E2E builds → E2E all. If it passes, proceed to the manual checklist below.

---

## Automated Checks (MUST pass)

### 1. Typecheck

```bash
npm run typecheck
# Runs: tsc --noEmit
```

- Config: `tsconfig.json` — `outDir: "./dist"`, `module: "NodeNext"`, `moduleResolution: "NodeNext"`, `target: "ES2022"`. `noEmit` is used as a CLI flag for `npm run typecheck` (`tsc --noEmit`). `noImplicitAny` and `noImplicitThis` are currently `false`.
- Type stubs for GJS APIs come from `@girs/*` packages (Adw, Clutter, Gdk, Gio, GLib, GObject, Gtk, Meta, St, gnome-shell).
- `gi://Shell` is mapped to a hand-written `.d.ts` in `test/unit/types/gi-shell.d.ts`.
- Failures here block submission — reviewers will reject extensions with broken type-level issues.

### 2. Lint

```bash
npm run lint
# Runs: eslint . && prettier --check "./**/*.{js,jsx,ts,tsx,json}"
```

- **ESLint**: Flat config (`eslint.config.js`), extends `@eslint/js/recommended` + `eslint-config-prettier`. Test files use `@vitest/eslint-plugin` with `vitest/no-focused-tests: error`.
- **Prettier**: `printWidth: 100, tabWidth: 2`. Run `npm run format` to auto-fix.
- Reviewers may reject extensions with messy or inconsistent code style.

### 3. Unit Tests + Coverage

```bash
npm run test:unit
# Runs: vitest run
```

- **Tests**: ~182 unit tests in `test/`. Covers tree data structures, window management logic, logger, color utilities, keybindings.
- **Mocks**: Hand-written mocks in `test/unit/__mocks__/` for all GJS/GNOME Shell APIs. Aliases wired in `vitest.config.js`.
- **Coverage threshold**: At least 75%. Add `vitest.config.js` coverage config if not already present:

```js
test: {
  coverage: {
    provider: "v8",
    include: ["src/lib/**/*.ts"],
    thresholds: {
      lines: 75,
      branches: 75,
      functions: 75,
      statements: 75,
    },
  },
}
```

Then run with:

```bash
npx vitest run --coverage
```

- **No tests allowed to fail** — the pre-commit hook (husky + lint-staged) blocks commits with failing unit tests.

### 4. E2E Tests (all Fedora/GNOME versions)

| Fedora | GNOME Shell | Status         |
| ------ | ----------- | -------------- |
| 44     | 50          | Primary target |
| 43     | 49          | Supported      |
| 42     | 48          | Supported      |

```bash
# All three versions (sequential):
make test-e2e-all

# Single version:
make test-e2e FEDORA_VERSION=44
make test-e2e FEDORA_VERSION=43
make test-e2e FEDORA_VERSION=42
```

**Prerequisites**: Podman + `glib2-devel` (`make dist` requires it). Container images built once per Fedora version:

```bash
make test-e2e-build-all
```

E2E tests cover:

- D-Bus API: extension enable/disable, error states
- GSettings: value read/write, layout mode toggles, window effects
- AT-SPI: preferences dialog widget tree, role names, switch states, tab navigation

Tests that must pass: Behave scenarios in `test/integration/features/` (extension lifecycle, tiling, settings, AT-SPI tree, preferences) via `make test-integration`.

### 5. Build

```bash
make build   # Build → dist/
make dist    # Build → .zip artifact
```

The `.zip` is what gets uploaded to extensions.gnome.org. Verify:

- `metadata.json` is present and well-formed
- No unnecessary files (build scripts, `.po`, `.pot` files — see below)
- All translated `.mo` files are staged under `locale/<lang>/LC_MESSAGES/anvil.mo`

---

## GNOME Review Guidelines — Manual Checklist

Go through each item. Every **MUST** rule is a hard requirement for approval.

### Lifecycle Rules

- [ ] **No objects/signals/sources in `constructor()`** — only static data (plain objects, Maps, etc.). GObjects like `Gio.Settings`, `St.Widget` are disallowed in the constructor. See `src/extension.ts`.
- [ ] **All objects destroyed in `disable()`** — every widget, GObject, or resource created in `enable()` must be destroyed in `disable()`.
- [ ] **All signal connections disconnected in `disable()`** — store handler IDs from `connect()` and call `disconnect(id)`.
- [ ] **All main loop sources removed in `disable()`** — every `GLib.timeout_add()` / `GLib.idle_add()` must have its source ID removed via `GLib.Source.remove()`, even if the callback returns `GLib.SOURCE_REMOVE`.

### Import Rules

- [ ] **No `Gdk`, `Gtk`, or `Adw` in the extension process** — `src/extension.ts` and files under `src/lib/extension/` must NOT import GTK libraries. They belong only in `src/prefs.ts` and `src/lib/prefs/`.
- [ ] **No `Clutter`, `Meta`, `St`, or `Shell` in the preferences process** — `src/prefs.ts` and files under `src/lib/prefs/` must NOT import Shell/Clutter libraries.
- [ ] **No deprecated modules** — no `ByteArray`, `Lang`, or `Mainloop`. Use `TextDecoder`/`TextEncoder`, ES6 classes, and `GLib.timeout_add()` instead.

### Code Quality

- [ ] **No obfuscated or minified code** — all JavaScript must be readable and reviewable. TypeScript must be transpiled to well-formatted JS. Anvil uses TypeScript (compiled to JS at build time), so this is inherently satisfied.
- [ ] **No AI-generated code** — reviewers check for unnecessary code, imaginary APIs, inconsistent style, LLM-prompt comments. The developer must be able to explain all code.
- [ ] **No excessive logging** — `console.debug()`/`console.warn()` only for important messages. Reviewers reject extensions that spam the journal. Anvil's logger is in `src/lib/shared/logger.ts`.

### GObject Safety

- [ ] **No forced `run_dispose()`** — calling `GObject.Object.run_dispose()` requires a comment explaining the real-world scenario that makes it necessary. Check for any such calls.

### metadata.json

- [ ] **`name` is unique** — "Anvil" does not conflict with existing extensions.
- [ ] **`uuid` format** — `anvil@GenKerensky.github.com` uses valid characters (letters, numbers, period, underscore, dash) and a non-`gnome.org` namespace.
- [ ] **`description` is reasonable** — "Tiling and window manager for GNOME" is concise.
- [ ] **`shell-version` only contains stable releases** — `["45","46","47","48","49","50","50.1"]` — all are released versions. No future versions claimed.
- [ ] **`session-modes`** — `["user", "unlock-dialog"]` is present. The `unlock-dialog` mode requires: (a) it's necessary for operation, (b) keyboard signals disconnected in unlock mode, (c) a comment in `disable()` explaining why.
- [ ] **`url` points to a repository** — `https://github.com/GenKerensky/anvil` is valid.
- [ ] **No `donations` key unless used** — not present in Anvil's metadata.json: ok.

### GSettings Schema

- [ ] **Schema ID uses `org.gnome.shell.extensions` base** — `org.gnome.shell.extensions.anvil` ✓
- [ ] **Schema path uses `/org/gnome/shell/extensions` base** — `/org/gnome/shell/extensions/anvil/` ✓
- [ ] **Schema XML included in ZIP** — checked via `src/schemas/org.gnome.shell.extensions.anvil.gschema.xml`
- [ ] **XML filename matches pattern** — `<schema-id>.gschema.xml` ✓

### Zip File Contents

The `.zip` built by `make dist` should NOT include:

- [ ] Build scripts (Makefile, scripts in `test/`)
- [ ] `.po` and `.pot` files (only compiled `.mo` files are needed)
- [ ] Unused icons, images, or media
- [ ] Node_modules, `.git` directory, or other tooling artifacts

To inspect the zip:

```bash
make dist
unzip -l anvil@GenKerensky.github.com.zip
```

### Legal

- [ ] **License is GPL-compatible** — Anvil is `GPL-3.0-or-later` (see `package.json:35`). GNOME Shell is `GPL-2.0-or-later`. Compatible.
- [ ] **Attribution for derived code** — Anvil is a fork of Forge by Jose Maranan. Attribution must be in the distributed files. Check the license header in `src/extension.ts`, `src/prefs.ts`, and source files.
- [ ] **No copyrighted/trademarked content without permission** — no brand logos, proprietary artwork, etc.
- [ ] **No Code of Conduct violations** — name, description, icons, screenshots must comply with [GNOME CoC](https://conduct.gnome.org).

### Additional Restrictions

- [ ] **No telemetry** — no analytics, no tracking, no data sharing.
- [ ] **No external binaries** — the extension must not ship binary executables or libraries.
- [ ] **No clipboard access without declaration** — if accessing clipboard, declare it in the description.
- [ ] **No interference with other extensions** — the extension system should not be modified, reloaded, or interfered with.

---

## Extension-Specific Checks

### Anvil Lifecycle Audit

Check `src/extension.ts` constructor vs `enable()` vs `disable()`:

- Constructor: only `super(metadata)` and static data setup.
- `enable()`: creates `Keybindings`, `WindowManager`, `FeatureIndicator`, `FeatureMenuToggle`, `ExtensionThemeManager`, connects signals, registers with `Main.panel`.
- `disable()`: destroys all objects, disconnects all signals, removes main loop sources.

Run this check manually by reading `dist/extension.js` (the built output) and verifying the pattern holds.

### Preferences Window Audit

- `src/prefs.ts` fills the preferences window without importing Shell/Clutter/Meta/St.
- All pages import `gettext as _` from the correct prefs-side path: `resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js`.

### Translations

- `metadata.json` declares `"gettext-domain": "anvil"`.
- All user-visible strings in source files are wrapped in `_()`.
- `.mo` files are compiled and staged in `locale/<lang>/LC_MESSAGES/anvil.mo`.
- See the `translations` skill for complete details.

### Keybindings

- All keybindings registered in `src/lib/extension/keybindings.ts` must be disabled in `disable()`.
- GSettings keybinding schema: `org.gnome.shell.extensions.anvil.keybindings`.

### Window Overrides Config

- `ConfigManager` in `src/lib/shared/settings.ts` manages `$HOME/.config/anvil/config/windows.json`.
- File access must use Gio (not Node.js `fs`), as is already done.
- No hardcoded paths that would fail in sandboxed environments.

---

## Testing in a Real Environment

Before submission, test the built extension in a live GNOME Shell session (not just headless E2E):

```bash
make dev              # Build and install for dev
# Restart GNOME Shell (X11: Alt+F2 → restart, Wayland: log out/in)
```

Verify:

- [ ] Extension appears in GNOME Extensions app
- [ ] Enable/disable works without errors in `journalctl -f -o cat /usr/bin/gnome-shell`
- [ ] Preferences window opens and all settings work
- [ ] Keybindings function correctly
- [ ] Tiling, floating, and stacking layouts all work
- [ ] No crashes on screen lock/unlock

---

## Final Submission Checklist

Summarizing everything that must pass before uploading to extensions.gnome.org:

1. [ ] `npm test` passes (typecheck + lint + unit)
2. [ ] Unit test coverage ≥ 75%
3. [ ] `make test-e2e-all` passes (Fedora 44, 43, 42)
4. [ ] `make dist` produces a clean `.zip`
5. [ ] `.zip` contains no unnecessary files (inspect with `unzip -l`)
6. [ ] `metadata.json` passes all MUST rules
7. [ ] Lifecycle rules (constructor/enable/disable) verified
8. [ ] Import rules verified (no cross-process imports)
9. [ ] No deprecated modules
10. [ ] Attribution present for forked code
11. [ ] License is GPL-3.0-or-later (compatible)
12. [ ] Manually tested in a live GNOME Shell session
13. [ ] No excessive logging
14. [ ] No telemetry or external binaries
