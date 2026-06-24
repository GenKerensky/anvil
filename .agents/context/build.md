# Build Commands

```bash
make dev             # Build + install in dev mode (restart shell to load)
make build           # tsc → dist/ + copy static assets
make install         # Install dist/ → ~/.local/share/gnome-shell/extensions/
make dist            # Build → .zip artifact
make clean           # Remove dist/, src/schemas/gschemas.compiled, src/lib/prefs/metadata.js
npm run format       # Prettier (printWidth 100, tabWidth 2)
npm run build        # tsc only (compile TS → dist/)
npm run typecheck             # tsc --noEmit (src + unit + e2e + integration)
npm run typecheck:e2e         # E2E GJS files only
npm run typecheck:integration # integration GJS files only
npm run typecheck:all         # same as npm run typecheck
```

`make build` depends on: `clean` → `npm run build` (tsc) → `schemas` → `compilemsgs` → `metadata`.

Generated files: `src/lib/prefs/metadata.js` (from git log), `src/schemas/gschemas.compiled`,
`src/po/anvil.pot`, `*.mo`. Output directory: `dist/`.

## Test Commands (CI order)

```bash
npm run typecheck    # tsc --noEmit (4 tsconfigs)
npm run lint         # eslint . && prettier --check
npm run test:unit    # vitest run (~767 tests, no GNOME runtime)
npm run test:unit:watch

npm test             # typecheck → lint → unit → integration build → integration all
```

### Container integration tests

```bash
make test-integration              # Fedora 44 (default, GNOME 50)
make test-integration FEDORA_VERSION=43  # GNOME 49
make test-integration FEDORA_VERSION=42  # GNOME 48
make test-integration-all
```

`test/integration/runner.js` is loaded by `--automation-script`. Module-level promise chains (not
`export async function run()` — headless does not call `run()`). Sets `test-mode=true`, waits for
ACTIVE extension, bootstraps Jasmine from `/usr/share/jasmine-gjs/`, writes
`/tmp/anvil-jasmine-results.json`.

Requires Podman + `glib2-devel`. `jasmine-gjs` is built from source in the container image.

### Devkit E2E tests

```bash
make test-e2e    # Local devkit compositor (host GNOME version)
```

Uses `gnome-shell --devkit --wayland --automation-script`. `--devkit` **does** call
`export async function run()`.

**Important**: `Shell.Eval` is broken system-wide (returns `(false, '')` for all expressions). Use
D-Bus APIs (`org.gnome.Shell.Extensions.*`) and direct GJS API calls instead.

## Pre-commit Hook

Husky runs `lint-staged` then `npm run test:unit` on every commit. Commits are blocked if unit
tests fail.
