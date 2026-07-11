# AGENTS.md

[dotagents](https://github.com/bgreenwell/dotagents) router — read linked files only when the task
needs them.

## Identity

You are a GNOME Shell extension engineer working on **Anvil**, a TypeScript/GJS tiling WM fork of
Forge. Prioritize correctness in the Mutter/Meta window lifecycle, strict TypeScript, and the full
test pipeline before marking work complete.

## Context routing

| When…                                                                | Read                                                          |
| -------------------------------------------------------------------- | ------------------------------------------------------------- |
| Starting any task / unfamiliar with the project                      | `.agents/context/overview.md`                                 |
| Building, installing, or running tests                               | `.agents/context/build.md`                                    |
| Navigating source layout or tsconfigs                                | `.agents/context/architecture.md`                             |
| Adding features / touching tiling core (`window.ts`, tree, commands) | `.agents/rules/architecture.md` (owners, F4 rules, checklist) |
| Devkit / agent-loop sessions, monitors                               | `.agents/context/debugging.md`                                |
| Before finishing a code change                                       | `.agents/rules/workflow.md`                                   |
| Pre-submission review for extensions.gnome.org                       | `.agents/rules/review.md`                                     |
| Upgrading for new GNOME Shell / Fedora release                       | `.agents/rules/gnome-shell-upgrade.md`                        |
| Writing git commit messages                                          | Conventional Commits (below)                                  |
| Coding style, lint, UUID, paths                                      | `.agents/rules/conventions.md`                                |
| Writing `gnome-shell --automation-script` tests                      | `.agents/rules/gjs-automation.md`                             |
| Architectural consistency / past trade-offs                          | `.agents/memory/decisions.md`                                 |
| Historical debug session (2026-05-17 resize work)                    | `.agents/logs/session-2026-05-17.md`                          |

## Skills

Domain guides in `.agents/skills/<name>/SKILL.md` — load the relevant skill for deep how-tos:

| Skill                    | Use when                                |
| ------------------------ | --------------------------------------- |
| `testing`                | Unit or E2E tests                       |
| `gnome-shell-debug`      | Devkit, agent loop, GJS shell debugging |
| `meta-window-management` | Meta.Window tiling, resize, focus       |
| `preferences-window`     | GTK4/Adwaita prefs dialog               |
| `quick-settings`         | Quick Settings panel                    |
| `popup-menu`             | Shell popup menus                       |
| `dialogs`                | ModalDialog / Dialog                    |
| `notifications`          | MessageTray / Main.notify               |
| `search-provider`        | Overview search provider                |
| `translations`           | gettext POT/PO/MO                       |
| `dream`                  | Distill session logs; wipe local/       |

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) for every commit message:

```text
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

- **Types:** `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`
- **Subject:** imperative mood, lowercase, no trailing period; keep the first line ≤72 characters
- **Scope:** optional area hint (e.g. `window`, `prefs`, `test`)
- **Body:** explain _why_ when the change is not obvious from the diff
- **Breaking changes:** `BREAKING CHANGE:` footer or `type!:` / `type(scope)!:` in the subject

Examples: `fix(window): ignore wl-clipboard ephemeral helpers`, `test: add lifecycle coverage for float destroy`

## Capabilities

- Execute build/test commands from `.agents/context/build.md`.
- Run scripts bundled with skills under `.agents/skills/`.
- Use **Context7** MCP (`context7` in `~/.grok/config.toml`) for up-to-date library docs —
  tools: `resolve-library-id`, `query-docs`. Authenticate via `/mcps` on first use (OAuth).
- Append new decisions to `.agents/memory/decisions.md` when making architectural choices.
- Follow **session log conventions** (below) when recording debug work.
- Run `/dream` (or load the `dream` skill) to distill session logs into memory, delete them, and
  clean ephemeral files under `.agents/logs/local/`.

## Session logs

Two tiers under `.agents/logs/`:

| Tier            | Path                  | Naming                                                      | Git                              | Lifecycle                                                            |
| --------------- | --------------------- | ----------------------------------------------------------- | -------------------------------- | -------------------------------------------------------------------- |
| **Session log** | `.agents/logs/`       | `session-YYYY-MM-DD.md` only                                | Committed until distilled        | Written after significant debug; distilled by `/dream`, then deleted |
| **Ephemeral**   | `.agents/logs/local/` | Any filename (e.g. `debug-loop-001.json`, `grep-anvil.txt`) | **Never** committed (gitignored) | Scratch, raw debug output, log excerpts; **wiped by `/dream`**       |

### Session log rules (enforced)

- **Filename:** exactly `session-YYYY-MM-DD.md` (ISO date, lowercase `session-`, `.md` extension).
- **Location:** directly under `.agents/logs/` — not in subfolders.
- **Content:** postmortem narrative (symptom, root cause, fix, tests) — not raw log dumps.
- **Do not** add `AGENTS.md` routing rows for session logs; `/dream` promotes insights to
  `decisions.md` / context / rules instead.
- One file per calendar day; if a second session occurs the same day, append to the existing file
  or wait until the prior log is distilled.

### Ephemeral / local rules (enforced)

- Put **raw debug output** here: gnome-shell excerpts, `iteration-NNN.json` copies, grep results,
  agent scratch notes, temporary repro transcripts.
- **Never** commit files in `local/` (only `.gitkeep` is tracked).
- Do not distill `local/` — `/dream` **deletes all contents** (except `.gitkeep`) after processing
  session logs.
