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

| Change type                   | Must pass                                        |
| ----------------------------- | ------------------------------------------------ |
| Source `.ts` or `.js`         | `typecheck`, `lint`; should also run `test:unit` |
| Unit test `.test.ts`          | `test:unit`, `typecheck`                         |
| E2E suite `.js`               | `make test-e2e`, `typecheck:e2e`                 |
| E2E lib / runner `.js`        | `typecheck:e2e`; should also run `make test-e2e` |
| GSettings schema              | `make test-e2e` (host shell)                     |
| `src/lib/extension/window.ts` | Unit + E2E                                       |

Full test layer documentation: `.agents/skills/testing/SKILL.md`.
