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

Anvil has two levels of automated tests: **unit tests** (fast, no GNOME runtime needed)
and **E2E tests** (full GNOME Shell session in a container).

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

### E2E Tests

E2E tests run a real GNOME Shell session inside a [Podman](https://podman.io) container
and validate the extension through three mechanisms:

1. **D-Bus API calls** — extension lifecycle, enabling/disabling, error checking
2. **GSettings read/write** — settings propagation, layout mode toggles, window effects
3. **Dogtail/AT-SPI widget inspection** — GTK preferences dialog structure, switch state
   verification, page tab navigation (all via the accessibility bus, no display needed)

The session runs `gnome-shell --headless --wayland` — the correct headless mode for
GNOME 50, which removed the `--nested` flag. This brings up a complete Wayland compositor
with a virtual framebuffer; no Xvfb, no DRM device, and no real GPU are required.
D-Bus system services are provided by
[python-dbusmock](https://github.com/martinpitt/python-dbusmock) stubs, matching the
approach used by GNOME Shell's own GitLab CI.

UI tests use **Behave** (BDD framework) to organize Dogtail/AT-SPI interactions into
readable Gherkin feature files. Test results are published as a self-contained HTML report
with AT-SPI tree snapshots embedded on failure for debugging.

**What is NOT testable headless:**

- Keyboard keybindings (`zwp_virtual_keyboard_v1` not implemented by headless compositor)
- Pixel-level visual rendering (no GPU framebuffer)
- Mouse drag-and-drop (no pointer device)
- GtkSwitch clicks via AT-SPI (no pointer device; state verified via `.checked` property)

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
./test/e2e/build-container.sh 44

# Or build for all supported versions
make test-e2e-build-all
```

**Step 2: Run the tests**

```bash
# Run against Fedora 44 (default)
make test-e2e

# Run against a specific Fedora version
make test-e2e FEDORA_VERSION=43

# Run against all supported versions
make test-e2e-all
```

**Debugging a failed test:**

On failure, the test runner saves:

- A self-contained **HTML report** to `test/e2e/output/behave-report-*.html` with full
  scenario breakdown, step status, and embedded AT-SPI tree snapshots
- The full GNOME Shell **journal log** to `test/e2e/output/journal.log`

Use `-k` to keep the container running for manual inspection:

```bash
./test/integration/run-tests.sh -v 44 -k
# Container is left running — connect to it for debugging:
podman exec -it --user gnomeshell <container-id> set-env.sh bash
```

**Test structure:**

```
test/e2e/
├── features/                    # Behave BDD feature files
│   ├── environment.py           # Hooks: AT-SPI tree dump on failure
│   ├── atspi_tree.feature       # AT-SPI accessibility verification
│   ├── preferences.feature      # Page tabs, switch state, tab navigation
│   └── steps/
│       ├── helpers.py           # Shared: gsettings, prefs, AT-SPI dump utilities
│       ├── atspi_steps.py       # Step definitions for AT-SPI tree
│       └── preferences_steps.py # Step definitions for preferences
├── run-tests.sh                 # Test runner (container lifecycle, orchestration → behave)
├── start-session.sh             # Session D-Bus + dbusmock + gnome-shell --headless
└── Containerfile                # Fedora-based image with AT-SPI + Dogtail + behave
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
