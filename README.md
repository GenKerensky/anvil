# Anvil

> **Anvil** is a fork of [Forge](https://github.com/forge-ext/forge) by [Jose Maranan](https://github.com/jmmaranan), licensed under GPL v3. The original project and all its contributors are gratefully credited — see the Credits section below.

## Features

- Works on GNOME 45 through 50.1. X11 and Wayland
- Tree-based tiling with vertical and horizontal split containers similar to i3-wm and sway-wm
- Vim-like keybindings for navigation/swapping windows/moving windows in the containers
- Drag and drop tiling
- Support for floating windows, smart gaps and focus hint
- Customizable shortcuts in extension preferences
- Some support for multi-display
- Tiling support per workspace
- Update hint color scheme from preferences
- Stacked tiling layout
- Swap current window with the last active window
- Auto Split or Quarter Tiling
- Show/hide tab decoration via keybinding https://github.com/forge-ext/forge/issues/180
- Window resize using keyboard shortcuts

## Known Issues / Limitations

- Does not support dynamic workspaces
- Does not support vertical monitor setup

## Installation

Direct installation of Anvil requires building from source for now. The upstream Forge
packages listed below are for the original Forge extension and are provided for reference:

- Build Anvil yourself via `make install` or `make dev`.
- Upstream Forge: [GNOME extensions website](https://extensions.gnome.org/extension/4481/forge/) _(Forge, not Anvil)_
- Upstream Forge: [AUR Package](https://aur.archlinux.org/packages/gnome-shell-extension-forge) — thanks to [@Radeox](https://github.com/Radeox) _(Forge, not Anvil)_
- Upstream Forge: [Fedora Package](https://packages.fedoraproject.org/pkgs/gnome-shell-extension-forge/gnome-shell-extension-forge/) — thanks to [@carlwgeorge](https://github.com/carlwgeorge) _(Forge, not Anvil)_

![image](https://user-images.githubusercontent.com/348125/146386593-8f53ea8b-2cf3-4d44-a613-bbcaf89f9d4a.png)

## Anvil Keybinding Defaults

See the acceptable key combinations on the [wiki](https://github.com/forge-ext/forge/wiki/Keyboard-Shortcuts)

| Action                                                         | Shortcut                                          |
| -------------------------------------------------------------- | ------------------------------------------------- |
| Increase active window size left                               | `<Ctrl> + <Super> + y`                            |
| Decrease active window size left                               | `<Ctrl> + <Shift> + <Super> + o`                  |
| Increase active window size bottom                             | `<Ctrl> + <Super> + u`                            |
| Decrease active window size bottom                             | `<Ctrl> + <Shift> + <Super> + i`                  |
| Increase active window size top                                | `<Ctrl> + <Super> + i`                            |
| Decrease active window size top                                | `<Ctrl> + <Shift> + <Super> + u`                  |
| Increase active window size right                              | `<Ctrl> + <Super> + o`                            |
| Decrease active window size right                              | `<Ctrl> + <Shift> + <Super> + y`                  |
| Open preferences                                               | `<Super> + period`                                |
| Toggle tiling mode                                             | `<Super> + w`                                     |
| Focus left                                                     | `<Super> + h`                                     |
| Focus right                                                    | `<Super> + l`                                     |
| Focus up                                                       | `<Super> + k`                                     |
| Focus down                                                     | `<Super> + j`                                     |
| Swap current window with last active                           | `<Super> + Return`                                |
| Swap active window left                                        | `<Ctrl> + <Super> + h`                            |
| Swap active window right                                       | `<Ctrl> + <Super> + l`                            |
| Swap active window up                                          | `<Ctrl> + <Super> + k`                            |
| Swap active window down                                        | `<Ctrl> + <Super> + j`                            |
| Move active window left                                        | `<Shift> + <Super> + h`                           |
| Move active window right                                       | `<Shift> + <Super> + l`                           |
| Move active window up                                          | `<Shift> + <Super> + k`                           |
| Move active window down                                        | `<Shift> + <Super> + j`                           |
| Split container horizontally                                   | `<Super> + z`                                     |
| Split container vertically                                     | `<Super> + v`                                     |
| Toggle split container                                         | `<Super> + g`                                     |
| Gap increase                                                   | `<Ctrl> + <Super> + Plus`                         |
| Gap decrease                                                   | `<Ctrl> + <Super> + Minus`                        |
| Toggle focus hint                                              | `<Super> + x`                                     |
| Toggle active workspace tiling                                 | `<Shift> + <Super> + w`                           |
| Toggle stacked layout                                          | `<Shift> + <Super> + s`                           |
| Toggle tabbed layout                                           | `<Shift> + <Super> + t`                           |
| Show/hide tab decoration                                       | `<Ctrl> + <Alt> + y`                              |
| Activate tile drag-drop                                        | `Start dragging - Mod key configuration in prefs` |
| Snap active window left two thirds                             | `<Ctrl> + <Alt> + e`                              |
| Snap active window right two thirds                            | `<Ctrl> + <Alt> + t`                              |
| Snap active window left third                                  | `<Ctrl> + <Alt> + d`                              |
| Snap active window right third                                 | `<Ctrl> + <Alt> + g`                              |
| Persist toggle floating for active window                      | `<Super> + c`                                     |
| Persist toggle floating for active window and its window class | `<Super><Shift> + c`                              |

For any shortcut conflicts, the user has to manually configure those for now from the
`GNOME Control Center > Keyboard > Customize Shortcuts`. https://github.com/forge-ext/forge/issues/37

## Anvil Override Paths

- Window Overrides: `$HOME/.config/anvil/config/windows.json`
- Stylesheet Overrides: `$HOME/.config/anvil/stylesheet/anvil/stylesheet.css`

## GNOME Defaults

GNOME Shell has built in support for workspace management and seems to work well - so Anvil will not touch those.

User is encouraged to bind the following:

- Switching/moving windows to different workspaces
- Switching to numbered, previous or next workspace

## Development

- The `main` branch contains gnome-4x code.
- The `legacy` and `gnome-3-36` are the same and is now the source for gnome-3x.

## Testing

Anvil has three levels of automated tests: **unit tests** (fast, no GNOME runtime needed),
**integration tests** (full GNOME Shell session in a Podman container), and
**E2E tests** (local headless compositor). For agent-driven debugging of behavioral and
layout bugs, use the **agent debug loop** (headless, JSON artifacts) — see below.

### Unit Tests

Unit tests cover pure logic — utility functions, the tiling tree data structure, color
conversion, and the logger. They run entirely in Node.js via [vitest](https://vitest.dev)
with hand-written mocks for all GJS/GNOME APIs.

**Prerequisites:** Node.js 16+, `npm install`

```bash
# Run unit tests once
npm run test:unit

# Run unit tests in watch mode (re-runs on file save)
npm run test:unit:watch

# Run lint + unit tests together
npm test
```

### Integration Tests (Container)

Integration tests run a real GNOME Shell session inside a [Podman](https://podman.io)
container using `gnome-shell --headless --wayland` — the correct headless mode for
GNOME 50, which removed the `--nested` flag. This brings up a complete Wayland compositor
with a virtual framebuffer; no Xvfb, no DRM device, and no real GPU are required.
D-Bus system services are provided by
[python-dbusmock](https://github.com/martinpitt/python-dbusmock) stubs, matching the
approach used by GNOME Shell's own GitLab CI.

Tests are written as **Jasmine** specs that run inside gnome-shell via
`--automation-script`. The runner (`runner.js`) bootstraps Jasmine from the
system-installed `jasmine-gjs` package, imports all spec files, executes them, and
writes results as JSON.

Before running specs, the runner performs **D-Bus pre-activation** — it polls for the
`org.gnome.Shell.Extensions` service (15s timeout), preventing race conditions in
preferences tests that depend on that D-Bus path. If the service is unavailable, the
runner records a cascade failure and downstream specs can gracefully skip via
`global.__anvil_skipIfFailed(prereq, reason)`.

Specs cover: extension lifecycle, tiling geometry, keyboard shortcuts, window operations,
resize clamping, monitor constraints, GSettings, preferences UI (via `gi://Atspi`), and
tiling layouts — approximately 115+ data-driven tests.

All tests import shared GJS helpers from `test/lib/shared-commands.js`, which provides
reliable async utilities for launching apps, polling window state, and simulating
Anvil keyboard shortcuts. Key polling helpers include `getFocusedWindowId()`,
`waitForWindowCount()`, `waitForGeometry()`, `waitForFocusChange()`, and
`waitForFocusWindow()` — these use GLib timeout-based polling to handle the
inherently asynchronous nature of Wayland window management in headless mode.
Focus detection uses stable **window IDs** (`Meta.Window.get_id()`) rather than
titles, eliminating title-collision flakiness when multiple windows share the
same application title.

**What is NOT testable headless:**

- Mouse drag-and-drop (no pointer device)
- Pixel-level visual rendering (no GPU framebuffer)

### Agent Debug Loop (headless)

For tight repro → log analysis → code edit cycles (especially behavioral and layout bugs),
the **Agent Loop** launches an isolated headless GNOME Shell session with guardrails so your
real session is never touched. One invocation = one iteration; the agent (or you) owns the
outer loop.

**Prerequisites:** `gnome-shell` with `--headless` and `--virtual-monitor` (GNOME 49+),
`python3`, `dbusmock` (recommended — same as integration/E2E), built `dist/` (`make build debug`)

```bash
# First iteration (builds dist/)
.agents/skills/gnome-shell-debug/scripts/run-debug-loop.sh \
  --script test/debug/examples/minimal-repro.js --json --iteration 1

# Later iterations — session dir persists by default
SESSION_DIR=$(jq -r .session.dir iteration-001.json)
.agents/skills/gnome-shell-debug/scripts/run-debug-loop.sh \
  --no-build --session-dir "$SESSION_DIR" \
  --script test/debug/local/my-repro.js --json --iteration 2
```

Copy `repro-template.js` to `test/debug/local/` for local repro scripts (gitignored).
Human visual debugging (flicker, Looking Glass) uses the devkit launcher instead:

```bash
.agents/skills/gnome-shell-debug/scripts/run-devkit-session.sh
```

**Library tests** (guardrails, log analysis, session smoke — no full loop required):

```bash
make test-debug-loop-lib
```

Full documentation: `.agents/skills/gnome-shell-debug/SKILL.md` (v3.0).

**Prerequisites:**

- [Podman](https://podman.io/docs/installation) installed
- `glib2-devel` installed (`sudo dnf install glib2-devel`, for `make dist`)

**Supported GNOME Shell versions:**

| Fedora | GNOME Shell | Status       |
| ------ | ----------- | ------------ |
| 44     | 50          | ✅ Primary   |
| 43     | 49          | ✅ Supported |
| 42     | 48          | ✅ Supported |

**Step 1: Build the container image** (one-time, per Fedora version)

```bash
# Build for Fedora 44 (GNOME 50) — the primary target
./test/integration/build-container.sh 44

# Or build for all supported versions
make test-integration-build-all
```

#### Step 2: Run the tests

```bash
# Run against Fedora 44 (default)
make test-integration

# Run against a specific Fedora version
make test-integration FEDORA_VERSION=43

# Run against all supported versions (parallel)
make test-integration-all
```

#### Step 3: Run a subset of spec files

Use `SPEC=<name>` to run only specific spec(s) by exact filename match (`.js` extension
is optional). Supports comma-separated values:

```bash
# Run only resize tests
make test-integration SPEC=resize

# Run multiple specs
make test-integration SPEC=resize,keyboard

# Run with a specific Fedora version
make test-integration FEDORA_VERSION=43 SPEC=constraints
```

When `SPEC` is unset, all 16 spec files run (backward compatible). Unknown spec names
produce a warning in the GNOME Shell log without causing test failure.

**Available spec names:** `extension-lifecycle`, `tiling`, `keyboard`, `focus`, `swap`,
`move`, `operations`, `resize`, `constraints`, `layouts`, `floating`, `workspace`,
`borders`, `minimize`, `settings`, `preferences`

**Debugging a failed test:**

On failure, the test runner saves the full GNOME Shell **journal log** to
`test/integration/output/journal.log`.

Use `-k` to keep the container running for manual inspection:

```bash
python3 test/integration/run.py -v 44 -k
# Container is left running — connect to it for debugging:
podman exec -it --user gnomeshell <container-id> set-env.sh bash
```

#### Test structure

```text
test/
├── lib/
│   ├── shared-commands.js       # Shared GJS helpers (E2E + integration + debug loop)
│   ├── shell_session.py         # HeadlessShellSession (E2E parity + agent loop)
│   ├── host_guard.py            # Host-session guardrails for debug loop
│   └── log_analysis.py          # Anvil log signatures for debug loop
├── debug/
│   ├── examples/                # Checked-in repro scripts (e.g. minimal-repro.js)
│   └── local/                   # Gitignored local repro scripts
└── integration/
    ├── run.py                   # Python orchestrator (container lifecycle, results polling)
    ├── runner.js                # Jasmine automation-script loaded by gnome-shell
    ├── start-session.sh         # Session D-Bus + dbusmock + gnome-shell --headless
    ├── set-env.sh               # Environment wrapper for podman exec commands
    ├── build-container.sh       # Build container image for a Fedora version
    ├── run-all.py               # Runs all Fedora versions in parallel
    ├── specs/                   # Jasmine spec files (GJS ES modules)
    │   ├── extension-lifecycle.js
    │   ├── tiling.js
    │   ├── keyboard.js
    │   ├── focus.js
    │   ├── swap.js
    │   ├── move.js
    │   ├── operations.js
    │   ├── resize.js
    │   ├── constraints.js
    │   ├── layouts.js
    │   ├── floating.js
    │   ├── workspace.js
    │   ├── borders.js
    │   ├── minimize.js
    │   ├── settings.js
    │   └── preferences.js
    └── output/                  # Test artifacts (journal, screenshots, results JSON)
```

### E2E Tests (Headless)

E2E tests run on the host using `gnome-shell --headless --wayland --virtual-monitor`
with an isolated session bus. They use the same Jasmine automation-script pattern as
integration tests.

```bash
# Run E2E tests
make test-e2e
```

E2E specs live in `test/e2e/suites/` and cover extension lifecycle, tiling geometry,
keyboard shortcuts, and window operations. For interactive visual debugging, use
`run-devkit-session.sh` (see Agent Debug Loop section above).

## Local Development Setup

- Install NodeJS 16+
- Install `gettext`
- Run `npm install`
- Commands:

```bash
# Compile and override the gnome-shell update repo
make dev

# Or run below, and restart the shell manually
make build && make debug && make install

# X11 - build from source and restarts gnome-shell
make test-x

# Wayland - build from source and starts a wayland instance (no restart)
make test-wayland

# Formatting, when you do npm install,
# husky gets installed should force prettier formatting during commit

npm run format
```

## Contributing

- Please be nice, friendly and welcoming on discussions/tickets.
- See existing [Issues](https://github.com/forge-ext/forge/issues) on the upstream Forge repository, or open a new issue there if it doesn't exist.

## Credits

Thank you to:

- Forge extension contributors
- Michael Stapelberg/contributors for i3
- System76/contributors for pop-shell
- ReworkCSS/contributors for css-parse/css-stringify
