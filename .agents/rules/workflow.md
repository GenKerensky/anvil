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

| Change type                                 | Must pass                                        |
| ------------------------------------------- | ------------------------------------------------ |
| Source `.ts` or `.js`                       | `typecheck`, `lint`; should also run `test:unit` |
| Unit test `.test.ts`                        | `test:unit`, `typecheck`                         |
| E2E suite `.js`                             | `typecheck:e2e`; full or dedicated E2E target    |
| E2E lib / runner `.js`                      | `typecheck:e2e`; should also run `make test-e2e` |
| GSettings schema                            | `make test-e2e` (host shell)                     |
| `anvil-runtime.ts` structural refactor only | `test:unit` (+ typecheck/lint); E2E optional     |
| `anvil-runtime.ts` behavior change          | Unit; E2E recommended for Meta lifecycle paths   |

Full test layer documentation: `.agents/skills/testing/SKILL.md`.

An isolation-sensitive suite may use its documented dedicated Make target instead of the shared
`make test-e2e` process only when the suite is explicitly tag-gated, the target starts a fresh
Shell, and the source records the native/process-isolation reason. This exception currently covers
monitor churn and cross-surface swap. The full suite remains the pre-release gate; it is not a
substitute for either dedicated multi-monitor target.
