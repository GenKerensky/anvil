# Anvil WM

![Anvil](assets/org.gnome.shell.extensions.anvil-regular.svg)

> Anvil is a Tiling Window Manager Gnome Extension
>
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

Anvil has two automated test layers: **unit tests** (fast, no GNOME runtime) and
**E2E tests** (host `gnome-shell --headless` with Jasmine). For agent-driven debugging
of behavioral and layout bugs, use the **agent debug loop** — see below.

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

# Run typecheck + lint + unit tests together
npm test
```

### E2E Tests (Headless)

E2E tests run a real GNOME Shell session on the host using
`gnome-shell --wayland --headless --virtual-monitor 1920x1080` with an isolated session
bus and [python-dbusmock](https://github.com/martinpitt/python-dbusmock) stubs. Specs are
**Jasmine** modules loaded via `--automation-script` (`test/e2e/runner.js`).

Suites cover: extension lifecycle, tiling geometry, keyboard shortcuts, window operations,
resize clamping (data-driven matrix), focus/swap/move, floating and snap layouts, advanced
layouts, workspace skip-tile, borders/gaps, minimize, monitor constraints, and preferences
open/reuse/close/reopen lifecycle.

Shared helpers live in `test/lib/shared-commands.js` (`launchApp`, `waitForWindowCount`,
`getFocusedWindowId`, `sendAnvilCommand`, etc.).

**Prerequisites:**

- Host GNOME Shell with `--headless` and `--virtual-monitor` (GNOME 49+)
- `jasmine-gjs` installed at `/usr/share/jasmine-gjs/` (from source if not packaged)
- `nautilus` (test app — Text Editor’s preferred size does not tile reliably in headless)
- `python3`, `dbusmock` recommended, `glib2-devel` for `make dist`

On Bazzite, prefer running E2E inside `fedora-devbox` (mutable `dnf`) rather than layering packages on the host.

Install jasmine-gjs from source if missing:

```bash
git clone --depth=1 https://github.com/ptomato/jasmine-gjs.git
cd jasmine-gjs && meson setup _build --prefix=/usr
ninja -C _build && sudo ninja -C _build install
```

```bash
# Full E2E suite
make test-e2e

# Filter by suite name substring
python3 test/e2e/run.py --tag resize
python3 test/e2e/run.py --no-build --tag focus
```

**What is NOT testable headless:** mouse drag-and-drop, pixel-level visual rendering.

### Agent Debug Loop (headless)

For tight repro → log analysis → code edit cycles (especially behavioral and layout bugs),
the **Agent Loop** launches an isolated headless GNOME Shell session with guardrails so your
real session is never touched. One invocation = one iteration; the agent (or you) owns the
outer loop.

**Prerequisites:** `gnome-shell` with `--headless` and `--virtual-monitor` (GNOME 49+),
`python3`, `dbusmock` (recommended — same as E2E), built `dist/` (`make build debug`)

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

**Tooling tests** (deterministic guardrails and log/session utilities; also run by `npm test`):

```bash
npm run test:tooling

# Opt-in live GNOME Shell smoke; builds dist/ first
npm run test:tooling:host
```

Installed preferences, icon, Quick Settings, and stylesheet validation uses the
[installed-package smoke checklist](docs/testing/installed-package-smoke.md).

Full documentation: `.agents/skills/gnome-shell-debug/SKILL.md` (v3.0).

#### Test structure

```text
test/
├── lib/
│   ├── shared-commands.js       # Shared GJS helpers (E2E + debug loop)
│   ├── shell_session.py         # HeadlessShellSession (agent loop)
│   ├── host_guard.py            # Host-session guardrails for debug loop
│   └── log_analysis.py          # Anvil log signatures for debug loop
├── debug/
│   ├── examples/                # Checked-in repro scripts (e.g. minimal-repro.js)
│   └── local/                   # Gitignored local repro scripts
├── e2e/
│   ├── run.py                   # Host orchestrator (D-Bus, shell, results)
│   ├── runner.js                # Jasmine automation-script
│   └── suites/                  # Jasmine suite files
└── unit/                        # vitest unit tests
```

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
