# Anvil E2E Testing Strategy

> **GNOME 50 / mutter 50.1:** The `--nested` flag was removed in GNOME 50.
> `gnome-shell --headless --wayland` is the only compositor mode that works
> in a container without a real GPU. All E2E tests use D-Bus, gsettings,
> `Shell.Eval`, and **Dogtail/AT-SPI** for GTK widget tree inspection.
> Keyboard injection and pixel-level visual tests are not feasible.

## Architecture

```
npm test
  ├── npm run typecheck     → tsc --noEmit
  ├── npm run lint          → eslint + prettier
  ├── npm run test:unit     → vitest (~182 tests)
  ├── npm run test:e2e:build → make test-e2e-build-all
  │     ├── podman build -t anvil-test-pod:fedora-42  (GNOME 48)
  │     ├── podman build -t anvil-test-pod:fedora-43  (GNOME 49)
  │     └── podman build -t anvil-test-pod:fedora-44  (GNOME 50)
  └── npm run test:e2e:all  → make test-e2e-all
        ├── run-tests.sh -v 42  (79 bash + 46 behave = 125 assertions)
        ├── run-tests.sh -v 43
        └── run-tests.sh -v 44
```

## Custom Container

We use a custom `test/e2e/Containerfile` rather than `gnome-shell-pod`.

| Fedora | GNOME Shell | Image tag |
|--------|------------|-----------|
| 42 | 48.8 | `anvil-test-pod:fedora-42` |
| 43 | 49.6 | `anvil-test-pod:fedora-43` |
| 44 | 50.x | `anvil-test-pod:fedora-44` |

Each image provides:
- `gnome-shell`, `mutter`, `gnome-extensions-app`, `gnome-text-editor`
- `at-spi2-core`, `at-spi2-atk`, `python3-dogtail`, `python3-pip`
- `behave`, `behave-html-pretty-formatter` (pip3)
- A `gnomeshell` user with `sudo` (UID 1000)
- A systemd unit `gnome-headless.service` that runs `start-session.sh`
- The extension is installed from the host via `tests.sh` (not baked into the image)

## Test Architecture

### Bash assertions (47 tests in `test/e2e/tests.sh`)

Uses D-Bus + gsettings to verify:
- Extension lifecycle (enable, disable, error checking)
- Settings read/write (gsettings)
- Shell.Eval state queries (test-mode gating)
- Window opening and tiling tree

### Behave BDD + Dogtail/AT-SPI (10 scenarios, 46 steps)

Feature files in `test/e2e/features/`:
- `atspi_tree.feature` — 1 scenario: AT-SPI tree accessibility
- `preferences.feature` — 9 scenarios: page tab presence, switch state
  verification (7 switches), page tab navigation

Step definitions use Dogtail for AT-SPI tree interaction:
- `findChildren(GenericPredicate(roleName="page tab"))` for sidebar tabs
- `findChildren(GenericPredicate(roleName="switch"))` for GtkSwitch toggles
- `.doActionNamed("click")` for button/tab clicks
- `.checked` property for switch state (GtkSwitch AT-SPI click is no-op in headless)

Results produce an HTML report with embedded AT-SPI tree snapshots on failure.

### Unit tests (182 vitest tests)

Located in `test/`. Pure logic, tree operations, utils, theme CSS persistence.
Pre-commit hook runs them automatically.

## D-Bus API

### `org.gnome.Shell` — `/org/gnome/Shell`

| Method | Signature | Notes |
|---|---|---|
| `Eval` | `(s) → (b, s)` | Execute JS in Shell process |
| `FocusSearch` | `() → ()` | Focus overview search |
| `ShowApplications` | `() → ()` | Open app grid |

**Properties:** `OverviewActive: b` (r/w), `ShellVersion: s` (r)

### `org.gnome.Shell.Extensions` — `/org/gnome/Shell`

| Method | Signature | Notes |
|---|---|---|
| `EnableExtension` | `(s) → (b)` | Enable by UUID |
| `DisableExtension` | `(s) → (b)` | Disable by UUID |
| `ReloadExtension` | `(s) → ()` | Hot-reload |
| `GetExtensionInfo` | `(s) → (a{sv})` | Full metadata + state |
| `GetExtensionErrors` | `(s) → (as)` | Error list |
| `ListExtensions` | `() → (a{sa{sv}})` | All installed |
| `OpenExtensionPrefs` | `(s, s, a{sv}) → ()` | Open prefs dialog |
| `UninstallExtension` | `(s) → (b)` | Uninstall |

**Extension states:** 1=ACTIVE, 2=INACTIVE, 3=ERROR, 4=OUT_OF_DATE, 6=INITIALIZED

## Design Decisions

- **No keyboard injection** — `xdotool` needs X11/Xvfb, `wtype` needs
  `zwp_virtual_keyboard_v1` (not in headless compositor). All interaction
  uses D-Bus, gsettings, and AT-SPI actions.

- **No pixel screenshots** — headless surfaceless renderer has no framebuffer
  to capture. Switch state verification uses `.checked` property instead.

- **`test-mode` gsetting** gates `global.__anvil_test_state`, enabling
  `Shell.Eval`-based assertions without exposing internals in production.

- **GtkSwitch `.checked` verification** replaces AT-SPI click toggles in
  headless mode. Switch interaction: gsettings write → re-read `.checked`.

- **Page tab navigation** in switch scenarios is necessary because AT-SPI
  may only expose widgets on the currently visible AdwNavigationPage.

- **Multiple AT-SPI role names** (`switch`, `toggle button`, `check box`)
  are tried because GtkSwitch roles vary across GTK versions.

## D-Bus Cheat Sheet

```bash
# All commands run inside the container via set-env.sh wrapper

# Enable extension
gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
  --method org.gnome.Shell.Extensions.EnableExtension \
  "'anvil@GenKerensky.github.com'"

# Check extension state
gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
  --method org.gnome.Shell.Extensions.GetExtensionInfo \
  "'anvil@GenKerensky.github.com'"

# Check extension errors
gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
  --method org.gnome.Shell.Extensions.GetExtensionErrors \
  "'anvil@GenKerensky.github.com'"

# Evaluate JS in Shell context
gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
  --method org.gnome.Shell.Eval \
  "'global.display.get_n_monitors()'"

# Open extension preferences
gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
  --method org.gnome.Shell.Extensions.OpenExtensionPrefs \
  "'anvil@GenKerensky.github.com'" "''" "{}"

# Extension gsettings
gsettings \
  --schemadir ~/.local/share/gnome-shell/extensions/anvil@GenKerensky.github.com/schemas \
  set org.gnome.shell.extensions.anvil "gap-size" "10"
```

## Dogtail/AT-SPI Quick Reference

```python
from dogtail.tree import root
from dogtail.predicate import GenericPredicate

# Find the prefs window
for app in root.children:
    for child in app.children:
        if child.roleName in ("frame", "window") and "Anvil" in child.name:
            prefs_window = child

# Find page tabs by role
tabs = prefs_window.findChildren(GenericPredicate(roleName="page tab"))

# Find switches (try multiple role names for GTK version compat)
for role in ("switch", "toggle button", "check box"):
    switches = prefs_window.findChildren(GenericPredicate(roleName=role))

# Click a widget
tab.doActionNamed("click")

# Check switch state
sw.checked  # boolean
```

## References

- [AT-SPI2 API docs](https://docs.gtk.org/atspi2/)
- [dogtail on PyPI](https://pypi.org/project/dogtail/)
- [behave BDD framework](https://behave.readthedocs.io/)
- [`org.gnome.Shell` D-Bus XML](https://gitlab.gnome.org/GNOME/gnome-shell/-/blob/main/data/dbus-interfaces/org.gnome.Shell.xml)
- [`org.gnome.Shell.Extensions` D-Bus XML](https://gitlab.gnome.org/GNOME/gnome-shell/-/blob/main/data/dbus-interfaces/org.gnome.Shell.Extensions.xml)
- [GNOME Shell Extension Development](https://gjs.guide/extensions/development/creating.html)
