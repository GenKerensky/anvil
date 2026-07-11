# Anvil Debug Workflow

Extension UUID: `anvil@GenKerensky.github.com`

## Quick path

1. **Build + install:** `make dev` or `make build debug`
2. **Interactive test:** `.agents/skills/gnome-shell-debug/scripts/run-devkit-session.sh` (see Devkit Seam in [SKILL.md](../SKILL.md))
3. **Host logs:** `journalctl -f -o cat /usr/bin/gnome-shell | grep -i anvil`
4. **Looking Glass:** `lg` → Extensions → Anvil → Errors
5. **Unit tests (no shell):** `npm run test:unit`
6. **Automated tests:** `npm run test:unit`, `make test-e2e` (host headless)

## Source layout

| Path                       | Role                         |
| -------------------------- | ---------------------------- |
| `src/extension.ts`         | Extension entry              |
| `src/lib/extension/`       | Tiling WM core               |
| `src/lib/shared/logger.ts` | Project logger               |
| `dist/`                    | Compiled output (gitignored) |

## Debug build

`quick-debug-build.sh` sets `production = false` in `dist/lib/shared/settings.js` for verbose Anvil logging. Normal path: `make build debug`.

## When logs are not enough

1. Reproduce in isolated devkit (`run-devkit-session.sh --keep-temp`)
2. Grep session log for Anvil lines
3. Use Looking Glass evaluator on `Meta.Window` / focus state
4. For crashes: GDB + `gjs_dumpstack()` (see Rare paths in [SKILL.md](../SKILL.md))
