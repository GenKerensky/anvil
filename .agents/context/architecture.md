# Source Architecture

```
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

Four tsconfigs, each targeting a distinct layer. E2E and integration share a GJS base so they
don't inherit the main source's `rootDir: "./src"`.

| Config                      | Extends             | `rootDir` | Purpose                              |
| --------------------------- | ------------------- | --------- | ------------------------------------ |
| `tsconfig.json`             | —                   | `./src`   | Main source → `dist/`                |
| `tsconfig.gjs-base.json`    | —                   | `.`       | Shared GJS test compiler options     |
| `tsconfig.test.json`        | `tsconfig.json`     | `.`       | Unit tests (Node.js/vitest)          |
| `tsconfig.e2e.json`         | `tsconfig.gjs-base` | `.`       | E2E automation scripts               |
| `tsconfig.integration.json` | `tsconfig.gjs-base` | `.`       | Integration specs                    |
| `test/tsconfig.json`        | `tsconfig.gjs-base` | `.`       | IDE discoverability (not used in CI) |

`test/tsconfig.json` is not run in CI — it exists so the LSP can resolve types under `test/`.

Source in `src/lib/shared/*.ts` → tests in `test/unit/shared/*.test.ts`.
Source in `src/lib/extension/*.ts` → tests in `test/unit/extension/*.test.ts`.

## Test layout (summary)

| Layer           | Runtime                         | Framework                       | Location            |
| --------------- | ------------------------------- | ------------------------------- | ------------------- |
| **Unit**        | Node.js (vitest)                | vitest + hand-written GJS mocks | `test/unit/`        |
| **Integration** | Podman → gnome-shell --headless | Jasmine via jasmine-gjs         | `test/integration/` |
| **E2E**         | Host → gnome-shell --headless   | Custom describe/it/assert       | `test/e2e/`         |

For full test documentation, read `.agents/skills/testing/SKILL.md`.
