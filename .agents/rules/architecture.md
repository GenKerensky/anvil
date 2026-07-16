# Architecture Rules (enforceable)

**Authority:** Synthesized from the completed codebase review and its extraction roadmap. Agents
**must** follow these rules on every tiling-core change.

**Related (load when needed):**

| Need                               | Read                              |
| ---------------------------------- | --------------------------------- |
| Source layout / seams map          | `.agents/context/architecture.md` |
| Ubiquitous language                | `CONTEXT.md`                      |
| Historical ADRs / extraction notes | `.agents/memory/decisions.md`     |
| Finish-change gates                | `.agents/rules/workflow.md`       |

---

## 0. Mental model (do not violate)

```text
Meta event  → WindowTracker  → LayoutEngine (mutate tree)
                             → TilingRender (derive tiled frames)
                             → GnomeWindowOperations (general Meta frame apply)
Keybinding  → AnvilRuntime.command
            → legacy/shadow: CommandBus → Layout / Rules / Settings / Focus
            → core: CorePlatformCommands or typed portable observation
GSettings   → SettingsBridge → affected modules only
Prefs write → GSettings / windows.json reload trigger → shell reacts
```

| Role                        | Module(s)                                                                |
| --------------------------- | ------------------------------------------------------------------------ |
| Shell facade / public API   | `anvil-runtime.ts` (`AnvilRuntime`) — may be refactored or split freely  |
| Typed user actions          | `window/actions.ts`; `AnvilRuntime.command` selects the engine route     |
| Core platform actions       | `core-platform-commands.ts`                                              |
| Float/tile rules            | `rules-engine.ts`                                                        |
| Window admit/destroy        | `window-tracker.ts` (`admitWindow`)                                      |
| Tree structure              | `tree.ts` + **TreeHost** (no `AnvilRuntime` import)                      |
| Legacy GNOME topology       | `legacy-workspace-topology.ts`                                           |
| Layout algebra + percents   | `layout-engine.ts`                                                       |
| Focus entry                 | `focus-controller.ts` (+ `LayoutEngine.focus`)                           |
| Tiled geometry policy       | `tiling-render.ts`                                                       |
| Explicit shell frame moves  | `gnome-window-operations.ts`                                             |
| Borders                     | `border-controller.ts`                                                   |
| Tree presentation           | `tree-presentation.ts` (tabs, decorations, structural actors, previews)  |
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
- `AnvilRuntime.enable()` sets `disabled = false`; `disable()` sets `disabled = true`.
- Wire subsystems after construction (`wireKeybindings`); getters must not lazy-create
  Keybindings or other heavy objects.

---

## 2. One owner per state

Do **not** invent a second write path.

| Concern                                   | Sole owner                                         | Forbidden                                                   |
| ----------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------- |
| Tree structure                            | `Tree` + TreeHost                                  | Tracker/commands mutating tree without LayoutEngine for ops |
| Sibling percents                          | `LayoutEngine`                                     | Ad-hoc `percent` outside layout/grab session math           |
| Tiled frame derivation and policy         | `TilingRender`                                     | Ad-hoc tiled rectangle policy in commands or runtime        |
| Explicit frame moves + monitor projection | `GnomeWindowOperations`                            | Raw frame moves in command/runtime owners                   |
| Legacy workspace/monitor projection       | `LegacyWorkspaceTopology`                          | GNOME topology discovery or reindexing in `Tree`            |
| Float/tile classification                 | `RulesEngine`                                      | Parallel `isFloatingExempt` logic on WM                     |
| Window admit / destroy                    | `WindowTracker` (`admitWindow` / destroy pipeline) | New Meta track entry that bypasses `admitWindow`            |
| Grab session + resize exemption           | `GrabResizeSession`                                | New 16ms grab loops or exemption maps on WM                 |
| Focus borders / split hints               | `BorderController`                                 | New border actors created outside controller                |
| Legacy Tree presentation                  | `TreePresentation` / `DragPreviewPresenter`        | St/Clutter actor fields or construction inside `tree.ts`    |
| Directional focus helpers                 | `FocusController`                                  | Duplicating stacked/tabbed raise logic in command handlers  |
| GSettings reactions                       | `SettingsBridge`                                   | Mega-`switch (key)` on WM                                   |
| User command routing                      | `AnvilRuntime` by selected engine                  | Falling through from core mode to the legacy CommandBus     |
| Legacy/shadow command semantics           | `CommandBus`                                       | Open-coded legacy action switches in Runtime                |
| Core platform command semantics           | `CorePlatformCommands`                             | Generic `observeCommand` for platform-owned core actions    |

Lifecycle-specific frame effects remain with the owner whose ordering they implement:
`GnomeIntentionApplier` applies portable intentions, `GrabResizeSession` positions an active grab,
and `WindowTracker` performs admission-time unmaximize. They are not general shell move paths.

**Render scheduling:** idle coalesce, freeze, and tiling-mode gate may live on the shell entry
that calls `TilingRender` (today: `AnvilRuntime.renderTree`). Tiled rectangle derivation, gaps, and
constraints stay on `TilingRender`; it requests application through its injected `moveWindow`
dependency. `GnomeWindowOperations` owns general, explicit shell-requested `Meta.Window`
unmaximize, move, and resize calls, subject to the lifecycle-specific exceptions above.

**Topology signal lifetime:** `LegacyWorkspaceTopology` may request workspace-signal binding while
projecting a newly discovered workspace. `SignalManager` remains the owner of signal connection,
disconnection, and timeout lifetime.

**Portable migration exception:** the accepted migration plan permits a `shadow` session in which
legacy remains the sole topology, percentage, and platform-effect writer while the portable state
machine receives the same normalized ingress for comparison. Shadow intentions are always
discarded and cannot call Meta/St effects. This diagnostic mirror is not a second production write
path. The portable core is experimental and is not approved as the default. Core maturation,
cutover, and legacy retirement are a separate workstream; ordinary production fixes and cleanups
must not expand into portable-core modules, adapters, parity work, engine selection, or legacy
removal. See `docs/plans/portable-tiling-state-machine.md` under “Migration rule: never two writers.”

---

## 3. Commands are data

- All user actions are **`AnvilAction`** values (`src/lib/extension/window/actions.ts`).
- `AnvilRuntime.command(action)` selects exactly one engine route:
  - In legacy and shadow modes, an optional portable observation is followed by
    **`CommandBus.dispatch`**.
  - In core mode, platform-owned actions go to **`CorePlatformCommands`**. That module bypasses
    generic `observeCommand` and the legacy `CommandBus`, but may update portable state through a
    named, typed observation hook. Remaining portable actions go to the core `observeCommand`
    route; unsupported actions fail closed and never fall through to `CommandBus`.
- Adding a command:
  1. Extend the `AnvilAction` union.
  2. Put its semantics on the selected engine route: `CommandBus` for legacy/shadow,
     `CorePlatformCommands` for a core-only platform effect, or the portable command translator for
     portable state.
  3. Add a row to `KEYBINDING_TABLE` if user-facing.
  4. Add unit coverage for the action.
- Keybindings and tests **build action objects**; they do not call layout internals directly.
- Prefer a single action + enum field over near-duplicate names (e.g. `WindowResize` +
  `direction`, not four `WindowResize*` names).
- No `command({ name: "Split" })` re-entry from track/admit — use `LayoutEngine` / policy APIs.

---

## 4. Module budget — `anvil-runtime.ts` may be refactored freely

**Big-bang refactors of `src/lib/extension/anvil-runtime.ts` are allowed and encouraged** when they
preserve behavior and the ownership rules in §2. Do **not** treat historical “freeze growth”
or “incremental only” guidance as a ban.

- Prefer landing durable logic in the owner modules (tracker, layout, render, rules, …).
- Soft module budget: **~500 LOC** per file — split when exceeded.
- After a refactor, the public shell API used by tests/E2E (`command`, `runtime`, test probe)
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
  concrete `AnvilRuntime` into subsystems.

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
- Official test snapshot: `Tree.serializeForTest` / `AnvilRuntime.getTestStateJson` /
  `AnvilExtension.getTestState` — do not walk private `_nodes` / `_tree` from outside.
- Changes that touch `anvil-runtime.ts` or lifecycle: unit + consider E2E (see workflow rules).

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
- `test-mode` exposes in-process automation state only. The extension must never write
  `global.context.unsafe_mode`; E2E uses direct GJS APIs rather than `Shell.Eval`.

---

## 12. Dependency direction

```text
tree (structure, TreeHost)  ←  layout-engine
                            ←  window-tracker / command-bus / tiling-render
legacy-workspace-topology   →  tree structural operations
tiling-render               →  injected GnomeWindowOperations frame apply
anvil-runtime.ts (or successor)    →  wires all of the above
```

- **`tree.ts` must not import `AnvilRuntime`.** Use `TreeHost`.
- Subsystems take narrow host interfaces, not the concrete shell facade class.
- Avoid new cycles: Keybindings → CommandBus/command API; never Tree → full WM.

---

## Tree / render invariants

1. Every **WINDOW** has a **MONITOR** ancestor.
2. After `redistributeSiblingPercent`, tiled sibling percents sum to ~1.  
   Unset percent is **`undefined`** (equal share in `computeSizes`) — do not overload `0` for unset.
3. **FLOAT** windows may live in the tree but skip size compute.
4. **TilingRender** is the only module that derives tiled frame geometry and applies tiled-layout
   constraints; it delegates the imperative Meta frame effect to **GnomeWindowOperations**.
   Constraints clamp the requested rect, not tree percents.
5. User actions are **AnvilAction** values routed by engine: **CommandBus** in legacy/shadow mode,
   and **CorePlatformCommands** or typed portable observation in core mode.

---

## Feature checklist (agent)

Before marking a tiling-core task done:

1. [ ] Correct **owner** from the table in §2; no second writer (refactor may move code out of
       or restructure `anvil-runtime.ts`).
2. [ ] User-facing behavior is an **AnvilAction** plus the engine-appropriate handler and
       keybinding-table entry if applicable.
3. [ ] Rules/float changes only in **RulesEngine** (+ shared schema if JSON shape changes).
4. [ ] Lifecycle: enable/disable paired; no getter side effects; no leaky GLib sources.
5. [ ] Names match **CONTEXT.md** language.
6. [ ] Unit tests for pure logic; E2E when Meta integration or public shell API changes.
7. [ ] `npm test` (typecheck + lint + unit) green per workflow rules.
8. [ ] If architectural trade-off is new, append **`.agents/memory/decisions.md`**.

---

## Anti-patterns (from the review — do not reintroduce)

| Anti-pattern                                         | Do this instead                                                |
| ---------------------------------------------------- | -------------------------------------------------------------- |
| New feature logic only on a god-class `AnvilRuntime` | Owner module + host wire (`anvil-runtime.ts` refactor is fine) |
| Action/settings switch on the wrong engine route     | CommandBus, CorePlatformCommands, or SettingsBridge owner      |
| `isFloatingExempt` copy-paste / dual classification  | RulesEngine only                                               |
| Tree importing WM; presentation fields inside Node   | TreeHost; `tree-presentation.ts`                               |
| `command({ name: "Split" })` from track              | `LayoutEngine.autoSplitFromFocus`                              |
| Busy 120×16ms reconcile                              | Backoff + stop when stable                                     |
| `percent === 0` meaning unset                        | `undefined` + `isUnsetPercent`                                 |
| Four near-identical resize action names              | One action + direction enum                                    |
| Lazy-create Keybindings in a getter                  | `wireKeybindings` after construct                              |
| `null as unknown as T` on extension disable          | Nullable fields / getters                                      |
| Exact pixel E2E as primary proof                     | Percents / relative geometry                                   |
| Ad-hoc timeouts without names                        | Named session constants + comments                             |
| Substring class match as default                     | Exact / glob / `re:` / `~` policy                              |

---

## Process split (hard boundary)

| Process     | Entry          | May use                          | Must not use      |
| ----------- | -------------- | -------------------------------- | ----------------- |
| gnome-shell | `extension.ts` | Meta, Clutter, St, Shell, global | GTK prefs widgets |
| Preferences | `prefs.ts`     | GTK4, Adwaita, GSettings         | Meta, `global`    |

---

_End of architecture rules. This file is the durable result of the completed review._
