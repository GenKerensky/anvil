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
distrobox enter fedora-devbox -- bash -lc \
  'cd /home/falco/code/anvil && make test-e2e'
distrobox enter fedora-devbox -- bash -lc \
  'cd /home/falco/code/anvil && python3 test/e2e/run.py --engine core --tag resize'
distrobox enter fedora-devbox -- bash -lc \
  'cd /home/falco/code/anvil && python3 test/e2e/run.py --engine core --virtual-monitors 2 --tag monitor-churn'
distrobox enter fedora-devbox -- bash -lc \
  'cd /home/falco/code/anvil && python3 test/e2e/run.py --engine core --tag session-mode'
python3 test/e2e/run.py --tag focus        # Direct host smoke when dependencies exist
python3 test/e2e/run.py --no-build         # Skip make dist
```

CI runs unit only. Prefer `--tag` for PR-local E2E; full suite before release (D2-2).

`test/e2e/runner.js` is loaded by `--automation-script`. Exports `async function run()`
(called by gnome-shell). Sets `test-mode=true`, waits for ACTIVE extension with
`__anvil_test_state.runtime`, bootstraps Jasmine from `/usr/share/jasmine-gjs/`, writes
`/tmp/anvil-e2e-results.json`.

Requires `gnome-shell` + `jasmine-gjs` + `glib2-devel`. The core-default Xwayland soak also requires
`xterm`; install it inside the mutable Devbox with `sudo dnf install -y xterm`. On Bazzite, the
Fedora Devbox command above is the normal E2E route; do not classify a missing immutable-host
`jasmine-gjs` as an E2E product failure.

`--virtual-monitors COUNT` creates one to four persistent 1920×1080 virtual outputs. The
`monitor-churn` suite registers only when `COUNT` is greater than one. Mutter 50.1's headless
mirror transition emits stale work-area assertions under both core and legacy writers when a live
window occupies the collapsing output; use the core invariant result as automated evidence and a
physical-output session for the final hotplug gate.

**Important**: `Shell.Eval` is broken system-wide (returns `(false, '')` for all expressions). Use
D-Bus APIs (`org.gnome.Shell.Extensions.*`) and direct GJS API calls instead.

## Pre-commit Hook

Husky runs `lint-staged` then `npm run test:unit` on every commit. Commits are blocked if unit
tests fail.
