# Architecture Rules (enforceable)

PR checklist for tiling-core work. Full findings and later stages: `codebase-review.md`
(F3–F5). These four rules are **adopted** (F5 Stage 0) and must be followed on every change.

## 1. Lifecycle purity

- No Meta/Shell side effects outside `enable()`.
- Every `enable()` side effect has a `disable()` inverse (signals, actors, timeouts, keybinding overrides).
- Constructor may set up translations and fields only — no signal connects, no UI, no Shell mutation.

## 2. One owner per state

| Concern                   | Owner today                                           | Target (do not invent a second owner) |
| ------------------------- | ----------------------------------------------------- | ------------------------------------- |
| Tree structure / percents | structure: `Tree` + **TreeHost**; ops: `LayoutEngine` | done Stage 5–7                        |
| Frame geometry apply      | `TilingRender`                                        | RenderPipeline (`TilingRender+`)      |
| Meta signal connects      | `WindowTracker` (lifecycle) + residual on WM          | WindowTracker only (progressive)      |

Do **not** add a new write path for frames, percents, or Meta listeners outside the current owner.

## 3. Commands are data

- All user actions are **`AnvilAction`** values (`src/lib/extension/window/actions.ts`).
- Dispatch goes through `WindowManager.command()` and its **in-WM handler registry**.
- **Do not** add a new `case` to a mega-switch. Register a new handler (and extend the
  `AnvilAction` union) instead.
- Keybindings and tests build action objects; they do not call layout internals directly.

## 4. Freeze `window.ts` growth

- **`src/lib/extension/window.ts` is frozen for new features.**
- New behavior lands in **new modules**; WM only wires / delegates.
- **No new public methods** or feature logic on `WindowManager` without first extracting an
  existing cluster (commands, tracker, rules, grab-resize, etc.).
- Soft module budget elsewhere: **~500 LOC** per file — split when exceeded.
- Mechanical moves that shrink or restructure existing WM code (e.g. typed registry) are allowed;
  net new feature surface is not.

## Progress on later rules

- **Rule 6 (rules are data) — partial:** float/tile decisions go through **`RulesEngine`**
  (`src/lib/extension/rules-engine.ts`). Built-ins remain code-backed; JSON overrides + title
  grammar live there. Do not add a second classification path on `WindowManager`.
- **Rule 2 (geometry) — Stage 3:** frame gaps/constraints/apply live only on **`TilingRender`**.
  Do not add `calculateGaps` / `processFloats` / `enforceUltrawideSize` (or monitor constraint)
  methods back onto `WindowManager`. Use `wm.tilingRender`.
- **Rule 2 (lifecycle signals) — Stage 4:** window admit/destroy and per-window Meta lifecycle
  connects live on **`WindowTracker`**. Do not add parallel track paths on WM; use facades only.
- **Rule 2 (layout ops) — Stage 5:** split/move/swap/focus and sibling percents live on
  **`LayoutEngine`**. Prefer `wm.layoutEngine`; Tree delegates remain for compatibility.
- **Rule 2 / async settlement — Stage 6:** grab/live resize and resize-exemption map live on
  **`GrabResizeSession`**. Do not add parallel grab loops on WM; use facades.
- **Rule 12 — Stage 7:** `tree.ts` must not import `WindowManager`. Use **TreeHost**. Tab St UI
  lives in **`tab-decoration.ts`**. Layout ops only via **LayoutEngine**.
- **Stage 8:** New keybindings go in **`KEYBINDING_TABLE`** (not ad-hoc lambdas). New GSettings
  reactions go in **`SettingsBridge`** handlers (not a switch on `WindowManager`).
- **CommandBus (residual):** Dispatch only via **`CommandBus` / `WindowManager.command()`**. Do
  not add open-coded switches for user actions.
- **Rule 7 (types):** No new public `any` on APIs; Meta patches only in `window/types.ts`.
