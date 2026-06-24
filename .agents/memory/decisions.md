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

## wl-clipboard / ephemeral Wayland helpers

Wayland creates short-lived helper windows (notably **`wl-clipboard`**, a 1×1 stub) during
delete/paste/clipboard sync. If Anvil tracks them, the helper can enter a split and
`window-destroy-quick` re-tiles the real TUI; focus bounces also trigger border relayout.

**Anvil policy (fully ignore):**

- `Utils.isEphemeralHelperWindow()` — matches `wl-clipboard`, `xclip`, `xsel` by wm class/title,
  or any ≤2×2 frame stub.
- `_validWindow()` returns `false` → never tracked, no signal handlers.
- `isFloatingExempt()` returns `true`; `windows.json` has `{ "wmClass": "wl-clipboard", "mode": "float" }`.
- `windowDestroy` skips `renderTree` for float/ephemeral nodes.
- Focus handler returns early for ephemeral windows (belt-and-suspenders).

**Residual symptom:** a subtle terminal titlebar brightness flash may still occur when Mutter
briefly focuses `wl-clipboard` at the compositor level; the extension cannot suppress that.

## Shared test commands

- `test/lib/shared-commands.js` is single source of truth for integration + E2E helpers.

## Agent skills: gnome-shell-debug module (2026-06-24)

The debug skill module was deepened with two explicit seams:

- **Devkit Seam** (default): interactive debugging, LG, visual, rebuild loops. Primary deep launcher is `run-devkit-session.sh`.
- **Headless Seam**: only when explicitly called for or when the task can be handled independently by headless (e.g. settings toggles / GSettings changes without UI/LG).

The module owns the facts for both (locality). SKILL.md is now the deep implementation with common content inlined. Cross-references in context/debugging.md and testing/SKILL.md were reduced to thin pointers. Legacy scripts remain for rare cases but are subordinated in docs.

This improves depth, leverage (one load for the default path), and removes duplication while preserving progressive disclosure for rare paths (GDB) and the "execute scripts yourself" rule.
