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

| Seam (today)             | Notes                                                          |
| ------------------------ | -------------------------------------------------------------- |
| `anvil-runtime.ts`       | Shell facade; free to refactor; prefer logic in owner modules  |
| `window/actions.ts`      | `AnvilAction` union; all user commands are data                |
| `command-bus.ts`         | Named handler table; `AnvilRuntime.command()` delegates        |
| `command-handlers.ts`    | Handler implementations + `createCommandHandlers()` factory    |
| `drag-drop-tile.ts`      | Drag-drop tiling preview and placement logic                   |
| `signal-manager.ts`      | Global signal bind/unbind + workspace timeout                  |
| `workspace-mutations.ts` | Workspace tree mutations + float/unfloat helpers               |
| `render-scheduler.ts`    | Idle-coalesced render/reload scheduling + freeze protocol      |
| `decoration-layout.ts`   | Tab/con show/hide per workspace                                |
| `rules-engine.ts`        | Float/tile rules + override CRUD + classification cache        |
| `window-tracker.ts`      | `admitWindow` / destroy pipeline / reconcile backoff           |
| `layout-engine.ts`       | Focus/move/swap/split + percent math + `setLayout`             |
| `focus-controller.ts`    | Directional focus + stacked/tabbed focus helpers               |
| `grab-resize-session.ts` | Grab begin/end, Wayland live poll, keyboard resize, exemptions |
| `border-controller.ts`   | Focus / split border actors                                    |
| `tree-presentation.ts`   | Production Tree actors, tabs/decorations, and drag preview     |
| `keybinding-table.ts`    | Schema key → AnvilAction table                                 |
| `settings-bridge.ts`     | GSettings changed → host handler map (prefs→shell bus)         |
| `TilingRender`           | Sole geometry owner (gaps, constraints, frames)                |
| `Tree`                   | Structure only; **TreeHost** (no AnvilRuntime import)          |
| `PointerPolicy`          | Always constructed; hover/warp enable via settings             |
| `utils/*`                | geometry / window-filters / decorations / version              |

## Tree / render invariants (B5)

1. **Every WINDOW has a MONITOR ancestor** (workspace → monitor → … → window).
2. **After `redistributeSiblingPercent`, tiled sibling percents sum to ~1.**
   Unset percent is `undefined` (equal share in `computeSizes`); do not use `0` for unset.
3. **FLOAT windows may exist in the tree but skip size compute** (`processFloats` / mode).
4. **Frame geometry is written only by TilingRender** (constraints clamp applied rects, not percents).
5. **User actions are `AnvilAction` data** handled by CommandBus — no open-coded switches.

## Test layout (summary)

| Layer    | Runtime                       | Framework                       | Location     |
| -------- | ----------------------------- | ------------------------------- | ------------ |
| **Unit** | Node.js (vitest)              | vitest + hand-written GJS mocks | `test/unit/` |
| **E2E**  | Host → gnome-shell --headless | Jasmine via jasmine-gjs         | `test/e2e/`  |

For full test documentation, read `.agents/skills/testing/SKILL.md`.
