---
name: dream
description: >
  Distill `.agents/logs/session-*.md` into durable project knowledge (context, decisions, rules,
  new skills), update AGENTS.md routing, delete processed session logs, and wipe
  `.agents/logs/local/` ephemeral files. Skip or delete logs with nothing worth keeping. Use when
  the user runs /dream, asks to distill or consolidate session logs, promote session notes to
  memory, or clean up `.agents/logs/` after debugging.
license: MIT
compatibility: agents
---

# Dream — Distill Session Logs

Turn ephemeral debug narratives into durable agent infrastructure, then **delete the source log**.

Execute this workflow yourself. Do not tell the user to run steps unless they ask.

## When to run

- After a significant debug session log was written to `.agents/logs/`
- User runs `/dream` or asks to consolidate, distill, or clean session logs
- Before a release or when `.agents/logs/` has stale entries

## Inputs

| Path                                 | Role                                                                   |
| ------------------------------------ | ---------------------------------------------------------------------- |
| `.agents/logs/session-YYYY-MM-DD.md` | Distillable narratives (strict naming per `AGENTS.md`)                 |
| `.agents/logs/local/`                | Ephemeral scratch — **not distilled**; wiped at end of every dream run |

List candidates:

```bash
.agents/skills/dream/scripts/list-session-logs.sh
```

Process **oldest first** unless the user names a specific file.

## Distillation targets

Read `references/distillation-rubric.md` before editing any target file.

| Target        | Path                             | What belongs here                                             |
| ------------- | -------------------------------- | ------------------------------------------------------------- |
| **Decisions** | `.agents/memory/decisions.md`    | Durable policies, trade-offs, “we always/never do X”          |
| **Context**   | `.agents/context/*.md`           | Thin pointers, environment facts, seam summaries (not essays) |
| **Rules**     | `.agents/rules/*.md`             | Workflow gates, pitfalls, conventions agents must follow      |
| **Skills**    | `.agents/skills/<name>/SKILL.md` | Repeatable multi-step workflows worth a dedicated skill       |
| **Routing**   | `AGENTS.md`                      | Add/remove context-routing rows; add skill table entries      |

**Do not** duplicate content already present — merge or skip. Prefer **append** with dated section headers in `decisions.md`.

## Quality bar (keep vs discard)

**Distill** when the insight is:

- Reusable across future tasks (not a one-off hypothesis)
- Non-obvious (would save rediscovery time)
- Verifiable (matches code or committed tests)

**Do not distill** (delete log only):

- Narrative of work already fully captured in git commits
- Duplicate of existing `decisions.md` / rules / context bullets
- Stale hypotheses marked wrong in the log
- Environment-specific noise (one machine, one run)

If the entire log fails the bar → **delete the log**, report `no distillate`, move on.

## Per-log workflow

For each `session-YYYY-MM-DD.md`:

### 1. Read and inventory

Read the full log. Scan existing:

- `.agents/memory/decisions.md`
- `.agents/context/`
- `.agents/rules/`
- `.agents/skills/*/SKILL.md`
- `AGENTS.md` routing table

Build a short inventory: proposed bullets per target, or `EMPTY`.

### 2. Apply distillate

If non-empty:

1. **decisions.md** — new `## <Topic> (YYYY-MM-DD)` section or bullets under existing section
2. **context/** — minimal edits; keep files thin; link to skills for depth
3. **rules/** — new pitfall sections or new rule file only if substantial
4. **skills/** — create new skill only when a **repeatable workflow** emerges (use create-skill patterns: `SKILL.md` + optional `scripts/`, `references/`)
5. **AGENTS.md** — add skill row; **remove** context-routing rows that pointed at the session log being deleted; replace with pointer to `decisions.md` or context file if needed

### 3. Delete the log

```bash
git rm .agents/logs/session-YYYY-MM-DD.md
```

Never leave processed logs in the tree.

### 4. Report

Per log, emit:

```text
## dream: session-YYYY-MM-DD.md
- decisions: <N bullets added | none>
- context: <files touched | none>
- rules: <files touched | none>
- skills: <created/updated names | none>
- AGENTS.md: <routing changes | none>
- log: deleted
```

## Clean ephemeral logs

After all session logs are processed, wipe `.agents/logs/local/`:

```bash
.agents/skills/dream/scripts/clean-local-logs.sh
```

Deletes every file under `local/` except `.gitkeep`. Report count of files removed. Do not distill or read local files unless a session log explicitly references one — then capture the lesson in the session log distillate, not the raw file.

## Batch completion

After all logs and local cleanup:

1. Run `npm run typecheck` and `npm run lint` if any `.ts`/`.js` under `src/` or `test/` was touched (unlikely for distill-only)
2. Run `npx markdownlint-cli2` on edited markdown if available
3. Commit with Conventional Commits:

```text
chore(agents): dream distill session logs into memory

Distilled session-2026-06-26.md → decisions (window lifecycle).
Removed processed session logs.
```

## Guardrails

- **Never** delete logs without reading them first
- **Always** run `clean-local-logs.sh` at end of every dream run (even when no session logs existed)
- **Never** expand scope into unrelated refactors
- **Never** keep session logs “for reference” after distilling — the whole point is deletion
- If a log describes fixes **not yet in code**, note that in the report and in `decisions.md` as open follow-up; still delete the log only after capturing the architectural lesson (not the implementation checklist)
- If unsure whether content is duplicate, prefer **skip** over repeat

## Bundled scripts

| Script                         | Purpose                                                      |
| ------------------------------ | ------------------------------------------------------------ |
| `scripts/list-session-logs.sh` | List distillable session logs (`session-YYYY-MM-DD.md` only) |
| `scripts/clean-local-logs.sh`  | Delete all ephemeral files under `local/` (keeps `.gitkeep`) |
