# Testing Anvil

Anvil has portable unit and tooling tests, host-based GNOME Shell E2E tests, and an interactive devkit session for visual debugging.

## Portable validation

```bash
# Type-check, lint, and run the portable test suites.
npm test

# Individual layers.
npm run typecheck
npm run lint
npm run test:unit
npm run test:tooling
```

Unit tests run in Node.js with hand-written mocks for GJS and GNOME APIs. They cover the tiling state, layout algebra, window policy, preferences logic, theme parsing, and lifecycle helpers without starting GNOME Shell.

## GNOME Shell E2E

E2E tests start a real isolated GNOME Shell session with a virtual monitor and execute Jasmine suites through `gnome-shell --automation-script`.

Requirements include GNOME Shell with headless virtual-monitor support, `jasmine-gjs`, Python 3, and Nautilus. `python-dbusmock` is recommended. On Bazzite, use the mutable `fedora-devbox` environment described in the project build guidance.

```bash
# Full host E2E suite.
make test-e2e

# A focused suite by tag.
python3 test/e2e/run.py --tag resize

# Reuse an existing dist/ build.
python3 test/e2e/run.py --no-build --tag focus
```

Mouse drag-and-drop and pixel-level rendering still require interactive validation.

## Interactive devkit session

Use the devkit for visual regressions, pointer behavior, drag and drop, Looking Glass, and live Shell logs:

```bash
.agents/skills/gnome-shell-debug/scripts/run-devkit-session.sh
```

## Headless debug loop

The guarded debug loop is useful for repeatable behavioral reproductions:

```bash
.agents/skills/gnome-shell-debug/scripts/run-debug-loop.sh \
  --script test/debug/examples/minimal-repro.js --json --iteration 1
```

Raw local repro scripts belong in the ignored `test/debug/local/` directory.

## Installed package checks

Use the [installed-package smoke checklist](installed-package-smoke.md) for preferences, icons, Quick Settings, stylesheets, and clean payload replacement.
