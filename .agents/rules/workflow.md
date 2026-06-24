# Agent Workflow

## After every `.ts` or `.js` source file change

Run in order before considering the task complete:

```bash
npm run typecheck    # must pass with 0 errors
npm run lint         # must pass with 0 errors
```

If either fails, fix errors before proceeding. Acceptable warnings only:

- `@typescript-eslint/no-explicit-any` (tracked in `TODO.md`)
- `eslint-disable` mismatches on files being converted from `@ts-nocheck`

## Comment preservation

When editing existing source, preserve original comments (copyright headers, section markers,
JSDoc, `@deprecated`, TODO notes) unless factually wrong or superseded.

## Test gates by change type

| Change type                   | Must pass                                                         |
| ----------------------------- | ----------------------------------------------------------------- |
| Source `.ts` or `.js`         | `typecheck`, `lint`; should also run `test:unit`                  |
| Unit test `.test.ts`          | `test:unit`, `typecheck`                                          |
| Integration spec `.js`        | `make test-integration` (Fedora 44), `typecheck:integration`      |
| E2E suite `.js`               | `make test-e2e`, `typecheck:e2e`                                  |
| E2E lib `.js`                 | `typecheck:e2e`; should also run `make test-e2e`                  |
| Integration runner `.js`      | `typecheck:integration`; should also run `make test-integration`  |
| GSettings schema              | `make test-integration FEDORA_VERSION=44`; should also `test-e2e` |
| `src/lib/extension/window.ts` | All three test layers                                             |

Full test layer documentation: `.agents/skills/testing/SKILL.md`.
