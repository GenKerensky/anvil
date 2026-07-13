/**
 * SignalManager — global signal bind/unbind + workspace timeout (Stage 1).
 *
 * Moved from AnvilRuntime._bindSignals / signal ID arrays /
 * _workspaceChangingTimeoutId.  Owns connect/disconnect only; the
 * AnvilRuntime coordinates the teardown pipeline.
 *
 * This host is intentionally wide because signal binding fans out to every
 * subsystem.  It is a structural interface; consumers never import AnvilRuntime.
 *
 * Ownership/lifecycle rules: `.agents/rules/architecture.md` (§1 lifecycle
 * purity, §2 one owner per state). Extraction rationale: `.agents/memory/decisions.md`.
 */

import GLib from "gi://GLib";
import Meta from "gi://Meta";

import { Logger } from "../shared/logger.js";
import { Tree, Node, type NodeType } from "./tree.js";
import type { AnvilMetaWorkspace } from "./window/types.js";
import type { WindowTracker } from "./window-tracker.js";
import type { LayoutEngine } from "./layout-engine.js";
import type { SettingsBridge } from "./settings-bridge.js";
import type { PointerFocusSource } from "./pointer-policy.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import type { EventSchedulerPort } from "./event-scheduler.js";
type SignalId = number;

/** Host surface for SignalManager — intentionally wide (C1 accepted seam). */
export interface SignalManagerHost {
  readonly tracker: WindowTracker;
  readonly tree: Tree;
  readonly layout: LayoutEngine;
  readonly settingsBridge: SettingsBridge;

  renderTree(from: string, force?: boolean): void;
  trackCurrentMonWs(): void;
  updateMetaWorkspaceMonitor(from: string, mon: number | null, w: Meta.Window): void;
  updateDecorationLayout(): void;
  hideWindowBorders(): void;
  notifyWorkspaceSettled(): void;
  notifyFocusChanged(node: Node<NodeType> | null, source: PointerFocusSource): void;

  // Freeze: storage owned by the runtime SessionFlags; SignalManager is a caller (C2)
  isRenderFrozen(): boolean;
  freezeRender(): void;
  unfreezeRender(): void;

  // Workspace transition flag: storage on SessionFlags; SignalManager is the sole writer (C2)
  workspaceChanging: boolean;

  updateStackedFocus(n: Node<NodeType> | null | undefined): void;
  updateTabbedFocus(n: Node<NodeType> | null | undefined): void;

  // Grab op forwarding (narrow — delegates to GrabResizeSession)
  handleGrabOpBegin(display: Meta.Display, metaWindow: Meta.Window, grabOp: Meta.GrabOp): void;
  handleGrabOpEnd(display: Meta.Display, metaWindow: Meta.Window, grabOp: Meta.GrabOp): void;

  readonly scheduler: EventSchedulerPort;
  observePortableTopology(): void;
}

export class SignalManager {
  private _host: SignalManagerHost;
  private _signalsBound = false;
  private _workspaceChangingTimeoutId = 0;

  // Signal ID arrays owned by this module.
  private _displaySignals: number[] | undefined;
  private _windowManagerSignals: number[] | undefined;
  private _workspaceManagerSignals: number[] | undefined;
  private _overviewSignals: SignalId[] | null = null;

  // Workspace flags have zero external readers and remain private to this module.
  private _workspaceAdded = false;
  private _workspaceRemoved = false;

  constructor(host: SignalManagerHost) {
    this._host = host;
  }

  get isBound(): boolean {
    return this._signalsBound;
  }

  /** Bind all global non-window signals. Called from AnvilRuntime.enable(). */
  bindAll(): void {
    if (this._signalsBound) return;

    const host = this._host;
    const extDisplay = global.display;
    const shellWm = global.window_manager;

    this._displaySignals = [
      extDisplay.connect("window-created", (_d, w) => {
        host.tracker.onWindowCreated(_d, w);
      }),
      extDisplay.connect("grab-op-begin", (_d, m, g) => host.handleGrabOpBegin(_d, m, g)),
      extDisplay.connect("window-entered-monitor", (_, monitor, metaWindow) => {
        host.updateMetaWorkspaceMonitor("window-entered-monitor", monitor, metaWindow);
        host.trackCurrentMonWs();
      }),
      extDisplay.connect("grab-op-end", (_d, m, g) => host.handleGrabOpEnd(_d, m, g)),
      extDisplay.connect("showing-desktop-changed", () => {
        host.hideWindowBorders();
        host.updateDecorationLayout();
      }),
      extDisplay.connect("in-fullscreen-changed", () => {
        host.renderTree("full-screen-changed");
      }),
      extDisplay.connect("workareas-changed", (_display) => {
        if (global.display.get_n_monitors() == 0) {
          Logger.debug(`workareas-changed: no monitors, ignoring signal`);
          return;
        }
        host.observePortableTopology();
        if (host.tree.getNodeByType("WINDOW").length > 0) {
          const workspaceReload = this._workspaceAdded || this._workspaceRemoved;
          if (workspaceReload) {
            host.tracker.trackCurrentWindows();
            this._workspaceRemoved = false;
            this._workspaceAdded = false;
          } else {
            host.renderTree("workareas-changed");
          }
        }
      }),
    ];

    this._windowManagerSignals = [
      shellWm.connect("map", (_, actor) => {
        host.tracker.trackMappedActor(actor);
      }),
      shellWm.connect("minimize", () => {
        host.hideWindowBorders();
        const focusNodeWindow = host.tree.findNode(global.display.get_focus_window());
        if (focusNodeWindow) {
          if (host.tree.getTiledChildren(focusNodeWindow!.parentNode!.childNodes).length === 0) {
            host.layout.resetSiblingPercent(focusNodeWindow!.parentNode!.parentNode);
          }
          host.layout.resetSiblingPercent(focusNodeWindow!.parentNode!);
        }

        const prevFrozen = host.isRenderFrozen();
        if (prevFrozen) host.unfreezeRender();
        host.renderTree("minimize");
        if (prevFrozen) host.freezeRender();
      }),
      shellWm.connect("unminimize", () => {
        const focusNodeWindow = host.tree.findNode(global.display.get_focus_window());
        if (focusNodeWindow) {
          host.layout.resetSiblingPercent(focusNodeWindow!.parentNode!);
        }

        const prevFrozen = host.isRenderFrozen();
        if (prevFrozen) host.unfreezeRender();
        host.renderTree("unminimize");
        if (prevFrozen) host.freezeRender();
      }),
      // Empty handler: connect to suppress Mutter's built-in edge-tile preview
      // while Anvil owns tiling. Do not disconnect — an empty slot blocks the
      // default preview side effects without drawing our own overlay.
      // @see codebase-review.md B4-6
      shellWm.connect("show-tile-preview", (_wm, _metaWindow, _rect, _num) => {
        /* intentionally empty — suppress default tile preview */
      }),
    ];

    const extWsm = global.workspace_manager;

    this._workspaceManagerSignals = [
      extWsm.connect("showing-desktop-changed", () => {
        host.hideWindowBorders();
        host.updateDecorationLayout();
      }),
      extWsm.connect("workspace-added", (_wsm, wsIndex) => {
        host.observePortableTopology();
        host.tree.addWorkspace(wsIndex);
        host.trackCurrentMonWs();
        this._workspaceAdded = true;
        host.renderTree("workspace-added");
      }),
      extWsm.connect("workspace-removed", (_wsm, wsIndex) => {
        host.observePortableTopology();
        host.tree.removeWorkspace(wsIndex);
        host.trackCurrentMonWs();
        this._workspaceRemoved = true;
        host.updateDecorationLayout();
        host.renderTree("workspace-removed");
      }),
      extWsm.connect("active-workspace-changed", () => {
        // Bug #374 fix: Set flag to prevent focus jumping during workspace transitions
        // Ported from jcrussell/forge
        host.workspaceChanging = true;
        host.hideWindowBorders();
        host.trackCurrentMonWs();
        host.updateDecorationLayout();
        host.renderTree("active-workspace-changed");
        // Clear previous timer to avoid races on rapid workspace switches
        if (this._workspaceChangingTimeoutId) {
          GLib.Source.remove(this._workspaceChangingTimeoutId);
          this._workspaceChangingTimeoutId = 0;
        }
        // Clear flag after workspace animation completes (300ms)
        this._workspaceChangingTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
          this._workspaceChangingTimeoutId = 0;
          host.workspaceChanging = false;
          // Tree should have rendered by now (idle_add runs before 300ms timeout)
          host.notifyWorkspaceSettled();
          return false;
        });
      }),
    ];

    // Mark signals bound BEFORE the workspace loop so bindWorkspaceSignals()
    // (lifecycle-gated per S2) performs the real connect for each existing
    // workspace. Pre-bind Tree activation calls still return early.
    this._signalsBound = true;

    const numberOfWorkspaces = extWsm.get_n_workspaces();

    for (let i = 0; i < numberOfWorkspaces; i++) {
      const workspace = extWsm.get_workspace_by_index(i)!;
      this.bindWorkspaceSignals(workspace);
    }

    // Settings key → handler map (SettingsBridge)
    host.settingsBridge.enable();

    this._overviewSignals = [
      Main.overview.connect("hiding", () => {
        // TODO(overview-thrash): fromOverview was dead state — re-implement
        // deliberately if overview-thrash skip is needed.
        const eventObj = {
          name: "focus-after-overview",
          callback: () => {
            const focusNodeWindow = host.tree.findNode(global.display.get_focus_window());
            host.updateStackedFocus(focusNodeWindow);
            host.updateTabbedFocus(focusNodeWindow);
            host.notifyFocusChanged(focusNodeWindow, "overview");
          },
        };
        host.scheduler.enqueue(eventObj);
      }),
      Main.overview.connect("showing", () => {
        // TODO(overview-thrash): toOverview was dead state — re-implement
        // deliberately if overview-thrash skip is needed.
      }),
    ];
  }

  /** Disconnect all signals. Called from AnvilRuntime.disable(). */
  unbindAll(): void {
    if (this._displaySignals) {
      for (const displaySignal of this._displaySignals) {
        global.display.disconnect(displaySignal);
      }
      this._displaySignals.length = 0;
      this._displaySignals = undefined;
    }

    if (this._windowManagerSignals) {
      for (const windowManagerSignal of this._windowManagerSignals) {
        global.window_manager.disconnect(windowManagerSignal);
      }
      this._windowManagerSignals.length = 0;
      this._windowManagerSignals = undefined;
    }

    const globalWsm = global.workspace_manager;

    if (this._workspaceManagerSignals) {
      for (const workspaceManagerSignal of this._workspaceManagerSignals) {
        globalWsm.disconnect(workspaceManagerSignal);
      }
      this._workspaceManagerSignals.length = 0;
      this._workspaceManagerSignals = undefined;
    }

    // Disconnect per-workspace signals
    const numberOfWorkspaces = globalWsm.get_n_workspaces();
    for (let i = 0; i < numberOfWorkspaces; i++) {
      const workspace = globalWsm.get_workspace_by_index(i) as AnvilMetaWorkspace;
      if (workspace && workspace.workspaceSignals) {
        for (const workspaceSignal of workspace.workspaceSignals) {
          workspace.disconnect(workspaceSignal);
        }
        workspace.workspaceSignals.length = 0;
        workspace.workspaceSignals = undefined;
      }
    }

    if (this._overviewSignals) {
      for (const overviewSignal of this._overviewSignals) {
        Main.overview.disconnect(overviewSignal);
      }
      this._overviewSignals.length = 0;
      this._overviewSignals = null;
    }

    // Clear workspace timeout. Reset the transition flag so a disable during
    // a workspace switch does not leave it stuck true until the next switch
    // (which would suppress PointerPolicy work after recreation). See S4.
    if (this._workspaceChangingTimeoutId) {
      GLib.Source.remove(this._workspaceChangingTimeoutId);
      this._workspaceChangingTimeoutId = 0;
    }
    this._host.workspaceChanging = false;

    this._signalsBound = false;
  }

  /**
   * Per-workspace signal binding (shared with Tree via TreeHost — C11).
   *
   * S2: defers the actual `Meta.Workspace.connect()` until signals are bound
   * (i.e. until `bindAll()` runs from `enable()`). `Tree._initWorkspaces` calls
   * this during runtime activation; without this guard it would connect signals
   * before `enable()`, violating architecture rule §1 (lifecycle purity). The
   * pre-bind call is a no-op; `bindAll()` loops the existing
   * workspaces and does the real binding, and the runtime `workspace-added`
   * handler binds new workspaces (with `_signalsBound` true by then).
   */
  bindWorkspaceSignals(metaWorkspace: Meta.Workspace): void {
    if (!this._signalsBound) return;
    if (metaWorkspace) {
      const ws = metaWorkspace as AnvilMetaWorkspace;
      if (!ws.workspaceSignals) {
        const workspaceSignals = [
          metaWorkspace.connect("window-added", (_, metaWindow) => {
            this._host.tracker.onWorkspaceWindowAdded(metaWindow);
          }),
        ];
        ws.workspaceSignals = workspaceSignals;
      }
    }
  }
}
