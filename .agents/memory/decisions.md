# Architecture Decisions

## Anvil Runtime replacement (2026-07-12)

- **`AnvilRuntime` replaces `WindowManager`** as the active GNOME-aware tiling system. It owns the
  owner-module graph, host adapters, Tiling Tree state, and coordinated runtime lifecycle.
- **`AnvilExtension` remains the GNOME extension host** and owns GNOME settings overrides, theme,
  session-mode, Quick Settings, and global automation exposure.
- **Construction is inert.** Runtime graph construction and Tiling Tree actor/workspace activation
  occur in `AnvilRuntime.enable()`, not constructors.
- **Enable is atomic.** A partial failure disposes completed work, clears graph references, returns
  to `disabled`, and permits retry. Enable/disable are idempotent.
- **`EventScheduler` owns named FIFO delayed work**, its GLib source, pending count, and disposal.
- **Automation hard rename:** `global.__anvil_runtime` / `getAnvilRuntime()` replace the old WM names
  without aliases. E2E and debug code use `AnvilRuntimeTestProbe`, never private owner fields.
- **The runtime may exceed the soft module budget** because composition order, private host adapters,
  atomic rollback, and lifecycle teardown form one deep implementation behind a small interface.
  Extracting a host-wiring factory would fail the deletion test by moving the same graph knowledge;
  durable tiling behavior remains in its established owner modules.

## Test infrastructure

- **`global.__anvil_runtime`** set in `enable()` always (not just test-mode) — bypasses GNOME 50 lookup
  proxy.
- **`global.__anvil_settings`** set in `enable()` always — `getSettings()` blocked by proxy too.
- **No GSettings writes from runner.js** — devkit shares host `~/.config/dconf/user`.
- **Devkit window exempt** via `src/config/windows.json` (`org.gnome.Shell`, `DevKit`, float).
- **Resolution fixed** to 1920×1080 via `--headless --virtual-monitor 1920x1080` (not `--devkit`,
  which adds a second 1280×800 monitor).
- **`ext.getSettings()`** (base Extension method, proxied) for constraint read/write in test helpers.
- **`sendKeyCombo()` / `getAnvilRuntime()`** use `global.__anvil_runtime`.

## Resize exemption

- **`GrabResizeSession.resizedWindows`** (`Map<number, number>`) is the sole owner tracking
  resize counts per window (architecture rule §2 — migrated off `WindowManager._resizedWindows`).
- Exemption requires count ≥ 2 (first resize always clamped; async Wayland `size-changed` may arrive
  before counter increments).
- Test cleanup calls the owner interface `wm._grab.clearResizedWindows()` in `beforeEach` to
  prevent state bleed (do not clear the map from outside the owner).

## wl-clipboard / ephemeral Wayland helpers

Wayland creates short-lived helper windows (notably **`wl-clipboard`**, a 1×1 stub) during
delete/paste/clipboard sync. If Anvil tracks them, the helper can enter a split and
`window-destroy-quick` re-tiles the real TUI; focus bounces also trigger border relayout.

**Anvil policy (fully ignore):**

- `Utils.isEphemeralHelperWindow()` — matches `wl-clipboard`, `xclip`, `xsel` by wm class/title,
  or any ≤2×2 frame stub.
- `_validWindow()` returns `false` → never tracked, no signal handlers.
- `isFloatingExempt()` returns `true`; `windows.json` has `{ "wmClass": "wl-clipboard", "mode": "float" }`.
- `windowDestroy` skips `renderTree` for float/ephemeral nodes.
- Focus handler returns early for ephemeral windows (belt-and-suspenders).

**Residual symptom:** a subtle terminal titlebar brightness flash may still occur when Mutter
briefly focuses `wl-clipboard` at the compositor level; the extension cannot suppress that.

## Shared test commands

- `test/lib/shared-commands.js` is single source of truth for E2E + debug-loop GJS helpers.

## Single real-shell suite (2026-07-10)

- **Removed Podman container integration tests** (`test/integration/`). Multi-Fedora matrix CI
  dropped; host GNOME version is the E2E target.
- **Consolidated** unique behavioral specs into `test/e2e/suites/` (focus, swap, move, floating,
  layouts, workspace, borders, minimize, constraints; richer lifecycle + tiling).
- **Dropped** shallow GSettings smoke (`settings.js`) and broken AT-SPI prefs suite.
- **Canonical real-shell gate:** `make test-e2e` (Jasmine + `--headless --virtual-monitor`).
- CI runs unit only (`typecheck` + `lint` + `test:unit`); E2E is local/pre-release.

## Architecture direction (2026-07-10)

Full findings in **`codebase-review.md`** (repo root). Extractions modules (CommandBus, RulesEngine,
WindowTracker, LayoutEngine, TilingRender, …) are the preferred owners; rules live in
**`.agents/rules/architecture.md`**.

### window.ts freeze lifted (2026-07-11)

- Historical review said “not a big-bang rewrite” / “freeze `window.ts` growth” (F4 rule 4 / Stage 0).
- **Superseded:** agents may **big-bang refactor or rewrite** `src/lib/extension/window.ts` when
  tests and one-owner rules still hold. Soft ~500 LOC module budget remains a guide, not a ban.
- Still required: lifecycle purity, one owner per state, commands as data, TreeHost dependency direction.

### Architecture rules synthesis (2026-07-11)

Full review (`codebase-review.md` F3–F4 + F5/residual extractions) synthesized into
**`.agents/rules/architecture.md`** — the agent-facing source of truth for:

- Owner table (CommandBus, RulesEngine, WindowTracker, LayoutEngine, TilingRender, …)
- All 12 F4 rules expanded with do/don’t and file paths
- Tree/render invariants, feature checklist, anti-patterns
- Prefs↔shell contract and dependency direction

`codebase-review.md` remains historical. Route: `AGENTS.md` → architecture rules on tiling-core work.

### F5 Stage 0 — rules adopted (2026-07-10)

Enforceable rules live in **`.agents/rules/architecture.md`** (also routed from `AGENTS.md`):

1. **Lifecycle purity** — no Meta/Shell side effects outside `enable()`; every effect has a disable inverse.
2. **One owner per state** — do not add second writers for frames, percents, or Meta signals.
3. **Commands are data** — user actions are `AnvilAction` values handled by a registry.
4. **Module budget** — soft ~500 LOC; `window.ts` may be big-bang refactored (freeze lifted 2026-07-11).

### F5 Stage 1 — typed command registry (2026-07-10)

- **`AnvilAction`** discriminated union: `src/lib/extension/window/actions.ts`.
- **`WindowManager.command(action: AnvilAction)`** dispatches via an in-WM handler registry (no mega-switch).
- Handlers remain private methods on WM until later extraction stages (full CommandBus / per-family modules).

### F5 Stage 2 — RulesEngine (2026-07-10)

- **`RulesEngine`** (`src/lib/extension/rules-engine.ts`) is the sole owner of float/tile classification
  and float override add/remove/reload.
- Evaluation order (tile JSON → ephemeral → built-ins → type OR float JSON) preserved for parity.
- Title match mini-language documented on the module; exported as `windowTitleMatchesOverride`.
- `WindowManager.isFloatingExempt` / override methods are thin facades; do not reintroduce parallel rules.

### F5 Stage 3 — TilingRender ownership (2026-07-10)

- Deleted WM thin wrappers: `calculateGaps`, `processFloats`, `enforceUltrawideSize`,
  `_getMonitorConnector`, `_getMonitorConstraints`.
- Callers use **`wm.tilingRender`** (or `this._tilingRender` inside WM).
- `renderTree` stays on WM (idle/freeze/tiling-mode + borders); geometry apply stays on `TilingRender`.

### F5 Stage 4 — WindowTracker (2026-07-10)

- **`WindowTracker`** (`src/lib/extension/window-tracker.ts`) owns validity gate, pending admit,
  track/destroy, reconcile loop, per-window lifecycle signal connects, and display `window-created` /
  WM `map` entry (via host callbacks for render/UI).
- WM methods (`trackWindow`, `_validWindow`, `windowDestroy`, …) are thin facades for tests.
- Host interface (`WindowTrackerHost`) avoids importing concrete WindowManager into tracker.
- Residual Meta connects on WM: grab-op, settings, overview, workspace manager, minimize/unminimize.

### F5 Stage 5 — LayoutEngine (2026-07-10)

- **`LayoutEngine`** (`src/lib/extension/layout-engine.ts`) owns layout algebra (focus/move/swap/split),
  percent compute/reset/redistribute, `determineSplitLayout`, `autoSplitFromFocus`.
- Tree methods for those ops are thin delegates to `extWm.layoutEngine` (bridge until Stage 7).
- WindowTracker auto-split calls layout policy — no `command({ name: "Split" })` re-entry.
- Construct LayoutEngine **before** Tree so workspace bootstrap can call `determineSplitLayout`.

### F5 Stage 6 — GrabResizeSession (2026-07-10)

- **`GrabResizeSession`** (`src/lib/extension/grab-resize-session.ts`) owns grab-op session state,
  live 16ms resize loop, `_handleResizing` percent apply, neighbor `move_resize_frame`, exemption
  `_resizedWindows` Map, keyboard `resize` begin/end orchestration via host.
- Pure **`percentsFromSizeDelta`** for sibling percent math (keyboard + grab).
- Node still stores `grabMode` / `initRect` / `initGrabOp` during a grab (parity); session owns maps
  and GLib sources. `moveWindowToPointer` stays on WM (host callback).

### F5 Stage 7 — TreeHost + strip node UI (2026-07-10)

- **`TreeHost`** interface: Tree no longer imports `WindowManager`. Host provides settings,
  `focusMetaWindow`, `determineSplitLayout`, `floatingWindow`, `bindWorkspaceSignals`.
- Layout facades removed from Tree; all split/move/swap/focus/percent ops go through **LayoutEngine**.
- Tab/con decoration St construction moved to **`tab-decoration.ts`** (`ensureWindowTab`,
  `ensureConDecoration`, `destroyConDecoration`, `refreshTabTitle`).
- Residual: CON/ROOT as `St.Bin`, workspace `actorBin`, grab `previewHint` on Node.

### F5 Stage 8 — Keybinding table + SettingsBridge (2026-07-10)

- **`KEYBINDING_TABLE`** in `keybinding-table.ts`: schema key → static `AnvilAction` or factory
  (resize amount read at invoke time). `Keybindings` builds handlers from the table.
- **`SettingsBridge`**: GSettings `changed` → handler map on a host; enable/disable owns the
  connect id. Removes the mega-switch from `WindowManager._bindSignals`.
- **F5 prioritized roadmap fully complete.**

### Residual Stage 21 — invariants + E2E docs (2026-07-11)

- Tree/render invariants in CONTEXT.md + architecture.md (B5).
- E2E: prefer percent/relative asserts (D2-1); PR `--tag` vs nightly full suite (D2-2).
- **Residual findings roadmap (stages 9–21) complete.**

### Residual Stage 20 — CommandBus + schema (2026-07-11)

- **CommandBus** owns AnvilAction handler table; WM.command delegates; injectable
  `commandBus` for keybindings/tests (B3-1 full, B10-2).
- **WindowConfig** shared types + `isWindowConfig` guard for prefs/shell (C4-1).
- **QuickSettingsExternalIndicator** adapter type (C1-1); architecture rule 7 reaffirmed (D3-1).

### Residual Stage 19 — utils split + class match (2026-07-11)

- Split utils into `utils/geometry`, `window-filters`, `decorations`, `version`,
  `create-enum` with barrel re-export (B11-1).
- **classMatches** policy: exact / `~` contains / glob / `re:` regex (B12-3).

### Residual Stage 18 — grab session ownership (2026-07-11)

- Grab initRect/grabMode/initGrabOp owned by GrabResizeSession map (mirrored on Node) (B8-6).
- Live 16ms resize poll only on Wayland; X11 uses size-changed path (B8-5).

### Residual Stage 17 — float cache + BorderController (2026-07-11)

- RulesEngine caches match() by window id + identity until override reload (B7-1).
- **BorderController** owns focus/split border actors; WM is a facade (B7-2).

### Residual Stage 16 — layout/focus/pointer (2026-07-11)

- **LayoutEngine.setLayout** for stacked/tabbed toggles (B6-2); determineSplitLayout already
  unit-tested (B6-3).
- **FocusController** owns directional focus + stacked/tabbed helpers (B9-1, B9-3).
- **PointerPolicy** always constructed; prefs only enable/disable behavior (B9-2).

### Residual Stage 15 — tree purity (2026-07-11)

- Sibling **percent** uses `undefined` for unset (equal share); `isUnsetPercent` helper (B5-3).
- **focus** uses loop + visited set for minimized skip (B5-4); `_resolveFocusTarget` extracted.
- **NodeSearchCriteria** typed for `_search` (B5-5); debug\* gated by Logger.isDebugEnabled (B5-6).

### Residual Stage 14 — admit API + destroy pipeline (2026-07-11)

- **`admitWindow`** single entry for window-created / map / workspace-added (B4-5).
- **windowDestroy** ordered pipeline: borders → detach → focus → attachNode → one render (B4-7).

### Residual Stage 13 — reconcile exponential backoff (2026-07-11)

- Replaced 120×16ms busy loop with backoff (16→256ms), stop after 2 stable ticks
  or 2s budget; `reconcileCurrentWindows` returns admit count (B4-2).

### Residual Stage 12 — WindowResize + snap layout (2026-07-11)

- Single **`WindowResize`** action with `direction` enum (B3-5); keybindings/tests/e2e updated.
- **`computeSnapLayout`** pure helper in `snap-layout.ts` for SnapLayoutMove (B3-4).

### Residual Stage 11 — SessionFlags (2026-07-11)

- Transient overview/workspace/freeze booleans grouped in
  `window/session-flags.ts` (`SessionFlagsState` / `createSessionFlags`) with
  WM accessors for compatibility (B2-3). Grab state stays on GrabResizeSession.

### Residual Stage 10 — extension lifecycle types (2026-07-11)

- Subsystem fields on `AnvilExtension` are private `_x: T | null` with throwing getters
  while enabled — no `null as unknown as T` on disable (B1-2).
- **`AnvilTestProbe`** + `WindowManager.getTestStateJson()` + `Tree.serializeForTest()` —
  official test API; extension no longer walks private `_tree`/`_nodes` (B1-3).

### Residual Stage 9 — hygiene (2026-07-11)

- Documented **test-mode / unsafe_mode** danger (B1-1); never for end users.
- **wireKeybindings()** after Keybindings construct; `kbd` getter no longer lazy-creates (B4-9, B2-2 partial).
- **enable()** sets `disabled = false` (B4-8).
- Empty **show-tile-preview** handler documented (suppress Mutter default preview) (B4-6).
- Freeze protocol + constraints clamp-applied-rect docs on TilingRender (B7-3, B8-3).
- **Logger.isDebugEnabled()** gates debugTree on render hot path (B7-4).
- Prefs→shell GSettings contract documented on SettingsBridge (C3-1).

## Agent skills: gnome-shell-debug module (2026-06-24)

The debug skill module was deepened with two explicit seams:

- **Devkit Seam** (default): interactive debugging, LG, visual, rebuild loops. Primary deep launcher is `run-devkit-session.sh`.
- **Headless Seam**: only when explicitly called for or when the task can be handled independently by headless (e.g. settings toggles / GSettings changes without UI/LG).

The module owns the facts for both (locality). SKILL.md is now the deep implementation with common content inlined. Cross-references in context/debugging.md and testing/SKILL.md were reduced to thin pointers. Legacy scripts remain for rare cases but are subordinated in docs.

This improves depth, leverage (one load for the default path), and removes duplication while preserving progressive disclosure for rare paths (GDB) and the "execute scripts yourself" rule.

## Agent debug loop (gnome-shell-debug v3, 2026-06-26)

- **Evolve in place** — Agent Loop is the third seam in `gnome-shell-debug` v3.0, not a sibling skill.
- **Headless-only v1** — `--headless --virtual-monitor 1920x1080`; devkit escalation via `run-devkit-session.sh`.
- **Launcher-style XDG** — temp `XDG_*` under session dir + symlink `dist/`; never install to `~/.local` in the loop.
- **One `run` = one iteration** — agent owns outer loop; `--max-iterations` is agent policy (~10), not CLI.
- **Build in bash wrapper only** — `run-debug-loop.sh` owns `make build debug`; Python always gets `--no-build` from wrapper.
- **`ANVIL_DEBUG_LOOP_ON_HOST=1`** — distrobox re-exec sentinel (parallel to `ANVIL_DEVKIT_ON_HOST`).
- **Extension enable before READY** — `HeadlessShellSession.__enter__` enables + polls ACTIVE before automation script work.
- **Staged repro execution** — author under `test/debug/`; orchestrator stages into session dir and runs staged copy (symlinks rejected); audit snapshot at `$SESSION_DIR/repro.js`.
- **Session-scoped results** — default `$SESSION_DIR/repro-results.json` via `ANVIL_DEBUG_RESULTS`.
- **No `--force-host-session`** — fail-closed host bus / XDG guardrails in `host_guard.py`.
- **Post-fix devkit is user-opt-in** — agent asks; never auto-launches devkit after headless fix.
- **Shared library** — `test/lib/shell_session.py` extracted from E2E; E2E migration optional (PR 6).

## window.ts refactor (2026-07-11)

- **Extraction approach**: Split WindowManager into focused modules, each with its own `*Host` interface.
  Stages 0–5 create: `drag-drop-tile.ts`, `signal-manager.ts`, `command-handlers.ts`,
  `workspace-mutations.ts`, `render-scheduler.ts`, `decoration-layout.ts`. `window.ts` shrinks
  from 2341 → 1082 LOC (−54%).
- **Host interface widths**: Narrow for DragDropTile, RenderScheduler, DecorationLayout,
  WorkspaceMutations. `SignalManagerHost` (~20) and `CommandHandlerHost` (~25) are **accepted
  wide dispatch seams** — structural interfaces (no `WindowManager` import), deletion-test-justified
  (deleting them re-spreads the fanned-out wiring across WM).
- **Freeze-state ownership (C2/C3, rule §2)**: Storage stays on `SessionFlagsState.freezeRender`,
  read/written only through WM's `_freezeRender` getter/setter → `this._session.freezeRender`.
  RenderScheduler, SignalManager, and CommandHandlers are **callers** via
  `host.freezeRender()/unfreezeRender()/isRenderFrozen()` — single storage, single setter path,
  no second writer. Reuses existing `isRenderFrozen` (did not add `freezeRenderState`).
- **`workspaceChanging`**: Storage on `SessionFlagsState`; **sole writer = SignalManager** (via the
  300ms `active-workspace-changed` timeout through the host setter); **sole reader = PointerPolicy**.
- **`nodeWinAtPointer` (C13)**: Storage stays on WM (shared grab/drag field). **Writer =
  GrabResizeSession** via the `GrabResizeHost` setter; **reader = DragDropTile** via a `readonly`
  host view. Not a second writer.
- **Grab state**: `grabOp`/`cancelGrab`/`resizedWindows` storage lives **only** on
  `GrabResizeSession`. WM's `grabOp`/`cancelGrab`/`_resizedWindows` facades were removed; tests +
  `test/e2e/lib/commands.js` now read `wm._grab.*` directly.
- **`bindWorkspaceSignals` (C11)**: `SignalManager` owns the connect/disconnect implementation.
  WM's `bindWorkspaceSignals(ws)` is a thin TreeHost/test facade that delegates to
  `this._signalManager.bindWorkspaceSignals(ws)`. SignalManager is constructed **before** Tree in
  the WM constructor because Tree.\_initWorkspaces() calls `bindWorkspaceSignals` during construction;
  all SignalManager host accessors are lazy, so later subsystems need not yet exist. This removed a
  dead duplicate of the method that had been left on WM.
- **Dead-state removal (C5)**: `fromOverview`/`toOverview` were dead writes (zero readers) — deleted
  from `SessionFlagsState` and WM accessors; `TODO(overview-thrash)` markers left at the overview
  hiding/showing handlers. Overview-thrash skip was intended but never wired — suspected latent bug
  logged for deliberate re-implementation if needed.
- **C8 correction**: `_prefsOpenSrcId` was vestigial dead state in the original WM (declared,
  removed in `_removeSignals`, but **never assigned** — `handlePrefsOpen` calls
  `host.ext.openPreferences()`). Rather than own the dead source in a command-handlers `dispose()`, it
  was removed entirely; `createCommandHandlers(host)` now returns a `CommandBusHost` directly and WM
  no longer keeps a `_commandHandlers` field. The Stage 3 disable pipeline dropped the no-op
  `_commandHandlers.dispose()` line.
- **Stage 6 facade cleanup**: Removed non-host/non-test forwarding stubs — `showWindowBorders`,
  `_clearPendingWindowSignals`, `trackWindow`, `postProcessWindow`, `trackCurrentWindows` (stub),
  `windowDestroy`, `_restoreFocusAfterWindowClosed`, `_getDragDropCenterPreviewStyle`, plus dead
  `windowsActiveWorkspace`. Tests updated to call owner subsystems directly (`_tracker.*`,
  `_borders.*`). SignalManager now calls `host.tracker.trackCurrentWindows()` (removed from
  `SignalManagerHost`); RenderSchedulerHost routes `trackCurrentWindows` to `self._tracker.*`.
  Host-contract facades (`renderTree`, `ensureBorderActors`, `queueEvent`, `move`, `rectForMonitor`,
  `floatingWindow`, etc.) and the public test API (`getTestStateJson`, `toggleFloatingMode`, `resize`,
  `isActiveWindowWorkspaceTiled`, `floatAllWindows`, …) are retained.
- **Dependency direction (rule §12)**: `tree.ts` and all six new modules import **no** concrete
  `WindowManager`. Verified by grep on build.
- **LOC budget reconciliation (rule §8, Stage 6 gate `≤ 600`)**: The `≤ 600` target is **not
  achievable as the plan specifies**. Evidence: (1) the plan's own Post-Refactor File Inventory
  per-item budget sums to **~830, not ~600** (the "Total ~600" header is an arithmetic error); (2)
  the inventory assumed the constructor is ~180 LOC, but Prettier **forces** trivial getters to stay
  multi-line, making the constructor ~340 LOC (~+160); (3) the only remaining lever — extracting the
  host-wiring into a builder module — the plan explicitly forbids ("adds indirection without
  improving clarity"). Hitting 600 would require fighting the formatter (breaks the lint gate), adding
  the plan-forbidden builder, or removing host-contract facades (violates §7/§4). **Decision
  (user-approved 2026-07-11): accept the faithful no-builder floor at 1082 LOC**; all substantive
  non-host/non-test stubs are removed and `npm test` (typecheck + lint + 891 unit tests) is green.
- **`command-handlers.ts` §8 (520 LOC)**: ~20 LOC over the soft cap. The module is one intrinsic
  concern (22 command handlers + host + factory); the dead `_prefsOpenSrcId`/`dispose` code was
  removed to take it from 538 → 520. Splitting would add an artificial seam with no concern boundary
  (§8 says split _by concern_); a single file is the right shape. Accepted at 520 as marginally over
  the soft cap. (No external plan document references this; the decision is self-justified here.)
- **Architecture-rule verification**: §2 (one owner per state — layout/percent/tree-structure
  writes routed through `LayoutEngine`; see review-fix notes below), §7 (no new public `any` on
  exported host interfaces — the four new `*Host` interfaces use `Node<NodeType>` instead of
  `Node<any>`; the surviving `any` in `decoration-layout.ts`/`drag-drop-tile.ts` are inline callback
  params in non-exported closures, not public API), §12 (no WM imports in new modules) all green.
- **E2E**: `make test-e2e` was **not** run in this environment (requires host `gnome-shell` +
  `jasmine-gjs`; `build.md` notes CI runs unit only and E2E is a host-run pre-release gate). Unit
  typecheck/lint/891 tests pass. Lifecycle/grab/render E2E should be run on a host before release.

### E2E harness + pre-existing failures fixed in fedora-devbox (2026-07-11)

Ran the full E2E suite in the `fedora-devbox` distrobox (Fedora 44, GNOME Shell 50.3,
jasmine-gjs). The baseline (pre-refactor HEAD) was **13 passed / 112 failed** because the
harness was broken, not because the extension was broken. After the fixes below the full
suite is **125 passed / 125 passed** (stable across two consecutive runs).

- **specFilter bug (runner.js)**: `runner.env.specFilter` is a deprecated getter in this
  jasmine-gjs and `originalFilter(spec)` threw, so `--tag` ran ALL specs every time and
  attributed failures wildly. Rewrote the filter to a plain substring match (no deprecated
  getter) AND added **import-level filtering** — only suites whose basename includes the tag
  are imported, so non-matching `describe`s never register. Robust against jasmine specFilter
  quirks.
- **Reporter suite stack (runner.js)**: `suiteStarted`/`suiteDone` used a single `currentSuite`
  with a name match, so nested `describe` blocks misattributed specs and spec-less suites were
  recorded. Replaced with a proper suite **stack** (push on start, pop+record on done) so specs
  attach to the innermost active suite and spec-less suites are dropped.
- **`--tag` isolation confirmed**: `--tag focus` → 4/4, `--tag tiling` → 8/8, `--tag resize` →
  74/74, `--tag constraints` → 4/4, `--tag floating` → 6/6.
- **S2 (real bug found via E2E)**: `SignalManager.bindAll()` set `_signalsBound = true` AFTER
  the per-workspace binding loop, so the S2 lifecycle gate made the loop a no-op — workspace
  `window-added` signals were never bound. Fixed by setting the flag BEFORE the loop.
- **Keyboard resize ignored monitor constraints (pre-existing)**: `command-handlers.resize()`
  called `host.move()` with the grown rect directly; the render-time clamp
  (`TilingRender.enforceUltrawideSize`) could not reposition the window while an active grab
  held it (Mutter rejects `move_resize_frame` during a grab, and `apply` swallows the throw),
  so the keyboard-resized window stayed at the un-clamped size. Fixed by clamping the
  requested rect to active constraints at the source (`enforceUltrawideSize` before `move`).
  Resize suite still 74/74.
- **FloatClassToggle flakiness (pre-existing test hygiene)**: `FloatClassToggle` is a **toggle**;
  the floating suite's `afterEach` did not remove the Nautilus class float override it added, so
  the override persisted to `~/.config/anvil/config/windows.json` (the `ConfigManager.windowProps`
  setter writes the file) and a later toggle un-floated instead of floating. Added
  `clearFloatOverridesForClass(wmClass)` to `shared-commands.js` (persists the removal via the
  configMgr setter) and call it in the floating suite's `beforeEach`/`afterEach` and in the
  runner's global reset.
- **Global state reset (runner.js `run()`)**: the headless session shares the user dconf db, so
  prior runs left `workspace-skip-tile` / `monitor-constraints` / persisted Nautilus float
  overrides behind, making the first tiling spec see Nautilus as float-exempt (window opened
  floated at its persisted preferred size). Added a reset at the start of `run()` (using the
  extension's `global.__anvil_settings`, not a fresh `Gio.Settings` — different backends in the
  isolated session) that re-enables tiling, clears skip-tile + constraints + resized windows +
  Nautilus float overrides. Also cleaned the stray Nautilus override from the devbox's user
  config file.
- **E2E resize cleanup (Spec-P1)**: `test/lib/shared-commands.js` `clearResizedWindows` calls
  the owner `wm._grab.clearResizedWindows()`. Removed the duplicate helper from
  `test/e2e/lib/commands.js` (suites import the shared one).
- **History**: `codebase-review.md` is left as a historical snapshot (C7); the living module map
  is `.agents/context/architecture.md`.

### window.ts refactor review fixes (2026-07-11)

Follow-up to the unstaged code review (`window-ts-refactor-code-review.md`). All findings fixed;
`npm test` green at 901 unit tests.

- **S1 (owner-compliant writes)**: Command handlers no longer mutate tree-structure / layout /
  sibling percents directly. New `LayoutEngine` methods — `toggleSplitLayout`, `setAttachNode`,
  `resetPercentForFloatToggle`, `raiseInStacked`, `reparentToNode` — own those writes; handlers express
  intent only. `drag-drop-tile.ts` layout writes go through `host.layoutEngine.setLayout`;
  `workspace-mutations.updateMetaWorkspaceMonitor` reparents via `reparentToNode`. Unit tests added in
  `layout-engine.test.ts`.
- **S2 (lifecycle)**: `SignalManager.bindWorkspaceSignals` is now lifecycle-gated — it early-returns
  when `!_signalsBound`, so the construction-time call from `Tree._initWorkspaces` → `Tree.addWorkspace`
  no longer connects `Meta.Workspace` signals outside `enable()` (architecture rule §1). The real
  per-workspace binding happens in `bindAll()` (loops existing workspaces) and in the runtime
  `workspace-added` handler (with `_signalsBound` true). `unbindAll()` disconnects them. Also,
  `unbindAll()` resets the `workspaceChanging` flag when cancelling the transition timer, and
  `WindowManager.enable()` resets it before rebinding.
- **S3 (no public `any`)**: Added `NodeType` union to `tree.ts`; the four exported `*Host` interfaces
  (`CommandHandlerHost`, `SignalManagerHost`, `WorkspaceMutationsHost`, `DragDropTileHost`) use
  `Node<NodeType>` instead of `Node<any>`.
- **S4 (transition flag)**: `SignalManager.unbindAll()` resets `host.workspaceChanging = false` when
  it cancels the 300ms timer; `WindowManager.enable()` also resets it before `bindAll()`. Covered by
  `SignalManager.test.ts` + a lifecycle test.
- **S5 (docs)**: Restored `codebase-review.md` (was erroneously deleted). Removed all
  `@see window-ts-refactor.md` references from the six new modules (pointed at architecture rules +
  decisions instead). Restored the multi-monitor rationale comment in `decoration-layout.ts`.
- **S6 (middle-man cycles / unused seams / honest interface)**: `handleFloat` and
  `handleWindowResize` call the same-module `toggleFloatingMode` / `resize` helpers directly instead
  of routing through the WM facade and back. Removed unused `SignalManagerHost` members
  (`grabSession`, `reloadTree`, `resetSiblingPercent`) and `CommandHandlerHost.isRenderFrozen` (and
  their WM wiring). `workspace-mutations.ts` is now a `WorkspaceMutations` class (one honest
  interface) instead of ten free functions.
- **S7 (test surface)**: E2E `clearResizedWindows` calls the owner interface
  `wm._grab.clearResizedWindows()` (in both `test/lib/shared-commands.js` and the E2E helper);
  removed the duplicate E2E helper. Unit tests no longer reach into `wm._grab.resizedWindows` (the
  internal `Map`): new `GrabResizeSession` probes `hasResizeCount` / `getResizeCount` /
  `resizeCountEntries` / `seedResizeCount` (test-only) replace `.has/.get/.set/.size/.clear`.
  The `FloatToggle` / `WindowResize` command tests assert through the owner (tree node mode,
  `GrabResizeSession.begin`) instead of the WM `toggleFloatingMode`/`resize` middle-man facades.
  Added a `DragDropTile` placement/mutation test (center SWAP via `LayoutEngine.swapPairs`).
  Remaining `wm._tracker.*` / `wm._borders.*` access goes through **public** subsystem fields (no
  `private` keyword) to test real owner behavior — accepted as the test surface; the harmful cases
  (internal-Map mutation, underscore-helper-only coverage) are fixed.
- **Spec-P1 (E2E resize cleanup)**: `test/lib/shared-commands.js` `clearResizedWindows` updated to
  call `wm._grab.clearResizedWindows()` (the owner) instead of clearing the removed `wm._resizedWindows`
  map (which silently no-op'd and let resize counts bleed between specs).

### Follow-up audit fixes (2026-07-11, commit `418ebd4`)

A second audit of the refactor found remaining work; all resolved.

- **S1 / Spec-P1 (drag-drop placement ownership)**: `DragDropTile.moveWindowToPointer` no longer
  rewrites the Tiling Tree directly. It now computes a pure `DragDropPlan` (region hit-test +
  resolved container/reference/layouts as data) and delegates the **entire** structural
  transaction to one new `LayoutEngine.applyDragDrop(plan)` method, which is the sole place that
  `insertBefore` / `appendChild` / `new Node(CON)` / `resetSiblingPercent` /
  `setLayout` / `resetLayoutSingleChild` run for a drop. St actor UI (preview hint, tab cleanup)
  stays in `DragDropTile`; tree structure / percents / layouts do not. A new
  `LayoutEngine._createConNode` / `resetLayoutSingleChild` owns those primitives.
- **R1 (no new public `any`)**: the new `LayoutEngine` methods (`toggleSplitLayout`,
  `setAttachNode`, `resetPercentForFloatToggle`, `raiseInStacked`, `reparentToNode`,
  `applyDragDrop` + the `DragDropPlan` interface) and `DragDropTile.moveWindowToPointer` /
  `findNodeWindowAtPointer` now use `Node<NodeType>` instead of `Node<any>`.
- **S7 (drag-drop test surface)**: the placement test no longer reaches through the private
  `wm._dragDrop` composition seam — it drives the existing `dragDrop` test subject via `mockHost`
  and asserts owner behavior. Added create-con, detach-window (split), simple-insert, and
  center-SWAP cases.
- **R2 (`--tag resize` smoke contract)**: the import-level tag filter now has an explicit
  `TAG_EXPANSIONS` map; `resize` selects both `resize.js` and `constraints.js` (the basename
  substring filter silently dropped `constraints.js` because "constraints" does not contain
  "resize"). Other tags still use basename substring; extension.js stays last.

### Window hint corner masks (2026-07-12)

- **Configured-radius mask, not outline inference**: while either focus or split hints are enabled,
  every Anvil-tracked normal window is continuously cropped to the configured hint radius plus
  half the hint stroke in the window's local rectangle. The half-stroke margin keeps differing
  St/GLSL anti-alias coverage from exposing client pixels. Anvil does not inspect client pixels or
  attempt to infer each application's decorations.
- **BorderController owns policy and lifecycle**: it attaches, refreshes, and removes the named
  mask effect alongside border actors. A dedicated `WindowCornerMaskEffect` owns only the
  compositor-native GLSL crop; `WindowTracker` delegates visual teardown to the controller.
- **State exceptions**: maximized and fullscreen windows have neither masks nor hint borders.
  There is no monitor-edge or zero-gap corner detection and no custom transition animation.
- **Failure policy**: effect setup fails open, retaining the existing unmasked rounded border and
  logging once. No CPU texture readback or supported-Shell-version reduction is acceptable for
  this cosmetic feature.

### Platform-independent Tiling State (2026-07-13)

- The Tiling State Machine will own a new platform-independent **Tiling State** whose entities are
  keyed exclusively by **Tiling Identity**. The existing GObject-based `Tree` is a legacy model to
  retire, not the implementation to purify in place. Live GNOME objects remain in Anvil Runtime and
  cross the boundary only as normalized Platform Facts or Tiling Intentions. See
  `docs/adr/0001-platform-independent-tiling-state.md`.
- The Tiling State Machine is the sole owner of Tiling State, its revision sequence, event ordering,
  and event processing. Anvil Runtime observes GNOME and submits normalized Tiling Events; it has no
  direct state-mutation path. The state machine may derive Reconciliation Events internally.
- Tiling transitions use **commit first, reconcile afterward** semantics. Processing an event
  synchronously commits its state and revision before Runtime applies the returned intentions.
  Delayed, clamped, or failed GNOME effects do not roll state back; Runtime reports their observed
  results as Platform Facts, and persistent divergence is handled through reconciliation.
- `SurfaceId` is the core's sole placement-space identity. The core has no workspace, monitor, or
  output identities; the adapter decides what comprises a Surface and translates its local geometry.
  A Surface may be one workspace/output pair or a workspace spanning outputs. The v1 geometry
  contract is one rectangular layout canvas per Surface; genuinely non-rectangular regions are
  exposed as multiple Surfaces until region-set geometry is designed explicitly.

### Rounded window shadow ownership (2026-07-13)

- **BorderController owns replacement shadows**: while window hint masking is active, each normal
  tracked window has a dedicated `cornerShadow` actor below its window actor. This preserves a
  rounded shadow for unfocused windows instead of coupling the replacement shadow to the focused
  border actor.
- **Focus is presentation state**: the shadow actor switches between
  `.window-focused-shadow` and `.window-unfocused-shadow`; it is repositioned from the same
  frame-plus-border-inset geometry as the concentric mask and hint. Maximized/fullscreen windows
  hide the actor, and controller teardown removes it.
- **The user stylesheet is the configuration contract**: focused and unfocused `box-shadow`
  declarations hold offset, blur, spread, color, and opacity. Appearance preferences edit those
  declarations through `PrefsThemeManager`; the existing `css-updated` event reloads the shell and
  refreshes decoration layout without adding parallel GSettings state.

### Portable admission order and minimum-size facts (2026-07-13)

- **Fact order may define structural order**: snapshot and multi-window `FactsObserved` input order
  is preserved when attaching newly participating windows. Canonical inspection sorting is a
  separate concern and must never rewrite container child order.
- **Selection is the insertion anchor**: a newly participating window is inserted immediately after
  its target container's selected child. A per-batch cursor preserves the submitted order for
  multiple admissions without reordering existing children or treating focus as structural order.
- **Minimum sizes cross the boundary as frame dimensions**: the GNOME adapter reads
  `Meta.Window.get_min_size()` and converts the client rectangle with Mutter's frame/client
  conversion methods before emitting `WindowFact.minimumSize`. The portable renderer applies the
  minimum after gap and maximum-constraint derivation, matching the frame Mutter can actually set.

### Portable container presentation ownership (2026-07-13)

- **Header reservation is render-plan geometry**: stacked/tabbed containers retain their full
  rectangle and expose a surface-local `headerRect`; descendant window frames are derived from the
  remaining content rectangle. Runtime never subtracts a GNOME-specific tab height.
- **Tab order and compositor order are distinct**: `ContainerPlan.windowIds` is stable structural
  leaf order, while `stackingOrder` is a bottom-to-top list of leaf `WindowId`s with the selected
  subtree last. Container identities never cross into the compositor raise effect.
- **Presentation effects have explicit lifecycles**: the core emits `PresentContainer`,
  `RemoveContainerPresentation`, and `RaiseWindows`. `GnomeContainerPresenter` alone owns the St
  actors and resolves identities at application time; the legacy Tree is not consulted.
- **Core commands do not fall through to legacy topology writers**: platform-owned actions such as
  `ShowTabDecorationToggle` mutate their platform setting and submit `PolicyReplaced` directly.
  They must not dispatch through CommandBus when the core writer is active.
- **GNOME frame signals sample active portable grabs**: the core-mode tracker submits the observed
  frame, resize delta, and pointer position through the operation adapter. Drag previews are St
  effects owned by `GnomePreviewPresenter`; drag-end commits or cancels the operation event and
  never asks `GrabResizeSession` or `DragDropTile` to mutate topology.
