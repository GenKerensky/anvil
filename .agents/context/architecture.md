# Source Architecture

```text
src/
  extension.ts          # Entry point loaded by GNOME Shell
  prefs.ts              # Preferences window entry point
  ambient.d.ts          # Type declarations
  stylesheet.css        # Shell theme overrides
  lib/
    extension/          # Core tiling: tree, windows, keybindings, utils, theme
    shared/             # Shared between extension + prefs: logger, settings, theme
    prefs/              # Preferences UI (metadata.js is gitignored + auto-generated)
    css/                # CSS parsing (@ts-nocheck — third-party library)
  config/windows.json   # Default window override config
  po/                   # Translation files (POT, PO, MO)
  resources/            # Static assets (icons)
  schemas/              # GSettings schemas
  types/                # TypeScript declaration files
```

## tsconfig hierarchy

Project references target source, unit, and E2E. E2E extends a GJS base so it does not
inherit the main source's `rootDir: "./src"`.

| Config                   | Extends             | `rootDir` | Purpose                          |
| ------------------------ | ------------------- | --------- | -------------------------------- |
| `tsconfig.json`          | —                   | —         | Solution file (references only)  |
| `tsconfig.src.json`      | —                   | `./src`   | Main source → `dist/`            |
| `tsconfig.gjs-base.json` | —                   | `.`       | Shared GJS test compiler options |
| `tsconfig.unit.json`     | —                   | `.`       | Unit tests (Node.js/vitest)      |
| `tsconfig.e2e.json`      | `tsconfig.gjs-base` | `.`       | E2E automation scripts           |

Source in `src/lib/shared/*.ts` → tests in `test/unit/shared/*.test.ts`.
Source in `src/lib/extension/*.ts` → tests in `test/unit/extension/*.test.ts`.
Platform-independent tiling state lives in `src/lib/tiling/`; its migration contract and current
legacy/shadow/core ownership modes are defined in
`docs/plans/portable-tiling-state-machine.md`.

## Target seams

Enforceable rules: **`.agents/rules/architecture.md`**. Read that before tiling-core work.

`anvil-runtime.ts` / `AnvilRuntime` is the shell-facing entry today. **Big-bang refactors of it are
allowed** (split, rewrite, rename) as long as ownership (§2) and behavior/tests hold.

| Seam (today)                   | Notes                                                                    |
| ------------------------------ | ------------------------------------------------------------------------ |
| `anvil-runtime.ts`             | Shell facade, lifecycle graph, engine selection, and typed action router |
| `window/actions.ts`            | `AnvilAction` union; all user commands are data                          |
| `command-bus.ts`               | Named legacy/shadow handler table                                        |
| `command-handlers.ts`          | Legacy/shadow handlers + `createCommandHandlers()` factory               |
| `core-platform-commands.ts`    | Core-mode platform effects plus named portable observation hooks         |
| `drag-drop-tile.ts`            | Drag-drop tiling preview and placement logic                             |
| `signal-manager.ts`            | Global/workspace signal bind/unbind + workspace timeout                  |
| `legacy-workspace-topology.ts` | GNOME workspace/monitor discovery, legacy identities, and reindexing     |
| `workspace-mutations.ts`       | Workspace tree mutations + float/unfloat helpers                         |
| `render-scheduler.ts`          | Idle-coalesced render/reload scheduling + freeze protocol                |
| `decoration-layout.ts`         | Tab/con show/hide per workspace                                          |
| `rules-engine.ts`              | Float/tile rules + override CRUD + classification cache                  |
| `window-tracker.ts`            | `admitWindow` / destroy pipeline / reconcile backoff                     |
| `layout-engine.ts`             | Focus/move/swap/split + percent math + `setLayout`                       |
| `focus-controller.ts`          | Directional focus + stacked/tabbed focus helpers                         |
| `grab-resize-policy.ts`        | Pure adjacent-candidate and percent-plan calculation                     |
| `grab-resize-session.ts`       | Grab phases, Wayland live poll, snapshots, percent apply, and cleanup    |
| `border-controller.ts`         | Focus / split border actors                                              |
| `tree-presentation.ts`         | Production Tree actors, tabs/decorations, and drag preview               |
| `keybinding-table.ts`          | Schema key → AnvilAction table                                           |
| `settings-bridge.ts`           | GSettings changed → host handler map (prefs→shell bus)                   |
| `TilingRender`                 | Tiled rect derivation/policy: gaps, constraints, and render plans        |
| `GnomeWindowOperations`        | General shell frame moves and monitor-space projection                   |
| `Tree`                         | Structure only; **TreeHost** (no AnvilRuntime import)                    |
| `PointerPolicy`                | Always constructed; hover/warp enable via settings                       |
| `utils/*`                      | geometry / window-filters / decorations / version                        |

Command routing is mode-specific. Legacy and shadow modes optionally observe the typed action and
then dispatch it through `CommandBus`. Core mode sends platform-owned actions to
`CorePlatformCommands`; those actions bypass generic `observeCommand` and `CommandBus`, while named
typed observation hooks may still update portable state. Remaining core actions use the portable
`observeCommand` route and fail closed when unsupported.

TilingRender owns tiled rectangle derivation, gaps, and constraints, and calls the injected
`GnomeWindowOperations` move seam to apply a derived frame. Lifecycle-specific Meta effects stay
with the owner whose ordering they implement: portable intention application,
active-Grab-Resize positioning, and admission-time unmaximize are not general shell move paths.

## Tree / render invariants (B5)

1. **Every WINDOW has a MONITOR ancestor** (workspace → monitor → … → window).
2. **After `redistributeSiblingPercent`, tiled sibling percents sum to ~1.**
   Unset percent is `undefined` (equal share in `computeSizes`); do not use `0` for unset.
3. **FLOAT windows may exist in the tree but skip size compute** (`processFloats` / mode).
4. **Tiled frame geometry is derived only by TilingRender**; constraints clamp requested rects,
   not percents, and general imperative frame application is delegated to
   `GnomeWindowOperations`.
5. **User actions are `AnvilAction` data** routed to `CommandBus` in legacy/shadow mode or the core
   platform/portable handlers in core mode — no cross-engine fallthrough.

## Test layout (summary)

| Layer    | Runtime                       | Framework                       | Location     |
| -------- | ----------------------------- | ------------------------------- | ------------ |
| **Unit** | Node.js (vitest)              | vitest + hand-written GJS mocks | `test/unit/` |
| **E2E**  | Host → gnome-shell --headless | Jasmine via jasmine-gjs         | `test/e2e/`  |

For full test documentation, read `.agents/skills/testing/SKILL.md`.
