# Headless / Devkit / Agent Loop Debugging

The authoritative treatment lives in the `gnome-shell-debug` skill (`.agents/skills/gnome-shell-debug/SKILL.md` v3.0).

## Three seams

| Seam                                                 | When                                           | Launcher                                     |
| ---------------------------------------------------- | ---------------------------------------------- | -------------------------------------------- |
| **Devkit** (human default)                           | Visual debugging, LG, flicker, rendering       | `run-devkit-session.sh`                      |
| **Headless**                                         | CI, E2E, integration, settings-only automation | `test/e2e/run.py`, `test/integration/run.py` |
| **Agent Loop** (agent default for behavioral/layout) | Autonomous repro iterations with JSON status   | `run-debug-loop.sh`                          |

## Quick entrypoints

**Human visual debugging (Devkit):**

```bash
.agents/skills/gnome-shell-debug/scripts/run-devkit-session.sh
```

**Agent-driven debug loop (headless):**

```bash
.agents/skills/gnome-shell-debug/scripts/run-debug-loop.sh \
  --script test/debug/examples/minimal-repro.js --json --iteration 1
```

Copy `repro-template.js` to `test/debug/local/` for local repro scripts (gitignored).
Repros are **staged** into the session dir before execution (symlinks rejected); results
default to `$SESSION_DIR/repro-results.json`.

## Key facts

- Agent loop v1 is **headless-only** (`--headless --virtual-monitor 1920x1080`).
- Launcher-style **isolated XDG** (not E2E host dconf model).
- One `run` = one iteration; agent owns the outer loop.
- Session dirs persist by default (`--keep-session-dir`); use `--rm-session-dir` to clean up.
- **Post-fix:** headless proves the fix; agent **asks** before launching devkit — never auto-starts.

Load the full skill for monitor rules, guardrails, D-Bus contracts, log markers, and post-fix ritual.
