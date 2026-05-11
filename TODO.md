# Project Cleanup Tracking

All major milestones complete. Remaining items are minor polish.

## Completed

- [x] TypeScript conversion — all source files `.js` → `.ts`
- [x] `strict: true` enabled in tsconfig.json
- [x] `noImplicitAny: true`, `noImplicitThis: true`
- [x] `@ts-nocheck` removed from 7 of 8 files (last: permanent third-party CSS parser)
- [x] Type guard for `Node.isWindow()` (`WindowNode` interface)
- [x] Type augmentations for monkey-patched GObject properties (`meta-extensions.d.ts`)
- [x] Metadata module declaration (`prefs-config.d.ts`)
- [x] 200+ function parameter types across source files
- [x] 30 `declare` field declarations in `WindowManager`
- [x] `typescript-eslint` integrated with recommended rules
- [x] `@vitest/eslint-plugin` configured
- [x] `prefer-const` enforced (535 auto-fixes)
- [x] Prettier formatting pass
- [x] Build pipeline: `temp/` → `dist/`, `npm run build` (tsc step)
- [x] `eslint-disable-next-line` comments reference correct rule names
- [x] `windowProps` typed with `WindowConfig`/`WindowOverride` interfaces
- [x] `makeAboutButton` and `SettingsPage` constructor typed with proper types (no `any`)
- [x] `indicator.ts` `_addIndicator()` call typed without `any`
- [x] `keybindings.ts` `modifierState` getter typed without `any`
- [x] Fixed unused eslint-disable for `Meta` import in `tree.ts`

## Current State

| Metric | Value |
|--------|-------|
| `@ts-nocheck` files | 1 (`lib/css/index.ts` — permanent) |
| Lint errors | 0 |
| Lint warnings | 137 (130 documented GObject casts + 7 logger `as any[]` casts) |
| Type errors (strict mode) | 0 |
| Unit tests | 182/182 |
| Build (`make build`) | passes |
| `any` warnings by file | `tree.ts`: ~80, `window.ts`: ~50, `logger.ts`: 7 |

## Remaining Cleanup

| Priority | Item | File(s) | Notes |
|----------|------|---------|-------|
| Low | Logger `as any[]` casts | `lib/shared/logger.ts` | 7 instances. GJS `log()` overloads don't accept `unknown[]`. Use eslint-suppress or accept. |
| Never | `lib/css/index.ts` types | `lib/css/index.ts` | Third-party CSS parser with `@ts-nocheck`. Full typing requires separate project. |
| Never | GObject monkey-patched properties | `tree.ts`, `window.ts` | ~130 documented `any` casts on GObject instances. Adding type augmentation for every property would be brittle (properties change at runtime). |

### Gnome Review Guidelines checklist

Items still pending for GNOME Extensions submission:

- [ ] Review guidelines compatibility audit (see `.opencode/skills/review/SKILL.md`)
- [ ] `extension.ts` constructor compliance (no objects/signals/sources in init)
- [ ] `disable()` fully undoes `enable()` for all signals and main loop sources
- [ ] Copyright headers and license compliance (all source files)
- [ ] `metadata.json` session-modes justification
- [ ] No excessive logging
- [ ] No deprecated module usage
