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
npm run test:tooling      # deterministic stdlib Python tests; host smoke forced off
npm run test:tooling:host # build + opt-in live HeadlessShellSession smoke

npm test             # portable boundary → typecheck → lint → portable → unit → tooling
```

### Host E2E tests

```bash
distrobox enter fedora-devbox -- bash -lc \
  'cd /home/falco/code/anvil && make test-e2e'
distrobox enter fedora-devbox -- bash -lc \
  'cd /home/falco/code/anvil && make test-e2e-monitor-churn'
distrobox enter fedora-devbox -- bash -lc \
  'cd /home/falco/code/anvil && make test-e2e-preferences'
distrobox enter fedora-devbox -- bash -lc \
  'cd /home/falco/code/anvil && python3 test/e2e/run.py --engine core --tag resize'
distrobox enter fedora-devbox -- bash -lc \
  'cd /home/falco/code/anvil && python3 test/e2e/run.py --engine core --virtual-monitors 2 --tag monitor-churn'
distrobox enter fedora-devbox -- bash -lc \
  'cd /home/falco/code/anvil && python3 test/e2e/run.py --engine core --tag session-mode'
python3 test/e2e/run.py --tag focus        # Direct host smoke when dependencies exist
python3 test/e2e/run.py --no-build         # Skip make dist
```

CI runs the deterministic `npm test` gate only. Host tooling smoke and E2E remain local gates.
Prefer `--tag` for PR-local E2E; run the full E2E suite before release (D2-2).

The installed preferences, icon, Quick Settings, and stylesheet validation procedure is recorded
in `docs/testing/installed-package-smoke.md`.

`test/e2e/runner.js` is loaded by `--automation-script`. Exports `async function run()`
(called by gnome-shell). Sets `test-mode=true`, waits for ACTIVE extension with
`__anvil_test_state` and `__anvil_runtime`, bootstraps Jasmine from `/usr/share/jasmine-gjs/`, writes
`/tmp/anvil-e2e-results.json`.

Requires `gnome-shell` + `jasmine-gjs` + `glib2-devel`. The core-default Xwayland soak also requires
`xterm`; install it inside the mutable Devbox with `sudo dnf install -y xterm`. On Bazzite, the
Fedora Devbox command above is the normal E2E route; do not classify a missing immutable-host
`jasmine-gjs` as an E2E product failure.

`--virtual-monitors COUNT` creates one to four persistent 1920×1080 virtual outputs. The
`monitor-churn` suite registers only when `COUNT` is greater than one and the `monitor-churn` tag is
explicitly requested. `make test-e2e-monitor-churn` runs it in separate fresh Shell processes for
both legacy and core writers. Mutter 50.1 can segfault in its logical-monitor neighbor lookup when
mirror churn follows other window-moving suites in the same process; keep this suite isolated. Its
headless mirror transition still emits known Mutter background/monitor criticals, so a
physical-output session remains the final hotplug gate.

**Important**: `Shell.Eval` is broken system-wide (returns `(false, '')` for all expressions). Use
D-Bus APIs (`org.gnome.Shell.Extensions.*`) and direct GJS API calls instead.

## Pre-commit Hook

Husky runs `lint-staged` then `npm run test:unit` on every commit. Commits are blocked if unit
tests fail.
