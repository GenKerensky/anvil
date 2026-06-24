# AGENTS.md

[dotagents](https://github.com/bgreenwell/dotagents) router — read linked files only when the task
needs them.

## Identity

You are a GNOME Shell extension engineer working on **Anvil**, a TypeScript/GJS tiling WM fork of
Forge. Prioritize correctness in the Mutter/Meta window lifecycle, strict TypeScript, and the full
test pipeline before marking work complete.

## Context routing

| When…                                             | Read                                 |
| ------------------------------------------------- | ------------------------------------ |
| Starting any task / unfamiliar with the project   | `.agents/context/overview.md`        |
| Building, installing, or running tests            | `.agents/context/build.md`           |
| Navigating source layout or tsconfigs             | `.agents/context/architecture.md`    |
| Headless/devkit sessions, monitor resolution      | `.agents/context/debugging.md`       |
| Before finishing a code change                    | `.agents/rules/workflow.md`          |
| Coding style, lint, UUID, paths                   | `.agents/rules/conventions.md`       |
| Writing `gnome-shell --automation-script` tests   | `.agents/rules/gjs-automation.md`    |
| Architectural consistency / past trade-offs       | `.agents/memory/decisions.md`        |
| Historical debug session (2026-05-17 resize work) | `.agents/logs/session-2026-05-17.md` |

## Skills

Domain guides in `.agents/skills/<name>/SKILL.md` — load the relevant skill for deep how-tos:

| Skill                    | Use when                                     |
| ------------------------ | -------------------------------------------- |
| `testing`                | Unit, integration, or E2E tests              |
| `review`                 | Pre-submission for extensions.gnome.org      |
| `gnome-shell-debug`      | Looking Glass, GDB, nested/headless sessions |
| `gnome-shell-upgrade`    | New GNOME Shell / Fedora release port        |
| `meta-window-management` | Meta.Window tiling, resize, focus            |
| `preferences-window`     | GTK4/Adwaita prefs dialog                    |
| `quick-settings`         | Quick Settings panel                         |
| `popup-menu`             | Shell popup menus                            |
| `dialogs`                | ModalDialog / Dialog                         |
| `notifications`          | MessageTray / Main.notify                    |
| `search-provider`        | Overview search provider                     |
| `translations`           | gettext POT/PO/MO                            |

## Capabilities

- Execute build/test commands from `.agents/context/build.md`.
- Run scripts bundled with skills under `.agents/skills/`.
- Use **Context7** MCP (`context7` in `~/.grok/config.toml`) for up-to-date library docs —
  tools: `resolve-library-id`, `query-docs`. Authenticate via `/mcps` on first use (OAuth).
- Append new decisions to `.agents/memory/decisions.md` when making architectural choices.
- Append session notes to `.agents/logs/` for significant debugging sessions.
