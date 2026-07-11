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

## Target seams / freeze

`WindowManager` (`window.ts`) is a **frozen facade** for new features — see
`.agents/rules/architecture.md` (rules 1–4) and `codebase-review.md` F3–F5.

| Seam (today)              | Notes                                                           |
| ------------------------- | --------------------------------------------------------------- |
| `window/actions.ts`       | `AnvilAction` union; all user commands are data                 |
| `WindowManager.command()` | In-WM handler registry → private handlers                       |
| `rules-engine.ts`         | Float/tile rules + override CRUD (`RulesEngine`)                |
| `window-tracker.ts`       | Admit / destroy / pending track / lifecycle signals             |
| `layout-engine.ts`        | Focus/move/swap/split + percent math + auto-split               |
| `grab-resize-session.ts`  | Grab begin/end, live resize, keyboard resize, exemption map     |
| `tab-decoration.ts`       | Tab strip + tabbed container St UI (not in tree.ts)             |
| `keybinding-table.ts`     | Schema key → AnvilAction table                                  |
| `settings-bridge.ts`      | GSettings changed → host handler map                            |
| `TilingRender`            | Sole geometry owner (gaps, constraints, frames); no WM wrappers |
| `Tree`                    | Structure only; **TreeHost** (no WindowManager import)          |
| `PointerPolicy`           | Hover / warp                                                    |

New behavior goes in new modules and is wired from the facade — do not grow `window.ts`.

## Test layout (summary)

| Layer    | Runtime                       | Framework                       | Location     |
| -------- | ----------------------------- | ------------------------------- | ------------ |
| **Unit** | Node.js (vitest)              | vitest + hand-written GJS mocks | `test/unit/` |
| **E2E**  | Host → gnome-shell --headless | Jasmine via jasmine-gjs         | `test/e2e/`  |

For full test documentation, read `.agents/skills/testing/SKILL.md`.
