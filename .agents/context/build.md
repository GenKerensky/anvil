# Build Commands

```bash
make dev             # Build + install in dev mode (restart shell to load)
make build           # tsc → dist/ + copy static assets
make install         # Install dist/ → ~/.local/share/gnome-shell/extensions/
make dist            # Build → .zip artifact
make clean           # Remove dist/, src/schemas/gschemas.compiled, src/lib/prefs/metadata.js
npm run format       # Prettier (printWidth 100, tabWidth 2)
npm run build        # tsc only (compile TS → dist/)
npm run typecheck             # tsc --noEmit (src + unit + e2e)
npm run typecheck:e2e         # E2E GJS files only
npm run typecheck:all         # same as npm run typecheck
```

`make build` depends on: `clean` → `npm run build` (tsc) → `schemas` → `compilemsgs` → `metadata`.

Generated files: `src/lib/prefs/metadata.js` (from git log), `src/schemas/gschemas.compiled`,
`src/po/anvil.pot`, `*.mo`. Output directory: `dist/`.

## Test Commands (CI order)

```bash
npm run typecheck    # tsc project references (src, unit, e2e)
npm run lint         # eslint . && prettier --check
npm run test:unit    # vitest run (~832 tests, no GNOME runtime)
npm run test:unit:watch

npm test             # typecheck → lint → unit
```

### Host E2E tests

```bash
make test-e2e                              # Full suite (nightly / pre-release)
python3 test/e2e/run.py --tag resize       # PR smoke: filter by suite/spec substring
python3 test/e2e/run.py --tag focus        # PR smoke: focus suite
python3 test/e2e/run.py --no-build         # Skip make dist
```

CI runs unit only. Prefer `--tag` for PR-local E2E; full suite before release (D2-2).

`test/e2e/runner.js` is loaded by `--automation-script`. Exports `async function run()`
(called by gnome-shell). Sets `test-mode=true`, waits for ACTIVE extension with
`__anvil_test_state.extWm`, bootstraps Jasmine from `/usr/share/jasmine-gjs/`, writes
`/tmp/anvil-e2e-results.json`.

Requires host `gnome-shell` + `jasmine-gjs` + `glib2-devel`.

**Important**: `Shell.Eval` is broken system-wide (returns `(false, '')` for all expressions). Use
D-Bus APIs (`org.gnome.Shell.Extensions.*`) and direct GJS API calls instead.

## Pre-commit Hook

Husky runs `lint-staged` then `npm run test:unit` on every commit. Commits are blocked if unit
tests fail.
