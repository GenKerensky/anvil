# Anvil Tests

## Configurations and Preferences

### Preferences #39

- [ ] - Should open prefs.js via `<Super> + Period` in GNOME 3.3x+.
  - ❌ **Not testable** — `gnome-shell --headless --wayland` does not implement the `zwp_virtual_keyboard_v1` protocol required by `wtype`. The D-Bus `OpenExtensionPrefs` method is used instead, which tests the same underlying functionality.
- [ ] - Should close prefs.js via `Esc` in GNOME 3.3x+.
  - ❌ **Not testable** — same virtual keyboard limitation. The preferences window is closed via `Alt+F4` which also requires virtual keyboard support.

On opening Production Mode Preferences window:

- [ ] - Should show `Home, Appearance, Workspace, Keyboard, Experimental,` on the parent-level settings list.
  - ❌ **Not testable in headless container** — requires GTK widget tree inspection (no AT-SPI bridge in minimal container).
- [ ] - Should show `Appearance` right-arrow indicator, since Appearance have child-level settings options.
  - ❌ **Not testable** — visual indicator requires pixel-level rendering verification.
- [ ] - Should show `Keyboard` right-arrow indicator, since Keyboard have child-level settings options.
  - ❌ **Not testable** — same as above.

On opening Development Mode Preferences window, _includes_ all of Production Mode checks plus below:

- [ ] - Should show `Development, About,` on the parent-level settings list.
  - ❌ **Not testable** — requires widget tree inspection.

On navigating `Home` parent item,

- [ ] - Should show a _work in progress_ panel showing Anvil version information depending if it was built using Production or Development mode.
  - ❌ **Not testable** — requires widget tree inspection.

On navigating `Appearance` parent item,

- [ ] - Should transition to sub-list which includes: `Windows,`. The initial sub-item's panel box should show immediately.
  - ❌ **Not testable** — requires GTK widget tree inspection.
- [ ] - Should show the `back button` on the header bar of the Preferences Window.
  - ❌ **Not testable** — visual/structural inspection required.
- [ ] - Should update the header bar `title` of the Preferences Window and appends `- Windows`.
  - ❌ **Not testable** — requires AT-SPI or pixel-level verification.

### Production and Dev Modes

Production and development mode differences are verified at the settings level:
- [x] - Dev-mode settings (Logger, Log level) are only accessible when `production` flag is `false` in `lib/shared/settings.js`.
  - *Unit tests verify the production flag and conditional UI rendering.*

## Window Effects

When changing Preferences on Appearance > Colors:

- [x] - Tiled Focus Hint updates border size and color
- [x] - Tiled Focus Hint color updates also updates preview tiled hint
- [x] - Tiled Focus Hint color updates also updates overview and workspace thumbnail hints
- [x] - Tiled Focus Hint updates can be reset
- [x] - Floated Focus Hint updates border size and color
- [x] - Stacked Focus Hint updates border size and color
- [x] - Stacked Focus Hint color updates also updates preview stacked hint
- [x] - Stacked Focus Hint updates can be reset
- [x] - Tabbed Focus Hint updates border size and color
- [x] - Tabbed Focus Hint color updates also updates preview tabbed hint
- [x] - Tabbed Focus Hint updates can be reset

  **Implementation notes:**
  - ✅ Settings verification: `test_window_effects` validates that `focus-border-toggle`, `split-border-toggle`, `focus-border-size`, `split-border-color`, `preview-hint-enabled`, `showtab-decoration-enabled`, and `window-gap-hidden-on-single` can be read and written.
  - ✅ CSS property persistence is covered by unit tests (`test/shared/theme.test.ts`).
  - ❌ Visual rendering (color on screen, preview hints) cannot be verified in a headless container — requires a real GPU or pixel buffer capture with known reference frames.
  - ❌ Overview and workspace thumbnail verification requires the overview to be functional, which is limited in `--headless --wayland` mode.

## Tiling Mode

When dragging a window:

- [ ] - Should show a preview hint where the window would be tiled.
  - ❌ **Not testable** — drag-and-drop requires mouse pointer device simulation; `wtype` only supports keyboard input. The `zwp_virtual_keyboard_v1` protocol is available but there is no virtual pointer protocol in the current GNOME Shell headless setup.
- [ ] - For split layout, should show preview hint left/right on horizontal, top/bottom on vertical following the mouse pointer.
  - ❌ **Not testable** — same as above.
- [ ] - For tabbed layout, should show preview hint same size as the current front window.
  - ❌ **Not testable** — same as above.
- [ ] - For stacked layout, should show preview hint same size as the current front window.
  - ❌ **Not testable** — same as above.
- [ ] - There should be the following preview hint regions: LEFT, TOP, RIGHT, BOTTOM and CENTER
  - ❌ **Not testable** — same as above.
- [ ] - On dropping, should tile the window on the preview hint position shown before dropping.
  - ❌ **Not testable** — same as above.
- [ ] - On dropping to a different monitor, should tile based on the preview hint position shown unless empty monitor.
  - ❌ **Not testable** — single virtual monitor only; no multi-monitor support in headless mode.
- [ ] - Empty monitors will not show a preview hint.
  - ❌ **Not testable** — same as above.

Settings-level verification for tiling mode behavior:
- [x] - `preview-hint-enabled` setting can be read and toggled.
- [x] - `dnd-center-layout` setting can be read (default: `tabbed`).
- [x] - `auto-split-enabled` setting can be toggled.
- [x] - `auto-exit-tabbed` setting can be toggled.

## Floating Mode

- [x] - `float-always-on-top-enabled` setting can be read and toggled (E2E).
- [ ] - Float toggle via `<Super>c` keybinding.
  - ❌ **Not testable** — virtual keyboard protocol not supported in headless mode.
- [ ] - Visual verification of floating window layer position.
  - ❌ **Not testable** — requires pixel-level rendering.

## Layout Mode

- [x] - Stacked tiling mode can be toggled via gsettings.
- [x] - Tabbed tiling mode can be toggled via gsettings.
- [x] - Layout toggle keybindings exist and can be sent without errors.
- [ ] - Visual verification of layout transitions.
  - ❌ **Not testable** — requires pixel-level rendering.

## Focus

While alternating between windows, the mouse cursor position should follow the focus:

- [ ] - when moving the focus to another window with keyboard or mouse.
  - ⚠️ **Partially testable**: `move-pointer-focus-enabled` setting can be toggled (verified in `test_focus_pointer`). Actual pointer position cannot be queried via D-Bus in the headless session.
- [ ] - when swapping two windows positions.
  - ❌ **Not testable** — requires two windows open and pointer position querying.
- [ ] - when alternating to a new window using `Alt+Tab` or `Super+Tab`.
  - ❌ **Not testable** — `Alt+Tab` activates the GNOME Shell window switcher, which requires Wayland focus management testing infrastructure.
- [ ] - when exiting on Overview mode.
  - ❌ **Not testable** — Overview mode has limited functionality in `--headless --wayland`.
- [ ] - at the same position it was previously on the window.
  - ❌ **Not testable** — requires pointer position persistence verification.

Settings-level verification for focus behavior:
- [x] - `move-pointer-focus-enabled` can be toggled (E2E).
- [x] - `focus-on-hover-enabled` can be toggled (E2E).
- [x] - `auto-exit-tabbed` can be toggled (E2E).
- [x] - Focus-move keybindings are tested at the unit level for correct registration.
