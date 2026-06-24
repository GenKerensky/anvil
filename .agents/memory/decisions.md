# Architecture Decisions

## Test infrastructure

- **`global.__anvil_extWm`** set in `enable()` always (not just test-mode) — bypasses GNOME 50 lookup
  proxy.
- **`global.__anvil_settings`** set in `enable()` always — `getSettings()` blocked by proxy too.
- **No GSettings writes from runner.js** — devkit shares host `~/.config/dconf/user`.
- **Devkit window exempt** via `src/config/windows.json` (`org.gnome.Shell`, `DevKit`, float).
- **Resolution fixed** to 1920×1080 via `--headless --virtual-monitor 1920x1080` (not `--devkit`,
  which adds a second 1280×800 monitor).
- **`ext.getSettings()`** (base Extension method, proxied) for constraint read/write in test helpers.
- **`sendKeyCombo()` / `getAnvilWM()`** use `global.__anvil_extWm`.

## Resize exemption

- **`_resizedWindows`** is `Map<number, number>` tracking resize counts per window.
- Exemption requires count ≥ 2 (first resize always clamped; async Wayland `size-changed` may arrive
  before counter increments).
- `clearResizedWindows()` in test `beforeEach` to prevent state bleed.

## Terminal/TUI flicker

- Spurious `size-changed` / `position-changed` from terminals must not trigger `renderTree`.
- `move()` skips `move_resize_frame` when frame already matches target rect.

## Shared test commands

- `test/lib/shared-commands.js` is single source of truth for integration + E2E helpers.
