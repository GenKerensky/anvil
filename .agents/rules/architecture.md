# Architecture Rules (enforceable)

**Authority:** Synthesized from `codebase-review.md` (F3 target shape, F4 rules 1–12, extractions F5 + residual 9–21). Agents **must** follow these rules on every tiling-core change.

**Related (load when needed):**

| Need                                   | Read                              |
| -------------------------------------- | --------------------------------- |
| Source layout / seams map              | `.agents/context/architecture.md` |
| Ubiquitous language                    | `CONTEXT.md`                      |
| Historical ADRs / extraction notes     | `.agents/memory/decisions.md`     |
| Full review narrative (reference only) | `codebase-review.md`              |
| Finish-change gates                    | `.agents/rules/workflow.md`       |

---

## 0. Mental model (do not violate)

```text
Meta event  → WindowTracker  → LayoutEngine (mutate tree)
                             → TilingRender  (apply frames)
Keybinding  → CommandBus     → Layout / Rules / Settings / Focus
GSettings   → SettingsBridge → affected modules only
Prefs write → GSettings / windows.json reload trigger → shell reacts
```

| Role                        | Module(s)                                                                |
| --------------------------- | ------------------------------------------------------------------------ |
| Shell facade / public API   | `window.ts` (`WindowManager`) — may be refactored or split freely        |
| Typed user actions          | `window/actions.ts` + `command-bus.ts`                                   |
| Float/tile rules            | `rules-engine.ts`                                                        |
| Window admit/destroy        | `window-tracker.ts` (`admitWindow`)                                      |
| Tree structure              | `tree.ts` + **TreeHost** (no `WindowManager` import)                     |
| Layout algebra + percents   | `layout-engine.ts`                                                       |
| Focus entry                 | `focus-controller.ts` (+ `LayoutEngine.focus`)                           |
| Frame geometry              | `tiling-render.ts`                                                       |
| Borders                     | `border-controller.ts`                                                   |
| Tab UI                      | `tab-decoration.ts`                                                      |
| Grab / live resize          | `grab-resize-session.ts`                                                 |
| Pointer hover/warp          | `pointer-policy.ts` (always constructed)                                 |
| Keybindings                 | `keybinding-table.ts` → `keybindings.ts`                                 |
| Settings reactions          | `settings-bridge.ts`                                                     |
| Session flags               | `window/session-flags.ts`                                                |
| Pure helpers                | `utils/geometry.ts`, `window-filters.ts`, `decorations.ts`, `version.ts` |
| Shell entry / prefs process | `extension.ts` / `prefs.ts` — **never mix Meta into prefs**              |

---

## 1. Lifecycle purity

- No Meta / Shell / Clutter side effects outside `enable()` (and paired subsystem `enable`s).
- Every `enable()` effect has a `disable()` inverse: signals, actors, GLib sources, keybinding
  overrides, GSettings overrides.
- Constructors: fields and wiring only — no signal connects, no UI creation, no Shell mutation.
- Extension subsystem fields are honest nulls while disabled (private `_x` + throwing getters);
  do **not** reintroduce `null as unknown as T` on disable.
- `WindowManager.enable()` sets `disabled = false`; `disable()` sets `disabled = true`.
- Wire subsystems after construction (`wireKeybindings`); getters must not lazy-create
  Keybindings or other heavy objects.

---

## 2. One owner per state

Do **not** invent a second write path.

| Concern                            | Sole owner                                         | Forbidden                                                   |
| ---------------------------------- | -------------------------------------------------- | ----------------------------------------------------------- |
| Tree structure                     | `Tree` + TreeHost                                  | Tracker/commands mutating tree without LayoutEngine for ops |
| Sibling percents                   | `LayoutEngine`                                     | Ad-hoc `percent` outside layout/grab session math           |
| Frame geometry (move/resize apply) | `TilingRender`                                     | `move()` from random command paths for tiling layout        |
| Float/tile classification          | `RulesEngine`                                      | Parallel `isFloatingExempt` logic on WM                     |
| Window admit / destroy             | `WindowTracker` (`admitWindow` / destroy pipeline) | New Meta track entry that bypasses `admitWindow`            |
| Grab session + resize exemption    | `GrabResizeSession`                                | New 16ms grab loops or exemption maps on WM                 |
| Focus borders / split hints        | `BorderController`                                 | New border actors created outside controller                |
| Tab strip UI                       | `tab-decoration.ts`                                | Building St tabs inside `tree.ts`                           |
| Directional focus helpers          | `FocusController`                                  | Duplicating stacked/tabbed raise logic in command handlers  |
| GSettings reactions                | `SettingsBridge`                                   | Mega-`switch (key)` on WM                                   |
| User command dispatch              | `CommandBus` via `WindowManager.command()`         | New open-coded `switch (action.name)`                       |

**Render scheduling:** idle coalesce, freeze, and tiling-mode gate may live on the shell entry
that calls `TilingRender` (today: `WindowManager.renderTree`). Geometry **apply** stays on
`TilingRender`.

---

## 3. Commands are data

- All user actions are **`AnvilAction`** values (`src/lib/extension/window/actions.ts`).
- Dispatch: `wm.command(action)` → **`CommandBus.dispatch`** (or successor registry).
- Adding a command:
  1. Extend the `AnvilAction` union.
  2. Register a handler on `CommandBus` / `CommandBusHost`.
  3. Add a row to `KEYBINDING_TABLE` if user-facing.
  4. Add unit coverage for the action.
- Keybindings and tests **build action objects**; they do not call layout internals directly.
- Prefer a single action + enum field over near-duplicate names (e.g. `WindowResize` +
  `direction`, not four `WindowResize*` names).
- No `command({ name: "Split" })` re-entry from track/admit — use `LayoutEngine` / policy APIs.

---

## 4. Module budget — `window.ts` may be refactored freely

**Big-bang refactors of `src/lib/extension/window.ts` are allowed and encouraged** when they
preserve behavior and the ownership rules in §2. Do **not** treat historical “freeze growth”
or “incremental only” guidance as a ban.

- Prefer landing durable logic in the owner modules (tracker, layout, render, rules, …).
- Soft module budget: **~500 LOC** per file — split when exceeded.
- After a refactor, the public shell API used by tests/E2E (`command`, `extWm`, test probe)
  should remain usable or be updated in the same change with tests.
- Incremental extractions and full rewrites are both valid tactics.

---

## 5. Async settlement (named sessions)

- Map / size / grab races go through **named** helpers with unit tests:
  - Pending admit: `WindowTracker.trackWhenReady` / `admitWindow`
  - Reconcile: exponential backoff (`scheduleReconcile`) — not fixed busy loops
  - Grab: `GrabResizeSession` phases; live 16ms poll is **Wayland fallback only**
- Do not invent anonymous `timeout_add(…, 16)` / magic delays without a constant name and comment.
- Freeze protocol: `freezeRender` / `unfreezeRender` must balance; `renderTree(from, force)` may
  temporarily unfreeze one pass and restore.

---

## 6. Rules are data

- Float/tile decisions **only** through `RulesEngine` (JSON overrides + ordered built-ins).
- Prefer `RulesEngine.match()` / classification cache; invalidate on override reload.
- Title grammar and class match policy live on the rules module (document changes there).
  - Title: contains / `=` exact / `!` not-contains / comma lists.
  - Class: exact; `~` contains; `*`/`?` glob; `re:` regex.
- Shared schema: `WindowConfig` / `WindowOverride` in `lib/shared/settings.ts` (prefs + shell).
- Prefs bump `window-overrides-reload-trigger`; shell reloads via SettingsBridge — no silent
  dual-writer file races.

---

## 7. Types

- No new **public** `any` on APIs (actions, hosts, exported functions).
- Meta monkey-patches stay centralized in `window/types.ts`.
- Discriminated unions for commands; typed search criteria on the tree (`NodeSearchCriteria`).
- Prefer host interfaces (`TreeHost`, `WindowTrackerHost`, `CommandBusHost`, …) over importing
  concrete `WindowManager` into subsystems.

---

## 8. File / module budget

- Soft cap **~500 LOC** per module; split by concern when exceeded.
- Utils: pure geometry → `utils/geometry.ts`; filters → `window-filters.ts`; decorations →
  `decorations.ts`; version/DPI → `version.ts`. Barrel `utils.ts` re-exports for compatibility.
- New pure helpers get unit tests next to the module.

---

## 9. Testing

| Layer | Use for                                               | Avoid                                  |
| ----- | ----------------------------------------------------- | -------------------------------------- |
| Unit  | Layout algebra, rules, percents, commands, pure utils | Needing a real compositor              |
| E2E   | Meta integration, focus, tiling on real shell         | Exact pixel geometry as primary assert |

- Pure layout/rules/commands: unit-tested.
- E2E: prefer **tree percents** and relative geometry; use `--tag` for PR smoke; full suite
  pre-release (`make test-e2e`).
- Official test snapshot: `Tree.serializeForTest` / `WindowManager.getTestStateJson` /
  `AnvilExtension.getTestState` — do not walk private `_nodes` / `_tree` from outside.
- Changes that touch `window.ts` or lifecycle: unit + consider E2E (see workflow rules).

---

## 10. Language (CONTEXT.md)

Use project terms in code and APIs:

| Prefer               | Avoid                                   |
| -------------------- | --------------------------------------- |
| Tiling Tree          | DOM tree, scene graph                   |
| Node                 | Element, widget                         |
| Tiling Render        | doLayoutPass, repaint                   |
| Pointer Policy       | cursor manager                          |
| Grab-Resize          | generic "window resize" for tiling drag |
| Workspace Transition | ad-hoc "ws switch handler"              |

---

## 11. Prefs ↔ shell contract

- **Two processes:** `extension.ts` (Meta/Shell) vs `prefs.ts` (GTK4/Adwaita) — never import
  Meta/`global` in prefs.
- Shell reacts only to:
  - GSettings keys handled by **SettingsBridge**
  - Explicit reload triggers (e.g. `window-overrides-reload-trigger`, `css-updated`)
- Shared persistence: ConfigManager + `windows.json` + shared `WindowConfig` types.
- `test-mode` + `unsafe_mode` is **test-only / dangerous** — never enable for end users.

---

## 12. Dependency direction

```text
tree (structure, TreeHost)  ←  layout-engine
                            ←  window-tracker / command-bus / tiling-render
window.ts (or successor)    →  wires all of the above
```

- **`tree.ts` must not import `WindowManager`.** Use `TreeHost`.
- Subsystems take narrow host interfaces, not the concrete shell facade class.
- Avoid new cycles: Keybindings → CommandBus/command API; never Tree → full WM.

---

## Tree / render invariants

1. Every **WINDOW** has a **MONITOR** ancestor.
2. After `redistributeSiblingPercent`, tiled sibling percents sum to ~1.  
   Unset percent is **`undefined`** (equal share in `computeSizes`) — do not overload `0` for unset.
3. **FLOAT** windows may live in the tree but skip size compute.
4. **TilingRender** is the only path that assigns tiled frame geometry; constraints clamp
   **applied rects**, not tree percents.
5. User actions are **AnvilAction** values handled by **CommandBus**.

---

## Feature checklist (agent)

Before marking a tiling-core task done:

1. [ ] Correct **owner** from the table in §2; no second writer (refactor may move code out of
       or restructure `window.ts`).
2. [ ] User-facing behavior is an **AnvilAction** + CommandBus/keybinding table entry if applicable.
3. [ ] Rules/float changes only in **RulesEngine** (+ shared schema if JSON shape changes).
4. [ ] Lifecycle: enable/disable paired; no getter side effects; no leaky GLib sources.
5. [ ] Names match **CONTEXT.md** language.
6. [ ] Unit tests for pure logic; E2E when Meta integration or public shell API changes.
7. [ ] `npm test` (typecheck + lint + unit) green per workflow rules.
8. [ ] If architectural trade-off is new, append **`.agents/memory/decisions.md`**.

---

## Anti-patterns (from the review — do not reintroduce)

| Anti-pattern                                          | Do this instead                                         |
| ----------------------------------------------------- | ------------------------------------------------------- |
| New feature logic only on a god-class `WindowManager` | Owner module + host wire (`window.ts` refactor is fine) |
| Mega-switch on `action.name` or settings key          | CommandBus / SettingsBridge registry                    |
| `isFloatingExempt` copy-paste / dual classification   | RulesEngine only                                        |
| Tree importing WM; Clutter tabs inside Node           | TreeHost; `tab-decoration.ts`                           |
| `command({ name: "Split" })` from track               | `LayoutEngine.autoSplitFromFocus`                       |
| Busy 120×16ms reconcile                               | Backoff + stop when stable                              |
| `percent === 0` meaning unset                         | `undefined` + `isUnsetPercent`                          |
| Four near-identical resize action names               | One action + direction enum                             |
| Lazy-create Keybindings in a getter                   | `wireKeybindings` after construct                       |
| `null as unknown as T` on extension disable           | Nullable fields / getters                               |
| Exact pixel E2E as primary proof                      | Percents / relative geometry                            |
| Ad-hoc timeouts without names                         | Named session constants + comments                      |
| Substring class match as default                      | Exact / glob / `re:` / `~` policy                       |

---

## Process split (hard boundary)

| Process     | Entry          | May use                          | Must not use      |
| ----------- | -------------- | -------------------------------- | ----------------- |
| gnome-shell | `extension.ts` | Meta, Clutter, St, Shell, global | GTK prefs widgets |
| Preferences | `prefs.ts`     | GTK4, Adwaita, GSettings         | Meta, `global`    |

---

_End of architecture rules. Prefer this file over digging `codebase-review.md` for day-to-day
implementation; keep the review for historical findings and roadmaps._
