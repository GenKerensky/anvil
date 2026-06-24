---
name: gnome-shell-debug
description: >
  Use this skill when debugging GNOME Shell extensions, GJS runtime errors, "extension crashed",
  "shell won't load", "window flicker", logs, Looking Glass, or rebuild loops. Defaults to the
  Devkit Seam for interactive debugging and visual inspection. Use the Headless Seam only when
  explicitly called for (automation, tests) or when the task can be handled independently by
  headless (e.g. settings toggles, pure GSettings changes).
license: MIT
compatibility: Requires gnome-shell --devkit or --headless (GNOME 49+), dbus-run-session, journalctl; Distrobox host re-exec on Bazzite
metadata:
  author: anvil
  version: "2.0"
---

# GNOME Shell & GJS Debugging

This module owns **two distinct seams** for debugging GNOME Shell sessions.

**Devkit Seam (default)**: Interactive debugging with the full devkit viewer, Looking Glass, visual inspection, and rebuild loops. This is the primary path for most development work.

**Headless Seam**: Use only when explicitly called for (automation, E2E, integration, CI, "headless", "test") **or** when the debugging task can be handled independently by headless (e.g. settings toggles, GSettings changes, non-visual configuration, certain log/dbus-driven behaviors).

The Devkit Seam is the default. The module provides deep knowledge and the primary launcher for it. Headless facts and contracts are owned here so callers (including the testing skill) do not duplicate them.

## Devkit Seam (default)

### Default interactive session

Run from repo root:

```bash
.agents/skills/gnome-shell-debug/scripts/run-devkit-session.sh
```

Rebuild loop:

```bash
make build debug
.agents/skills/gnome-shell-debug/scripts/run-devkit-session.sh --no-build
```

The `run-devkit-session.sh` script is the deep launcher adapter for this seam. It:

- Runs `make build debug` unless `--no-build`
- Re-execs on the Bazzite host via `distrobox-host-exec` when invoked inside a Distrobox
- Uses temporary XDG dirs so the real GNOME session is untouched
- Symlinks `dist/` as the extension, enables Anvil, auto-launches a terminal
- Writes logs to `$SESSION_DIR/gnome-shell.log` (path printed at start)

### Common flags (Devkit Seam)

| Flag              | Effect                                     |
| ----------------- | ------------------------------------------ |
| `--no-build`      | Skip `make build debug`                    |
| `--no-terminal`   | Do not auto-launch a terminal              |
| `--terminal-cmd`  | Custom terminal command for nested session |
| `--keep-temp`     | Preserve temp XDG/log dir after exit       |
| `--shell-arg ARG` | Extra `gnome-shell` argument (repeatable)  |

### Inspecting the session

**Logs**

Set before launch for more detail:

| Value                             | Effect                                           |
| --------------------------------- | ------------------------------------------------ |
| `SHELL_DEBUG=backtrace-warnings`  | JS stack on `console.warn()` / `console.error()` |
| `SHELL_DEBUG=backtrace-segfaults` | JS stack before exit on fatal crash              |
| `SHELL_DEBUG=all`                 | All debugging options                            |

Also useful: `G_MESSAGES_DEBUG=all`.

View with:

```bash
journalctl -f -o cat /usr/bin/gnome-shell | grep -i anvil
```

Devkit sessions started by the launcher write to the temp log printed at launch.

**Looking Glass (lg)**

Press `Alt+F2`, type `lg` (focus must be on the nested desktop inside the mutter-devkit window, otherwise it opens on the host).

Evaluator tab (default) lets you run JS. Useful pre-imports: `GLib`, `GObject`, `Gio`, `Clutter`, `Meta`, `St`, `Shell`, `Main`.

Helpers:

- `r(index)` — previous return value
- `inspect(x, y)` — actor at coordinates
- `stage`

**Anvil quick checks**:

1. Extensions tab → Anvil → **Errors**
2. Evaluator: `Main.extensionManager.lookup('anvil@GenKerensky.github.com')`
3. Evaluator: `global.display.get_focus_window()?.get_title()`

Other tabs: Windows, Actors, Flags.

### Devkit Gotchas

- GJS cannot hot-reload — restart shell or devkit after every code change.
- Wayland: no in-session `restart`; use devkit or log out.
- Devkit `Alt+F2` / `lg` requires focus on the nested desktop.
- `Shell.Eval` always returns `(false, '')` — use D-Bus or direct GJS APIs.
- Devkit GTK window can steal focus from automated key injection.
- `--devkit` always adds a 1280×800 monitor.

## Headless Seam

Use the Headless Seam when the symptom explicitly mentions headless/automation/test/E2E/CI **or** the task can be performed by headless on its own (e.g. toggling GSettings for window gaps, tiling-mode, floating classes, or other non-visual configuration without needing LG or the devkit viewer).

### Key differences

| Flag         | Behavior                                             | Use case                                         |
| ------------ | ---------------------------------------------------- | ------------------------------------------------ |
| `--devkit`   | Full devkit GUI + extra monitor                      | Interactive debugging (default)                  |
| `--headless` | Headless compositor only, exact monitors you request | CI / automated tests or self-contained debugging |

Both support `--automation-script`. `--devkit` calls `export async function run()`; headless typically uses module-level code.

**Do NOT use `MUTTER_DEBUG_DUMMY_MODE_SPECS`** (ignored on native Wayland backend).

Use `--virtual-monitor`:

```bash
# Correct for single 1920×1080 (headless)
gnome-shell --wayland --headless --virtual-monitor 1920x1080 --automation-script ...

# --devkit will add an unwanted extra 1280×800 monitor
```

`--headless` gives exactly the monitors requested. Work area is reduced by the top panel (32 px): 1920×1080 monitor → `{x:0, y:32, width:1920, height:1048}`.

### Headless gotchas

- Screenshots do not work in pure `--headless` (use devkit for visual debugging).
- `wtype` keyboard injection works in both when `WAYLAND_DISPLAY` points to the nested socket.
- Multiple monitors: repeat `--virtual-monitor`.
- For pure settings toggles or GSettings-driven behaviors, headless is often sufficient on its own.

See the testing skill for how E2E and integration runners construct headless sessions using these facts.

## Bundled scripts

All scripts are relative to this skill directory. The agent executes them directly ("execute scripts yourself").

| Script                   | Seam / Purpose                                                                                                  |
| ------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `run-devkit-session.sh`  | **Primary deep launcher for the Devkit Seam** (default). Isolated XDG, Distrobox-aware, full readiness polling. |
| `quick-debug-build.sh`   | Rare schema-compile bypass (still usable with Devkit Seam).                                                     |
| `start-debug-session.sh` | Legacy quick /tmp capture (Devkit). Prefer the primary launcher.                                                |
| `devkit-debug.sh`        | Legacy make+install flow (Devkit). Prefer the primary launcher.                                                 |

For the Headless Seam, launchers are typically constructed using the facts documented above (or delegated to test runner helpers). The primary script is intentionally focused on the Devkit Seam.

## Rare paths

**GDB**

Start under GDB for crashes:

```bash
export G_MESSAGES_DEBUG=all
export SHELL_DEBUG=all
dbus-run-session -- gdb --args gnome-shell --devkit --wayland
(gdb) run
(gdb) call (void)gjs_dumpstack()
```

Break on criticals: `set env G_DEBUG=fatal-criticals`.

From code: `import { System } from "gi://Gjs"; System.breakpoint();`

Always restart after code changes.

Execute scripts yourself; do not tell the user to run them unless they asked.
