# Dream Distillation Rubric

Where each kind of knowledge goes after reading a session log.

## decisions.md

**Add** durable architectural choices and domain policies.

Examples:

- “Meta.Window monitor/workspace are unstable at `window-created` — sanitize or use backup path”
- “Agent loop uses launcher-style XDG, not E2E host dconf”
- “Resize exemption requires `_resizedWindows` count ≥ 2”

Format: bullet under a themed `##` section; include date parenthetical when the section is new.

**Do not add**: step-by-step debug narrative, file:line inventories, test run tables.

## context/

**Add** only when a thin pointer file would help routing — not long prose.

| File              | Use for                                                |
| ----------------- | ------------------------------------------------------ |
| `overview.md`     | Project identity changes (rare)                        |
| `build.md`        | New build/install commands                             |
| `architecture.md` | New module seams, directory layout                     |
| `debugging.md`    | New debug entrypoints, seam summaries (link to skills) |

Keep each edit ≤5 lines. Move depth to skills.

## rules/

**Add** when agents must follow a new gate or avoid a new pitfall.

| File                | Use for                                       |
| ------------------- | --------------------------------------------- |
| `workflow.md`       | Test/lint gates, completion checklist         |
| `gjs-automation.md` | Automation-script pitfalls                    |
| `conventions.md`    | Naming, paths, UUID                           |
| New `*.md`          | Only if ≥10 bullets and no existing file fits |

## skills/

**Create** a new skill when:

- The workflow has ≥3 steps agents repeat
- It needs scripts, references, or guardrails beyond a rule file
- It is domain-specific (tiling, prefs, debug loop, testing)

**Do not create** a skill for one-off fixes or single commands.

Minimum new skill layout:

```text
.agents/skills/<name>/
  SKILL.md
  scripts/      # optional
  references/   # optional
```

Register in `AGENTS.md` skills table.

## AGENTS.md routing

| Action                                         | When                                           |
| ---------------------------------------------- | ---------------------------------------------- |
| **Remove** row pointing to `session-*.md`      | Always, when that log is deleted               |
| **Add** row pointing to `decisions.md` section | When distilled insight is historical reference |
| **Add** skill row                              | When a new skill is created                    |

Never keep routing rows to deleted session logs.

## local/ (ephemeral)

Never distill. `/dream` runs `clean-local-logs.sh` to delete all files except `.gitkeep`.
Agents write raw debug output here per `AGENTS.md` session log conventions.

## Delete-only logs

Delete without editing targets when the log:

- Restates git commit messages
- Documents failed approaches with no lesson
- Duplicates existing memory verbatim
- Is empty or placeholder

Report: `no distillate — deleted`.
