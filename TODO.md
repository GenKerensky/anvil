# TypeScript Strict Mode — Progress Tracking

Goal: enable `strict: true` (and `noImplicitAny: true`, `noImplicitThis: true`) in `tsconfig.json`.

## Overview

| Metric | Current | Target |
|--------|---------|--------|
| `@ts-nocheck` files | 8 | 0 |
| `@typescript-eslint/no-explicit-any` warnings | 34 | 0 |
| `noImplicitAny` in tsconfig | `false` | `true` |
| `noImplicitThis` in tsconfig | `false` | `true` |
| `strict` in tsconfig | `false` | `true` |

## Phase 1: Remove `@ts-nocheck` from extension files

Files currently using `@ts-nocheck` because GObject class fields are assigned dynamically without TS declarations. Each file needs field declarations added and the `@ts-nocheck` directive removed.

- [ ] `lib/extension/window.ts` — largest file (~2900 lines). Many `this.property = value` assignments need field declarations.
- [ ] `lib/extension/tree.ts` — Node class with polymorphic `_data` field.
- [ ] `lib/extension/keybindings.ts` — keybinding registration callbacks and grabber storage.
- [ ] `lib/extension/indicator.ts` — `this.extension`, `this._indicator`, `this.menu` etc.
- [ ] `lib/extension/extension-theme-manager.ts` — `this.configMgr`, `this.stylesheet`, etc.
- [ ] `lib/shared/theme.ts` — CSS property access and file I/O.
- [ ] `lib/prefs/floating.ts` — floating window override management.

### Already handled
- [x] `lib/css/index.ts` — third-party CSS parser (kept `@ts-nocheck`, excluded from strict rules)

## Phase 2: Eliminate `any` usages

34 `@typescript-eslint/no-explicit-any` warnings across source files (lint passes, warnings only).

### By file

| File | Count | Notes |
|------|-------|-------|
| `extension.ts` | 16 | `global as any`, `null as any` for cleanup, `extWm as any` for property access |
| `lib/prefs/appearance.ts` | 5 | `settings!: any`, `themeMgr!: any`, `as any` casts |
| `prefs.ts` | 4 | `as any` casts for page constructors |
| `lib/extension/utils.ts` | 2 | `createEnum` internal, `actor.type` cast |
| `lib/extension/window.ts` | 2 | `windowProps: any` declaration, proxy callback |
| `lib/prefs/widgets.ts` | 2 | `rgba` parse cast, `settings` dynamic access |
| `lib/prefs/prefs-theme-manager.ts` | 1 | `settings!: any` |
| `lib/shared/theme.ts` | 1 | `getDefaults(color: any)` parameter |

### Strategy
- `as any` casts with known types → replace with proper type assertions
- `!: any` field declarations → add proper `@girs` types (e.g. `Gio.Settings`)
- `windowProps: any` → define a proper interface for window config objects

## Phase 3: Enable `noImplicitAny`

Once `@ts-nocheck` files are cleaned up and `any` usages are eliminated:

- [ ] Set `"noImplicitAny": true` in `tsconfig.json`
- [ ] Set `"noImplicitThis": true` in `tsconfig.json`
- [ ] Add `declare function log(msg: string, ...args: unknown[]): void` ambient declaration for GJS globals
- [ ] Add `declare function logError(e: unknown, msg?: string): void`
- [ ] Add `declare function print(msg: string): void`
- [ ] Fix all new type errors that emerge from `noImplicitAny` + `noImplicitThis`

## Phase 4: Enable `strict`

- [ ] Set `"strict": true` in `tsconfig.json`
- [ ] Fix any remaining type errors
- [ ] Remove `@ts-nocheck` from `lib/css/index.ts` if feasible (add type declarations for the parser)
- [ ] Set `eslint.config.js` to `"@typescript-eslint/no-explicit-any": "error"` (zero tolerance)
- [ ] Set `eslint.config.js` to remove `@ts-nocheck` file overrides

## Dependencies

- Phase 2 depends on Phase 1 (can't fix `any` in files that are `@ts-nocheck`d)
- Phase 3 can partially overlap with Phase 2
- Phase 4 depends on Phases 1-3
