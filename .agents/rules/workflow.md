# Agent Workflow

## After finishing a `.ts` or `.js` change

Run this before considering the task complete:

```bash
npm run test # run lint, typecheck and unit tests, must pass with 0 errors
```

fix errors before proceeding.

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
