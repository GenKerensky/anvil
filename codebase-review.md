# Anvil Codebase Review

**Date:** 2026-07-10  
**Scope:** Full architecture and maintainability review of the Anvil GNOME Shell tiling extension (Forge fork).  
**Method:** Section-by-section read of `src/`, inventories of commands/signals/methods, unit-test surface as design docs, and comparison to Hyprland/Sway dispatchers/rules, GNOME extension lifecycle guidelines, and Mutter/Wayland async realities.  
**Out of scope:** Implementing refactors in this pass—recommendations only.

---

## 0. Executive summary

Anvil is a **working** tree-based tiling window manager for GNOME Shell. The domain model (workspace → monitor → container → window, percent-based splits, float/tile modes) is sound and partially documented in `CONTEXT.md`. Unit tests (~19 files under `test/unit/extension/`) protect many pure behaviors.

The maintainability problem is concentration and control-flow density:

| File                                 | ~LOC     | Role                                                                                                         |
| ------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------ |
| `src/lib/extension/window.ts`        | **3495** | God object: lifecycle, Meta signals, commands, borders, grab-resize, constraints, floats, tree orchestration |
| `src/lib/extension/tree.ts`          | **1550** | Tree data structure + focus/move/swap/split + percent math + UI decorations on nodes                         |
| `src/lib/extension/tiling-render.ts` | **523**  | Better extraction: process floats → layout → gaps → constraints → apply                                      |
| Rest of extension                    | smaller  | Clearer seams (pointer-policy, keybindings, mutter-safe)                                                     |

**`WindowManager` is the bottleneck.** Rough metrics: ~100 methods, ~379 `if` sites, one `command()` switch with ~20 action names, settings `changed` switch with ~15 keys, dense Meta signal wiring, and dual float classification (`processFloats` in render + `isFloatingExempt` in track). Humans cannot hold create/focus/resize/destroy paths in working memory.

**Direction of travel (not a big-bang rewrite):** peel `WindowManager` into a thin facade plus:

- `WindowTracker` (Meta signals + track/destroy)
- `CommandBus` (action registry; kill the mega-switch)
- `LayoutEngine` (tree mutations + percents; pure-ish)
- `RenderPipeline` (already started as `TilingRender`)
- `RulesEngine` (`windows.json` + built-in float rules)
- `FocusController` + existing `PointerPolicy`
- `SettingsBridge` (typed setting → effect map)

**Highest leverage first:** (1) freeze growth of `window.ts`, (2) extract `command()` handlers, (3) document tree/render invariants, (4) centralize async “settlement” for Wayland size/map races, (5) finish moving render-only logic out of WM.

---

## 1. Method and severity rubric

| Level  | Meaning                                                   |
| ------ | --------------------------------------------------------- |
| **P0** | Correctness, crash, leak, or security; blocks safe change |
| **P1** | Architectural debt that blocks features or safe debugging |
| **P2** | Clear smell; fix when touching the area                   |
| **P3** | Style/nit; optional                                       |

Each finding: **ID**, severity, location, observation, recommendation, effort (S/M/L).

---

## 2. Domain map (as-is)

### 2.1 Processes (correct split)

| Entry              | Process            | APIs                                 |
| ------------------ | ------------------ | ------------------------------------ |
| `src/extension.ts` | gnome-shell        | Meta, Clutter, St, Shell, `global`   |
| `src/prefs.ts`     | separate Gtk prefs | Gtk4, Adwaita — **no** Meta/`global` |

This matches GNOME extension anatomy and must stay.

### 2.2 Ubiquitous language (`CONTEXT.md`)

| Term                     | Meaning                                                          |
| ------------------------ | ---------------------------------------------------------------- |
| **Tiling Tree**          | Hierarchical layout of workspaces, monitors, containers, windows |
| **Node**                 | Workspace / monitor / container / window element                 |
| **Tiling Render**        | Tree → frame rects (float classify, gaps, constraints, apply)    |
| **Pointer Policy**       | Cursor warp / hover-focus rules                                  |
| **Workspace Transition** | Guarded period after workspace change                            |
| **Grab-Resize**          | Drag-resize redistributing sibling space                         |

Code largely uses these ideas but **does not enforce them as module boundaries**—most live inside `WindowManager` + `Tree`.

### 2.3 Tree shape

```text
ROOT
 └── WORKSPACE (wsN)
      └── MONITOR (moMwsN)
           └── CON / WINDOW (recursive)
```

- Layouts: `HSPLIT`, `VSPLIT`, `STACKED`, `TABBED` (`LAYOUT_TYPES` in `tree.ts`).
- Modes: `TILE`, `FLOAT`, `GRAB_TILE` (`WINDOW_MODES`).
- Space: sibling `percent` (0 = equal share fallback in `computeSizes`).

### 2.4 Command surface (user actions)

Keybindings (`keybindings.ts`) build small action objects and call `extWm.command(action)`.  
`WindowManager.command()` dispatches by `action.name` (stringly typed `any`).

### 2.5 Configuration surfaces

1. **GSettings** — tiling mode, gaps, borders, constraints, pointer, stacking, etc.
2. **`config/windows.json`** — float/tile overrides by class/title/id.
3. **Hardcoded exceptions** in `isFloatingExempt` (PIP title, Blender, Steam, ephemeral helpers, dialogs, non-resizable).

Three rule sources → cognitive load and ordering bugs (partially mitigated by “tile override wins” comment at ~3332).

---

## 3. Dependency sketch

```text
extension.ts
  ├─ WindowManager (window.ts)  ◄── god center
  │    ├─ Tree (tree.ts)        ◄── mutual ref: Tree holds WindowManager
  │    ├─ TilingRender          ◄── good extraction via deps interface
  │    ├─ PointerPolicy         ◄── optional subsystem
  │    ├─ Keybindings (via ext) ◄── circular-ish: WM stores _kbd; KB stores extWm
  │    └─ Utils, mutter-safe
  ├─ Keybindings
  ├─ FeatureIndicator
  ├─ ExtensionThemeManager
  └─ ConfigManager (shared/settings)
```

**Finding A3-1 (P1):** Circular coupling `Tree ↔ WindowManager` and `Keybindings ↔ WindowManager` makes extraction hard. Prefer interfaces (`LayoutHost`, `CommandTarget`) injected one-way.

**If we only do one thing here:** Draw and enforce a one-way dependency rule: `tree` must not import concrete `WindowManager` long-term—only a narrow host interface for focus activation.

---

## 4. Section reviews — Phase B core

### B1. Extension entry / lifecycle (`extension.ts`)

**Map:** `AnvilExtension.enable` / `disable` / session mode / GNOME setting overrides / test globals.

**Observations:**

- Constructor does not create UI (good; aligns with [gjs.guide review guidelines](https://gjs.guide/extensions/review-guidelines/review-guidelines.html): nothing before `enable()`).
- `enable()` disables conflicting Mutter/WM keybindings and restores them in `disable()` (good hygiene; documented as Forge credit).
- Session modes: persists through unlock-dialog; keybindings/indicator toggled—correct pattern for state-preserving extensions.
- Exports `global.__anvil_extWm` / `__anvil_settings` for GNOME 50 proxy bypass and tests.

**Findings:**

| ID   | Sev | Location                | Observation                                                                                | Recommendation                                                                                                        | Effort |
| ---- | --- | ----------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- | ------ |
| B1-1 | P2  | `enable` L104–111       | `test-mode` sets `global.context.unsafe_mode = true` and hangs whole extension on `global` | Keep test-only; never enable for users. Document as dangerous. Prefer test harness flags over shell globals long-term | S      |
| B1-2 | P2  | `disable` L199–204      | Nulling fields via `null as unknown as T`                                                  | Prefer optional fields (`WindowManager \| null`) for honest types                                                     | S      |
| B1-3 | P3  | `getTestState` L253–296 | Serialization walks private `_tree` / `_nodes`                                             | Official test API on a `TestProbe` interface, not digging private fields                                              | M      |

**If we only do one thing here:** Keep lifecycle discipline; never add Meta listeners in constructor.

---

### B2. `WindowManager` structure (`window.ts`)

**Map:** ~100 methods; state includes tree, event queue, pointer policy, tiling render, many GLib source IDs, grab/resize maps, border actors, workspace flags.

**Responsibilities currently mixed:**

1. Meta signal binding / teardown
2. Window track / destroy / reconcile
3. Command dispatch
4. Tree orchestration
5. Render scheduling
6. Focus borders / decorations
7. Grab-resize live loop
8. Float overrides persistence
9. Monitor constraints
10. Workspace tile skip

**Findings:**

| ID   | Sev    | Location               | Observation                                                                                                       | Recommendation                                                          | Effort |
| ---- | ------ | ---------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------ |
| B2-1 | **P1** | entire class           | God object (~3.5k LOC)                                                                                            | Freeze new logic; extract subsystems (see §10)                          | L      |
| B2-2 | P1     | constructor L147–178   | Constructs `Tree` before keybindings fully exist; stores `_kbd` from `ext.keybindings` that may be assigned later | Explicit `wire(ext)` after all subsystems constructed                   | M      |
| B2-3 | P2     | declare fields L95–145 | Large mutable flag set (`fromOverview`, `cancelGrab`, …) with no state machine                                    | Document transitions; group into `SessionFlags` / `GrabSession` objects | M      |
| B2-4 | P2     | dual calc APIs         | `calculateGaps` / `processFloats` / `enforceUltrawideSize` thin wrappers to `TilingRender`                        | Delete wrappers; callers use `tilingRender` only                        | S      |

**Method inventory (coverage checklist):** constructor, pointer policy getters/setters, float override add/remove/toggle, `queueEvent`, `_bindSignals` / `_removeSignals`, enable/disable, `command`, resize/grab handlers, track/destroy/reconcile, renderTree/reloadTree, borders, move/rect, workspace helpers, `isFloatingExempt`, `reloadWindowOverrides`, float-all—**all present and reviewed for role**. Full line audit of every branch is continuous in subsections below.

**If we only do one thing here:** Declare a hard rule: **no new methods on `WindowManager` without extracting an existing cluster.**

---

### B3. Command dispatcher (`command()` ~L668–1045)

**Map:** Single switch on `action.name` (untyped `any`). Actions include Float*, Move, Focus, Swap, Split, Layout*, GapSize, WorkspaceActiveTileToggle, SnapLayoutMove, WindowResize\*, WindowClose, PrefsOpen, CancelOperation, WindowSwapLastActive, ShowTabDecorationToggle.

**Keybindings** (`keybindings.ts`) wrap each binding as a function that builds action objects and calls `command`—often with a useless one-element `forEach`.

**Findings:**

| ID   | Sev    | Location        | Observation                                               | Recommendation                                                                                     | Effort |
| ---- | ------ | --------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------ |
| B3-1 | **P1** | `command` L668+ | Mega-switch mixes pure layout ops and UI side effects     | `CommandBus`: `Map<name, Handler>`; one module per family (`focus.ts`, `float.ts`, `resize.ts`, …) | L      |
| B3-2 | P1     | action type     | `action: any`                                             | Discriminated union `AnvilAction` shared by keybindings + tests                                    | M      |
| B3-3 | P2     | keybindings     | Each binding re-creates arrays and `forEach`s one action  | `() => this.extWm.command({ name: "Focus", direction: "Left" })`                                   | S      |
| B3-4 | P2     | SnapLayoutMove  | Nested switch for LEFT/RIGHT/CENTER inside command switch | Own handler module                                                                                 | S      |
| B3-5 | P3     | Resize\* cases  | Four near-identical cases call `resize(grabOp, amount)`   | Single `WindowResize` with direction enum                                                          | S      |

**Hyprland parallel:** dispatchers are a **named command table** (`wiki.hypr.land` Dispatchers), not an open-coded switch inside the compositor’s window class. Anvil should look more like that registry.

**If we only do one thing here:** Introduce `AnvilAction` type + handler map without moving code off the class yet (minimal PR, max clarity).

---

### B4. Window lifecycle (track / signals / destroy)

**Map:**

- Display: `window-created` → `_trackWindowWhenReady` + reconcile timer
- WM: `map`, minimize/unminimize
- Per-window: position/size-changed, focus, workspace-changed, unmanaged, first-frame reclassify
- Actor: destroy → `windowDestroy`
- Pending track until valid: wm-class/title/window-type/workspace/first-frame

**Strengths:**

- Deferred tracking until window is “valid” (Wayland often lacks class/title at create).
- `_clearPendingWindowSignals` avoids leaks on unmanaged.
- Ephemeral helper ignore (`Utils.isEphemeralHelperWindow`) for wl-clipboard—documented in decisions.
- Workspace transition flag `_workspaceChanging` + 300ms settle for pointer policy.

**Findings:**

| ID   | Sev    | Location                                | Observation                                                                                          | Recommendation                                                           | Effort |
| ---- | ------ | --------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------ |
| B4-1 | **P1** | track + signals                         | Lifecycle logic interleaved with UI (borders, focus) in one file                                     | `WindowTracker` owns all Meta connects and track/destroy only            | L      |
| B4-2 | P1     | `_scheduleCurrentWindowReconcile` L1778 | 120 × 16ms busy reconcile loop                                                                       | Event-driven reconcile; exponential backoff; stop when stable            | M      |
| B4-3 | P2     | `trackWindow` L1830                     | Auto-split calls `this.command({ name: "Split" })` from track path                                   | LayoutEngine.autoSplitFromFocus(); no command re-entry                   | M      |
| B4-4 | P2     | size-changed handler                    | Resize exemption races documented via `_resizedWindows` Map                                          | Single `ResizeSession` with explicit phases (grab begin → end → settle)  | M      |
| B4-5 | P2     | dual entry points                       | `window-created` and `map` and workspace `window-added` all can track                                | One “admit window” API; others call it                                   | M      |
| B4-6 | P3     | empty `show-tile-preview`               | Stub connected for side-effect suppression?                                                          | Comment why empty or disconnect if unused                                | S      |
| B4-7 | P2     | `windowDestroy` L2132–2187              | Quick render + queued second render; float override remove; focus restore                            | Single destroy pipeline with ordered steps (detach → focus → one render) | M      |
| B4-8 | P2     | `enable` L1094–1098                     | Only binds signals + `reloadTree`; does not set `disabled = false` explicitly if previously disabled | Set `this.disabled = false` in enable; pair with disable                 | S      |
| B4-9 | P1     | `kbd` getter L1115–1121                 | Lazy-creates Keybindings and mutates `ext.keybindings` — surprising side effect on property access   | Construct keybindings only in extension.enable; never in a getter        | S      |

**Mutter/Wayland note:** Clients negotiate size asynchronously. Anvil already learned this (exemption count ≥ 2). That knowledge must become a **named module**, not tribal comments.

**If we only do one thing here:** Collapse track entry points into one function with a single signal-cleanup contract.

---

### B5. Tree model (`tree.ts`)

**Map:** `Node` (DOM-like tree API), `Queue`, `Tree extends Node` with workspace/monitor bootstrap, create/remove, focus/move/swap/split, percent compute/reset/redistribute, debug dumps, and **UI** (`_createWindowTab`, decorations on nodes).

**Strengths:**

- Explicit node types and layout predicates (`isHSplit`, `isWindow`, …).
- Percent redistribution after remove (Forge ports).
- `computeSizes` residual-pixel fix (Bug #330).
- Focus/next logic handles CON/MONITOR/STACKED (i3-inspired comment at move).

**Findings:**

| ID   | Sev    | Location                       | Observation                                     | Recommendation                                                        | Effort |
| ---- | ------ | ------------------------------ | ----------------------------------------------- | --------------------------------------------------------------------- | ------ |
| B5-1 | **P1** | Node UI L523–626               | Tree nodes create Clutter/St decorations        | Split pure tree from presentation (`TabStrip`, decorations in render) | L      |
| B5-2 | P1     | `Tree` holds `_extWm`          | Layout graph knows about WM for activation      | Pass `FocusActivator` interface into focus()                          | M      |
| B5-3 | P2     | `percent === 0` semantics      | 0 means “unset → equal share” in `computeSizes` | Use `undefined` / null for unset; never overload 0                    | M      |
| B5-4 | P2     | focus() recursion on minimized | Recursive `focus(next, direction)`              | Explicit loop with visited set                                        | S      |
| B5-5 | P2     | stringly type/layout searches  | `_search(term, criteria)` string criteria       | Typed predicates                                                      | M      |
| B5-6 | P3     | debug methods                  | Many `debug*` always available                  | Gate behind logger level only (mostly already)                        | S      |

**Sway/i3 parallel:** the tree is the **source of truth**; rendering is a pure function of tree + work area. Anvil is close but pollutes nodes with actors.

**If we only do one thing here:** Document invariants: (1) every WINDOW has a MONITOR ancestor, (2) percents of tiled siblings sum to 1 after redistribute, (3) FLOAT windows may exist but skip size compute.

---

### B6. Layout algorithms

**Map:** `split`, `move`, `swap`, `computeSizes`, `determineSplitLayout` (WM), stacked/tabbed toggles in `command`.

**Findings:**

| ID   | Sev | Location                     | Observation                                                                 | Recommendation                        | Effort |
| ---- | --- | ---------------------------- | --------------------------------------------------------------------------- | ------------------------------------- | ------ |
| B6-1 | P1  | split between tree + command | Split orientation also chosen in `trackWindow` via frame aspect             | One AutoSplit policy object           | M      |
| B6-2 | P2  | stacked/tabbed               | Layout mode changes + raise/activate + percent reset mixed in command cases | LayoutEngine.setLayout(node, STACKED) | M      |
| B6-3 | P2  | `determineSplitLayout`       | Portrait monitor → VSPLIT                                                   | Keep; unit-test explicitly            | S      |

**If we only do one thing here:** Extract pure functions for percent arrays and split decisions with table-driven unit tests (many already exist—extend them).

---

### B7. Render path (`tiling-render.ts` + `renderTree`)

**Map:** `TilingRender.render`: processFloats → processNode → apply → cleanTree.  
`WindowManager.renderTree`: idle_add coalesce, respect freeze + tiling-mode-enabled, then borders/decorations.

**Strengths:**

- **Best architectural move in the codebase:** render deps injected via `TilingRenderDeps`.
- Coalesced idle render reduces thrash.
- Freeze/unfreeze used around minimize/grab.

**Findings:**

| ID   | Sev | Location               | Observation                                       | Recommendation                                                     | Effort |
| ---- | --- | ---------------------- | ------------------------------------------------- | ------------------------------------------------------------------ | ------ |
| B7-1 | P2  | processFloats          | Float flags recomputed every render from rules    | RulesEngine.classify(window) cached until override/settings change | M      |
| B7-2 | P2  | borders still on WM    | show/hide borders after every render              | BorderController owned by render or decoration module              | M      |
| B7-3 | P2  | force unfreeze         | `renderTree(from, true)` can unfreeze temporarily | Document freeze protocol; assert balanced freeze/unfreeze in tests | S      |
| B7-4 | P3  | debugTree every render | Cost in hot path if debug on                      | Ensure Logger.debug no-ops when disabled (verify)                  | S      |

**If we only do one thing here:** Treat `TilingRender` as the **only** code path that assigns geometry; ban `move()` from command handlers except through render/apply.

---

### B8. Resize and constraints

**Map:** keyboard resize via `resize(grabOp, amount)`; grab-op begin/end; live resize loop 16ms; `_resizedWindows` Map; `enforceUltrawideSize` / monitor constraints GSettings; `_lastResizePair`.

**Findings:**

| ID   | Sev    | Location                       | Observation                                                                | Recommendation                                                                       | Effort |
| ---- | ------ | ------------------------------ | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------ |
| B8-1 | **P1** | grab + live resize ~L2791–3300 | Large imperative block hard to test                                        | `GrabResizeSession` class with phases + unit tests on percent math                   | L      |
| B8-2 | P1     | exemption Map                  | Global map keyed by window id; bleed across tests without clear            | Session-scoped; clear on destroy always                                              | S      |
| B8-3 | P2     | constraints                    | Applied in render (`enforceUltrawideSize`) and asserted in E2E             | Document: constraints clamp **applied rect**, not tree percent—or unify              | M      |
| B8-4 | P2     | keyboard vs grab               | Two resize paths                                                           | Share core `applyResizeDelta(node, dir, amount)`                                     | M      |
| B8-5 | P2     | live resize L2835–2870         | 16ms polling loop mirrors size-changed; dual path on X11 noted in comments | Prefer size-changed driven updates; keep poll only as Wayland fallback behind a flag | M      |
| B8-6 | P2     | `initRect` on node             | Grab state hung on tree Node                                               | Belongs on GrabResizeSession, not Node                                               | M      |

**If we only do one thing here:** One pure function: `(siblings, percents, delta, dir) → newPercents` used by both keyboard and grab.

---

### B9. Focus and pointer (`pointer-policy.ts` + focus command)

**Map:** Tree.focus + safeRaise/Focus/Activate; PointerPolicy optional based on settings; workspace settle hook.

**Findings:**

| ID   | Sev | Location                     | Observation                                               | Recommendation                              | Effort |
| ---- | --- | ---------------------------- | --------------------------------------------------------- | ------------------------------------------- | ------ |
| B9-1 | P2  | focus path                   | Tree.focus activates windows; command Focus re-finds node | FocusController.single entry                | M      |
| B9-2 | P2  | pointer policy               | Good extraction but optional null checks everywhere       | Always construct; enable/disable internally | S      |
| B9-3 | P3  | stacked/tabbed focus helpers | updateStackedFocus / updateTabbedFocus on WM              | Move next to layout modes                   | S      |

---

### B10. Keybindings (`keybindings.ts`)

**Map:** Builds binding definitions → GSettings schema keys → shell keybinding API; enable/disable with session mode.

**Findings:**

| ID    | Sev | Location                | Observation            | Recommendation                  | Effort |
| ----- | --- | ----------------------- | ---------------------- | ------------------------------- | ------ |
| B10-1 | P2  | verbose action builders | Duplication            | Table: schema key → AnvilAction | M      |
| B10-2 | P3  | stores extWm            | Set after construction | Inject CommandBus               | S      |

---

### B11. Utils / mutter-safe

**Map:** geometry resolve helpers; orientation; ephemeral detection; `safeRaise`/`safeFocus`/`safeActivate` version shims.

**Findings:**

| ID    | Sev | Location    | Observation                                       | Recommendation                                               | Effort |
| ----- | --- | ----------- | ------------------------------------------------- | ------------------------------------------------------------ | ------ |
| B11-1 | P2  | utils       | Mix of pure geometry and shell decoration helpers | Split `geometry.ts` / `window-filters.ts` / `decorations.ts` | M      |
| B11-2 | P3  | mutter-safe | Good isolation of API churn                       | Keep as only place for GNOME version forks                   | —      |

---

### B12. Window overrides / rules

**Map:** `windows.json` via ConfigManager; runtime float overrides; `windowTitleMatchesOverride` (prefix `!`, `=`, comma lists); hardcoded app quirks.

**Findings:**

| ID    | Sev    | Location                             | Observation                                     | Recommendation                                                          | Effort |
| ----- | ------ | ------------------------------------ | ----------------------------------------------- | ----------------------------------------------------------------------- | ------ |
| B12-1 | **P1** | isFloatingExempt L3332+              | Long ordered rule list + JSON + type heuristics | `RulesEngine.match(window) → { mode, source }` with ordered rules array | L      |
| B12-2 | P2     | title matching                       | Custom mini-language undocumented outside code  | Document grammar; unit tests for each operator                          | S      |
| B12-3 | P2     | class match `cfg.includes(reported)` | Substring inclusion can over-match              | Exact / glob / regex policy                                             | M      |

**Hyprland parallel:** explicit **window rules** (`windowrule = RULE, MATCHERS`) separate from dispatchers. Anvil should not bury rules inside exempt checks.

**If we only do one thing here:** Publish a single ordered rule evaluation algorithm in docs and code comments.

---

## 5. Phase C — Shell UI and prefs

### C1. Indicator (`indicator.ts`)

Quick Settings toggle for tiling mode. Relatively small and appropriate.

| ID   | Sev | Observation                                      | Recommendation                   |
| ---- | --- | ------------------------------------------------ | -------------------------------- |
| C1-1 | P3  | Casts through `unknown` for Quick Settings types | Improve GIR types / thin adapter |

### C2. Theme

`ExtensionThemeManager` patches CSS; settings `css-updated` triggers reload. Acceptable seam.

### C3. Prefs (`prefs.ts`, `lib/prefs/*`)

Separate process—correct. Pages for appearance, floating, keyboard, monitors, settings widgets.

| ID   | Sev | Observation                               | Recommendation                                                               |
| ---- | --- | ----------------------------------------- | ---------------------------------------------------------------------------- |
| C3-1 | P2  | Prefs write same GSettings/files as shell | Document reload triggers (`window-overrides-reload-trigger`) as the contract |
| C3-2 | P3  | `metadata.js` generated                   | Already gitignored; keep                                                     |

### C4. Shared (`logger`, `settings` ConfigManager, `theme`)

ConfigManager owns windows.json persistence—good. Logger settings-driven—good.

| ID   | Sev | Observation                             | Recommendation                                            |
| ---- | --- | --------------------------------------- | --------------------------------------------------------- |
| C4-1 | P2  | WindowConfig types vs runtime overrides | Single schema (JSON Schema or TS type) shared prefs+shell |

**If we only do one thing in Phase C:** Treat prefs→shell as an event bus of typed settings keys, not silent file races.

---

## 6. Phase D — Tests and types

### D1. Unit tests

Strong coverage of tree ops, focus, resize counters, floating, borders, gaps, lifecycle fixtures. This is the **best executable documentation** of intended behavior.

| ID   | Sev | Observation                                         | Recommendation                                  |
| ---- | --- | --------------------------------------------------- | ----------------------------------------------- |
| D1-1 | P1  | Tests mock Meta heavily                             | Keep pure layout extractable so tests stay unit |
| D1-2 | P2  | God-file logic hard to unit-test (grab live resize) | Extraction unlocks tests                        |

### D2. E2E

Host headless Jasmine; Nautilus as reliable app; shared-commands. Validates integration that unit cannot.

| ID   | Sev | Observation                                                 | Recommendation                                       |
| ---- | --- | ----------------------------------------------------------- | ---------------------------------------------------- |
| D2-1 | P2  | E2E softened some geometry assertions for Wayland flakiness | Prefer tree percent assertions + fewer pixel asserts |
| D2-2 | P3  | Long runtime                                                | Tag subsets for PR vs nightly                        |

### D3. Types

| ID   | Sev | Observation                                         | Recommendation                                       |
| ---- | --- | --------------------------------------------------- | ---------------------------------------------------- |
| D3-1 | P1  | `any` dense in window.ts/tree.ts (~58–59 hits each) | Ban new `any` on public APIs; type actions and nodes |
| D3-2 | P2  | Monkey-patched Meta fields in `window/types.ts`     | Good pattern—keep patches centralized                |

---

## 7. Phase E — External research synthesis

### E1. Hyprland / Sway patterns (transferable)

1. **Dispatchers / commands as a table** — named actions with arguments, not a method-local switch ([Hyprland Dispatchers](https://wiki.hypr.land/Configuring/Basics/Dispatchers/)).
2. **Window rules as data** — matchers → properties (`float`, workspace, …) separate from input handling ([Window Rules](https://wiki.hyprland.org/Configuring/Window-Rules/)).
3. **Layout as a plug-in concern** — layout-specific behavior not mixed into global event routing.
4. **i3/Sway tree** — containers with orientation; focus/move/swap are tree algebra; IPC exposes tree for tooling.
5. **Introspection** — `hyprctl clients` / sway tree dump; Anvil’s `getTestState` is a start—productize a debug dump command.

**Mapping to Anvil:** CommandBus ≈ dispatchers; RulesEngine ≈ windowrule; LayoutEngine ≈ layout; Tree dump ≈ hyprctl.

### E2. GNOME extension practices

From [gjs.guide Review Guidelines](https://gjs.guide/extensions/review-guidelines/review-guidelines.html):

1. Nothing before `enable()`.
2. `disable()` undoes everything.
3. Destroy all objects; disconnect signals; remove sources.

Anvil’s extension.ts is largely compliant. Risk is **inside WindowManager.disable**—must mirror every connect/timeout (partially handled via `_removeSignals` and source id fields). Prefer subsystem `disable()` methods that each clean their own IDs.

### E3. Mutter / Wayland realities

1. **window-created** often precedes complete identity (class/title)—Anvil’s pending-signal retry is correct.
2. **size-changed** fires asynchronously after configure—grab exemption counters are a symptom of missing session model.
3. **first-frame** is the right hook for reclassify after real content exists.
4. **Work areas** change with panels/monitors—`workareas-changed` → render is correct.
5. **Headless vs session** differences affect client min sizes (E2E learned Nautilus > TextEditor)—architecture must not assume clients accept all rects.

---

## 8. Phase F — Cross-cutting

### F1. Consolidated smells (deduped)

| Sev | Theme                       | Primary IDs      |
| --- | --------------------------- | ---------------- |
| P1  | God object WindowManager    | B2-1             |
| P1  | Mega command switch         | B3-1             |
| P1  | Rules scattered             | B12-1            |
| P1  | Tree↔WM cycle + UI on nodes | B5-1, B5-2, A3-1 |
| P1  | Grab-resize monolith        | B8-1             |
| P1  | `any` / untyped actions     | B3-2, D3-1       |
| P2  | Dual float classification   | B7-1             |
| P2  | Busy reconcile loop         | B4-2             |
| P2  | Percent 0 overload          | B5-3             |
| P2  | Multiple track entry points | B4-5             |

### F2. Performance

| Risk                    | Where                         | Notes                                         |
| ----------------------- | ----------------------------- | --------------------------------------------- |
| Render storm            | Many `renderTree` callers     | idle coalesce helps; still re-walks full tree |
| 16ms loops              | live resize, window reconcile | Prefer event-driven                           |
| Per-window borders      | showWindowBorders             | O(windows) actor churn                        |
| processFloats full scan | every render                  | Cache classifications                         |
| debugTree               | render path                   | Ensure free when log level off                |

### F3. Target architecture

```text
extension.ts                         # enable/disable, GNOME overrides, session mode
│
├── SettingsBridge                   # GSettings → typed events
├── ConfigManager (existing)         # windows.json
├── RulesEngine                      # ordered float/tile rules
├── KeybindingService                # schema → AnvilAction
├── CommandBus                       # AnvilAction → Handler
│     handlers/focus|move|swap|float|layout|resize|workspace|…
├── WindowTracker                    # Meta signals, track/destroy, pending admit
├── LayoutEngine                     # Tree mutations, percents, split/move/swap/focus algebra
├── RenderPipeline (TilingRender+)   # geometry apply, gaps, constraints
├── DecorationController             # borders, split hints, tabs UI
├── FocusController                  # focus graph + activate
├── PointerPolicy (existing)         # hover / warp
├── GrabResizeSession                # drag resize lifecycle
└── WindowManagerFacade              # thin: wires modules, public API for tests
```

**Data flow:**

```text
Meta event → WindowTracker → LayoutEngine (mutate tree)
                           → RenderPipeline (apply frames)
Keybinding → CommandBus → LayoutEngine / Rules / Settings
Settings change → SettingsBridge → affected modules only
```

### F4. Architecture rules (enforceable)

1. **Lifecycle purity:** No Meta/Shell side effects outside `enable()`; every `enable` side effect has a `disable` inverse.
2. **One owner per state:** Tree percents only via LayoutEngine; frame writes only via RenderPipeline; Meta signal connects only via WindowTracker.
3. **Commands are data:** All user actions are `AnvilAction` values handled by a registry—no new `case` in a 500-line switch.
4. **Freeze `window.ts` growth:** New features land in new modules; facade only wires.
5. **Async settlement:** Map/size/grab races go through named session helpers with unit tests; no ad-hoc timeout constants without a name.
6. **Rules are data:** Float/tile decisions only through RulesEngine (JSON + built-ins as rule entries).
7. **Types:** No new public `any`; Meta patches only in `window/types.ts`.
8. **File budget:** Soft cap **~500 LOC** per module; split when exceeded.
9. **Testing:** Pure layout/rules/commands unit-tested; E2E only for Meta integration.
10. **Language:** Use CONTEXT.md terms in code names (`TilingRender`, not `doLayoutPass`).
11. **Prefs contract:** Shell reacts only to GSettings keys / explicit reload triggers—no dual-writer races.
12. **Dependency direction:** `tree` pure core ← layout ← tracker/commands; never tree → full WM.

### F5. Prioritized roadmap

| Stage | Work                                                         | Outcome                | Effort | Status                |
| ----- | ------------------------------------------------------------ | ---------------------- | ------ | --------------------- |
| **0** | Adopt rules 1–4 in AGENTS/decisions; freeze window.ts growth | Stops bleeding         | S      | **done** (2026-07-10) |
| **1** | `AnvilAction` union + command registry **inside** WM         | Readable dispatch      | M      | **done** (2026-07-10) |
| **2** | Extract RulesEngine from `isFloatingExempt` + overrides      | One place for floats   | M      | **done** (2026-07-10) |
| **3** | Expand TilingRender; delete WM wrappers                      | Clear render ownership | M      | **done** (2026-07-10) |
| **4** | WindowTracker extraction (signals + track/destroy)           | Testable lifecycle     | L      | **done** (2026-07-10) |
| **5** | LayoutEngine extraction (tree ops + percent)                 | Pure layout unit tests | L      | **done** (2026-07-10) |
| **6** | GrabResizeSession                                            | Debuggable resize      | L      | **done** (2026-07-10) |
| **7** | Remove Tree→WM concrete dependency; strip node UI            | Clean graph            | L      | **done** (2026-07-10) |
| **8** | Keybinding table + SettingsBridge                            | Less string soup       | M      | **done** (2026-07-10) |

**F5 roadmap complete (stages 0–8):** architecture rules; `AnvilAction` + command registry;
**`RulesEngine`**; **`TilingRender`**; **`WindowTracker`**; **`LayoutEngine`**;
**`GrabResizeSession`**; **`TreeHost`** + **`tab-decoration.ts`**; **`keybinding-table.ts`**
(schema → AnvilAction) + **`SettingsBridge`** (GSettings key → host handlers).

### Residual findings roadmap (post-F5)

Address remaining individual findings (including P2/P3) beyond the prioritized F5 list.

| Stage  | Work                                                               | Findings                                                     | Status                |
| ------ | ------------------------------------------------------------------ | ------------------------------------------------------------ | --------------------- |
| **9**  | Hygiene: docs, enable/disabled, kbd wire, freeze/constraints notes | B1-1, B2-2 partial, B4-6, B4-8, B4-9, B7-3, B7-4, B8-3, C3-1 | **done** (2026-07-11) |
| **10** | Extension lifecycle types (optional fields, TestProbe)             | B1-2, B1-3                                                   | **done** (2026-07-11) |
| **11** | SessionFlags grouping                                              | B2-3                                                         | **done** (2026-07-11) |
| **12** | WindowResize direction enum + Snap cleanup                         | B3-4, B3-5                                                   | **done** (2026-07-11) |
| **13** | Reconcile exponential backoff                                      | B4-2                                                         | **done** (2026-07-11) |
| **14** | Single admit API + destroy pipeline                                | B4-5, B4-7                                                   | pending               |
| **15** | Tree pure: percent unset, focus loop, typed search                 | B5-3, B5-4, B5-5, B5-6                                       | pending               |
| **16** | setLayout, PointerPolicy always-on, FocusController                | B6-2, B6-3, B9-1, B9-2, B9-3                                 | pending               |
| **17** | Float classification cache + BorderController                      | B7-1, B7-2                                                   | pending               |
| **18** | Grab residual: size-changed drive, initRect off Node               | B8-5, B8-6                                                   | pending               |
| **19** | Split utils + class match policy                                   | B11-1, B12-3                                                 | pending               |
| **20** | CommandBus modules + WindowConfig schema + reduce `any`            | B3-1 full, B10-2, C4-1, D3-1, C1-1                           | pending               |
| **21** | Tree/render invariants docs + E2E notes                            | B5 invariants, D2-1, D2-2                                    | pending               |

Do **not** rewrite from scratch. Each stage should keep E2E green and prefer mechanical moves with behavior parity.

---

## Appendix A — File heat map

| Path                | ~LOC    | Heat | Notes            |
| ------------------- | ------- | ---- | ---------------- |
| `window.ts`         | 3495    | 🔴   | Extract first    |
| `tree.ts`           | 1550    | 🔴   | Split pure vs UI |
| `tiling-render.ts`  | 523     | 🟠   | Good direction   |
| `keybindings.ts`    | 425     | 🟡   | Table-drive      |
| `utils.ts`          | 466     | 🟡   | Split            |
| `pointer-policy.ts` | 278     | 🟢   | Good module      |
| `mutter-safe.ts`    | 60      | 🟢   | Keep             |
| `extension.ts`      | 297     | 🟢   | Lifecycle OK     |
| prefs/\*            | various | 🟢   | Separate process |

---

## Appendix B — Command inventory (`command` action names)

| Action name                                             | Family     |
| ------------------------------------------------------- | ---------- |
| FloatToggle, FloatClassToggle, FloatNonPersistentToggle | float      |
| Move                                                    | move       |
| Focus                                                   | focus      |
| Swap, WindowSwapLastActive                              | swap       |
| Split                                                   | layout     |
| LayoutToggle, LayoutStackedToggle, LayoutTabbedToggle   | layout     |
| ShowTabDecorationToggle                                 | layout/ui  |
| FocusBorderToggle                                       | ui         |
| TilingModeToggle                                        | mode       |
| GapSize                                                 | gaps       |
| WorkspaceActiveTileToggle                               | workspace  |
| SnapLayoutMove                                          | float/snap |
| WindowResize{Left,Right,Top,Bottom}                     | resize     |
| WindowClose                                             | window     |
| PrefsOpen                                               | ui         |
| CancelOperation                                         | grab       |

---

## Appendix C — Signal / source inventory (WindowManager)

**Display:** window-created, grab-op-begin/end, window-entered-monitor, showing-desktop-changed, in-fullscreen-changed, workareas-changed

**Window manager:** map, minimize, unminimize, show-tile-preview (empty)

**Workspace manager:** showing-desktop-changed, workspace-added/removed, active-workspace-changed

**Per workspace:** window-added

**Overview:** hiding, showing

**Settings:** changed (switch on key)

**Per Meta.Window (typical):** position-changed, size-changed, notify::wm-class/title, unmanaged, focus, workspace-changed

**Actor:** destroy, first-frame (reclassify / pending)

**GLib sources:** event queue timeout, render idle, reload idle, window reconcile 16ms loop, workspace changing 300ms, prefs open, live resize 16ms, grab end delayed

---

## Appendix D — Hypothesis validation

| Hypothesis                      | Verdict                                                               |
| ------------------------------- | --------------------------------------------------------------------- |
| WM is a god object              | **Confirmed** (B2-1)                                                  |
| command() wrong abstraction     | **Confirmed** (B3-1)                                                  |
| Tree + render dual path unclear | **Partially confirmed**—TilingRender helps; borders/float still split |
| Wayland async scattered         | **Confirmed** (B4, B8)                                                |
| Prefs/shell split OK            | **Confirmed** at process level                                        |
| Unit tests help pure core       | **Confirmed**; blocked by entanglement                                |

---

## Appendix E — “If we only do five things”

1. **Freeze** new logic in `window.ts`.
2. **Type and table-drive** `command()`.
3. **RulesEngine** for float/tile.
4. **Document tree/render invariants** + percent semantics.
5. **Extract WindowTracker** so lifecycle can be reasoned about alone.

---

_End of review document. Update this file as extractions land; treat architecture rules as the PR checklist._
