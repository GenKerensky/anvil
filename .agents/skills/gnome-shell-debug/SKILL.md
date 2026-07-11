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
  version: "3.0"
---

# GNOME Shell & GJS Debugging

This module owns **three seams** for debugging GNOME Shell sessions.

| Seam                              | Default for                         | Launcher                              |
| --------------------------------- | ----------------------------------- | ------------------------------------- |
| **Devkit**                        | Human visual debugging, LG, flicker | `run-devkit-session.sh`               |
| **Headless**                      | E2E, settings-only tasks            | `test/e2e/run.py`                     |
| **Agent Loop** (v1 headless only) | Autonomous agent debug iterations   | `run-debug-loop.sh` → `debug_loop.py` |

**Devkit Seam**: Interactive debugging with the full devkit viewer, Looking Glass, visual inspection, and rebuild loops. Primary path for human visual work.

**Headless Seam**: Automation, E2E, or self-contained settings/GSettings tasks without LG.

**Agent Loop Seam**: Structured single-iteration runs with JSON artifacts, log analysis, and host guardrails. **Default for behavioral/layout bugs** when an agent drives repro → fix loops.

> **Default:** headless agent loop for behavioral and layout bugs.
> **After fix:** ask the user if they want `run-devkit-session.sh` for interactive verification. **Never auto-start devkit post-fix.**

The Devkit Seam remains the default for **human** interactive debugging. Agent Loop is the default for **autonomous** repro iterations.

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

#### Logs

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

#### Looking Glass (lg)

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

See the testing skill for how the E2E runner constructs headless sessions using these facts.

## Agent Loop Seam (v1 headless)

Single `run` invocation = **one iteration**. The agent owns the outer loop (edit code → re-invoke with `--iteration N+1`).

### Entrypoint

```bash
.agents/skills/gnome-shell-debug/scripts/run-debug-loop.sh \
  --script test/debug/local/repro.js --json --iteration 1
```

Subsequent iterations reuse the session dir from iteration JSON (`session.dir` is kept by default):

```bash
SESSION_DIR=$(jq -r .session.dir iteration-001.json)
.agents/skills/gnome-shell-debug/scripts/run-debug-loop.sh \
  --no-build --session-dir "$SESSION_DIR" \
  --script test/debug/local/repro.js --json --iteration 2
```

### Wrapper contract

- Sets `ANVIL_DEBUG_LOOP=1`
- **Sole owner** of `make build debug` (unless `--no-build` or `ANVIL_DEBUG_LOOP_ON_HOST=1` on distrobox re-exec)
- Re-execs on Bazzite host via `distrobox-host-exec` when in container
- Always invokes `debug_loop.py run --no-build`
- `--keep-session-dir` is default; pass `--rm-session-dir` for one-shot cleanup

### Repro scripts

1. Copy `repro-template.js` → `test/debug/local/my-repro.js` (gitignored)
2. Or use checked-in `test/debug/examples/minimal-repro.js`
3. Author scripts under `test/debug/` with `import … from "../../lib/shared-commands.js"` (resolves to `test/lib/`)
4. **Symlinks rejected** — `validate_script_path()` refuses symlinked repro paths
5. **Staged execution** — orchestrator copies the repro into `$SESSION_DIR/test/debug/local/repro.js` and runs that staged copy (closes TOCTOU); `$SESSION_DIR/repro.js` is an audit snapshot of the source
6. Results written to `$ANVIL_DEBUG_RESULTS` (default `$SESSION_DIR/repro-results.json`, injected by orchestrator)

### CLI (`debug_loop.py`)

| Subcommand  | Purpose                                                        |
| ----------- | -------------------------------------------------------------- |
| `preflight` | Guardrails only; JSON pass/fail                                |
| `run`       | Single iteration: launch → script/observe → analyze → teardown |
| `tail`      | Snapshot or `--follow` gnome-shell.log                         |
| `status`    | Latest or `--iteration N` JSON                                 |
| `teardown`  | Kill orphans from `meta.json`                                  |

Exit codes: `0` pass, `1` repro fail, `2` guardrail abort, `3` shell crash, `130` SIGINT.

### Agent outer loop (pseudocode)

```text
1. Load gnome-shell-debug v3 + gjs-automation.md
2. Write test/debug/local/repro.js from repro-template.js
3. OUTER LOOP (max ~10 iterations, agent policy):
     a. Iteration 1: run-debug-loop.sh --script … --json --iteration 1
        Later: run-debug-loop.sh --no-build --session-dir $SESSION_DIR …
     b. Read iteration-NNN.json; SESSION_DIR=$(jq -r .session.dir …)
     c. If .results.passed → break
     d. Edit src/; npm run typecheck && npm run lint
4. npm run test:unit (+ make test-e2e if Meta lifecycle behavior changes)
5. Post-fix ritual (below)
6. Optional: run-debug-loop.sh teardown --session-dir "$SESSION_DIR"
```

### Visual escalation

Agent loop v1 is headless-only. For flicker, rendering, or LG inspection:

```bash
make build debug
.agents/skills/gnome-shell-debug/scripts/run-devkit-session.sh --no-build
```

### Guardrails (two phases)

| Phase                                | When                                    | Checks                                                                                                  |
| ------------------------------------ | --------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| **Early** (`preflight`)              | Before build/launch                     | `ANVIL_DEBUG_LOOP=1`, `WAYLAND_DISPLAY`/`DISPLAY` unset; optional `--session-dir` XDG layout validation |
| **Launch** (`run` after shell start) | After isolated dbus + gnome-shell spawn | Bus fingerprint ≠ host, child `/proc/$pid/environ` isolated sentinels, XDG prefix under session dir     |

`preflight` JSON includes `"phase": "early"`. Full bus/XDG verification runs only at launch when an isolated daemon exists.

### Post-fix ritual

After headless repro passes and workflow gates succeed:

1. Run tests per `.agents/rules/workflow.md`
2. Update `.agents/memory/decisions.md` / session logs if non-trivial
3. Report to user using this template:

   ```text
   ## Fix summary
   - **Symptom:** …
   - **Root cause:** …
   - **Fix:** …
   - **Verified by:** headless repro test/debug/local/<repro>.js (iteration N passed)

   ## Tests run
   - typecheck, lint, unit, …

   Would you like to verify the fix interactively in a devkit session?
   ```

4. **Ask** whether the user wants devkit verification — do **not** auto-launch
5. Commit after user declines/defers devkit (or after offering without blocking on session)

## Bundled scripts

All scripts are relative to this skill directory. The agent executes them directly ("execute scripts yourself").

| Script                   | Seam / Purpose                                                                                        |
| ------------------------ | ----------------------------------------------------------------------------------------------------- |
| `run-devkit-session.sh`  | **Primary deep launcher for the Devkit Seam**. Isolated XDG, Distrobox-aware, full readiness polling. |
| `run-debug-loop.sh`      | **Primary launcher for the Agent Loop Seam**. Build owner; delegates to `debug_loop.py`.              |
| `debug_loop.py`          | Agent orchestrator: preflight, run, tail, status, teardown; JSON iteration artifacts.                 |
| `repro-template.js`      | Scaffold for `test/debug/local/*.js` repro scripts.                                                   |
| `quick-debug-build.sh`   | Rare schema-compile bypass (Devkit).                                                                  |
| `start-debug-session.sh` | Legacy quick /tmp capture (Devkit). Prefer the primary launcher.                                      |
| `devkit-debug.sh`        | Legacy make+install flow (Devkit). Prefer the primary launcher.                                       |

Shared Python libraries live in `test/lib/`: `shell_session.py`, `host_guard.py`, `log_analysis.py`, `runner_utils.py`.

For the Headless Seam (E2E), the launcher is `test/e2e/run.py`.

## Rare paths

### GDB

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
