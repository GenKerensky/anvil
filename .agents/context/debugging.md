# Headless / Devkit Debugging

The authoritative treatment of the Devkit Seam (default) and Headless Seam lives in the
`gnome-shell-debug` skill (`.agents/skills/gnome-shell-debug/SKILL.md`).

See that skill for:

- When to use each seam (devkit is default; headless only when explicitly called for or when the task — such as settings toggles — can be handled independently by headless).
- All environment facts, monitor rules, `--virtual-monitor` usage, automation contract, work-area notes, and gotchas.
- Launcher details.

This file now only contains high-level context and pointers.

Load the `gnome-shell-debug` skill (`.agents/skills/gnome-shell-debug/SKILL.md`) for the authoritative Devkit Seam (default) and Headless Seam, including when to choose each, launcher details, and all environment facts.

Default launcher (Devkit Seam):

```bash
.agents/skills/gnome-shell-debug/scripts/run-devkit-session.sh
```
