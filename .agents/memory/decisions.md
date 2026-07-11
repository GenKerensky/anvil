# Architecture Decisions

## Test infrastructure

- **`global.__anvil_extWm`** set in `enable()` always (not just test-mode) — bypasses GNOME 50 lookup
  proxy.
- **`global.__anvil_settings`** set in `enable()` always — `getSettings()` blocked by proxy too.
- **No GSettings writes from runner.js** — devkit shares host `~/.config/dconf/user`.
- **Devkit window exempt** via `src/config/windows.json` (`org.gnome.Shell`, `DevKit`, float).
- **Resolution fixed** to 1920×1080 via `--headless --virtual-monitor 1920x1080` (not `--devkit`,
  which adds a second 1280×800 monitor).
- **`ext.getSettings()`** (base Extension method, proxied) for constraint read/write in test helpers.
- **`sendKeyCombo()` / `getAnvilWM()`** use `global.__anvil_extWm`.

## Resize exemption

- **`_resizedWindows`** is `Map<number, number>` tracking resize counts per window.
- Exemption requires count ≥ 2 (first resize always clamped; async Wayland `size-changed` may arrive
  before counter increments).
- `clearResizedWindows()` in test `beforeEach` to prevent state bleed.

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

Full findings in **`codebase-review.md`** (repo root). Direction of travel without big-bang rewrite:

- Freeze growth of `window.ts`; extract CommandBus, RulesEngine, WindowTracker, LayoutEngine.
- Keep/extend `TilingRender` as sole geometry apply path.
- Enforce architecture rules listed in that document (lifecycle purity, one owner per state, typed
  actions, ~500 LOC module budget).

### F5 Stage 0 — rules adopted (2026-07-10)

Enforceable rules live in **`.agents/rules/architecture.md`** (also routed from `AGENTS.md`):

1. **Lifecycle purity** — no Meta/Shell side effects outside `enable()`; every effect has a disable inverse.
2. **One owner per state** — do not add second writers for frames, percents, or Meta signals.
3. **Commands are data** — user actions are `AnvilAction` values handled by a registry.
4. **Freeze `window.ts` growth** — new features in new modules; no new public WM methods without extracting a cluster first.

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
