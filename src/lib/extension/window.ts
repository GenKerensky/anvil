/*
 * This file is part of the Anvil extension for GNOME
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 */

// Gnome imports
import GLib from "gi://GLib";

import GObject from "gi://GObject";
import Meta from "gi://Meta";
import St from "gi://St";

// Gnome Shell imports
import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { PACKAGE_VERSION } from "resource:///org/gnome/shell/misc/config.js";

// Shared state
import { Logger } from "../shared/logger.js";
import type { WindowConfig } from "../shared/settings.js";

// App imports
import * as Utils from "./utils.js";
import { Keybindings } from "./keybindings.js";
import {
  Tree,
  Queue,
  Node,
  LAYOUT_TYPES,
  ORIENTATION_TYPES,
  NODE_TYPES,
  RectLike,
} from "./tree.js";
import { production } from "../shared/settings.js";
import { safeRaise, safeActivate } from "./mutter-safe.js";
import { PointerPolicy, type PointerFocusSource } from "./pointer-policy.js";
import { TilingRender } from "./tiling-render.js";
import { RulesEngine } from "./rules-engine.js";
import { WindowTracker } from "./window-tracker.js";
import { LayoutEngine } from "./layout-engine.js";
import { GrabResizeSession } from "./grab-resize-session.js";
import { SettingsBridge } from "./settings-bridge.js";
import { FocusController } from "./focus-controller.js";
import { BorderController } from "./border-controller.js";
import { CommandBus } from "./command-bus.js";
import { computeSnapLayout } from "./snap-layout.js";
import { WINDOW_MODES, GRAB_TYPES } from "./window/constants.js";
import type {
  AnvilMetaWindow,
  AnvilWindowActor,
  AnvilMetaWorkspace,
  AnvilExtension,
} from "./window/types.js";
import type {
  AnvilAction,
  FloatAction,
  DirectionAction,
  SplitAction,
  GapSizeAction,
  SnapLayoutMoveAction,
  WindowResizeAction,
} from "./window/actions.js";
import { createSessionFlags, type SessionFlagsState } from "./window/session-flags.js";

export { WINDOW_MODES, GRAB_TYPES } from "./window/constants.js";
export type { AnvilMetaWindow, AnvilWindowActor, AnvilMetaWorkspace } from "./window/types.js";
export type { AnvilAction, AnvilActionName } from "./window/actions.js";
export { RulesEngine, windowTitleMatchesOverride } from "./rules-engine.js";
export type { RuleMatch, RuleSource } from "./rules-engine.js";

export class WindowManager extends GObject.Object {
  static {
    GObject.registerClass(this);
  }

  ext: AnvilExtension;
  /** Synced with RulesEngine / ConfigManager (same object after reload). */
  windowProps!: WindowConfig;
  private _rules!: RulesEngine;

  // --- State ---
  declare prefsTitle: string;
  declare disabled: boolean;
  declare _signalsBound: boolean;
  /** Grouped transient flags (B2-3). Prefer this._session over new loose fields. */
  private _session!: SessionFlagsState;

  // Compatibility accessors for session flags (tests / residual call sites).
  get _freezeRender() {
    return this._session.freezeRender;
  }
  set _freezeRender(v: boolean) {
    this._session.freezeRender = v;
  }
  get _workspaceChanging() {
    return this._session.workspaceChanging;
  }
  set _workspaceChanging(v: boolean) {
    this._session.workspaceChanging = v;
  }
  get workspaceAdded() {
    return this._session.workspaceAdded;
  }
  set workspaceAdded(v: boolean) {
    this._session.workspaceAdded = v;
  }
  get workspaceRemoved() {
    return this._session.workspaceRemoved;
  }
  set workspaceRemoved(v: boolean) {
    this._session.workspaceRemoved = v;
  }
  get fromOverview() {
    return this._session.fromOverview;
  }
  set fromOverview(v: boolean) {
    this._session.fromOverview = v;
  }
  get toOverview() {
    return this._session.toOverview;
  }
  set toOverview(v: boolean) {
    this._session.toOverview = v;
  }

  // --- Object references ---
  declare _kbd: import("./keybindings.js").Keybindings;
  declare _tree: Tree;
  declare eventQueue: Queue;
  declare theme: import("./extension-theme-manager.js").ExtensionThemeManager;
  declare _pointerPolicy: PointerPolicy | null;
  declare _tilingRender: TilingRender;
  declare _tracker: WindowTracker;
  declare _layout: LayoutEngine;
  declare _grab: GrabResizeSession;
  declare _settingsBridge: SettingsBridge;
  declare _focus: FocusController;
  declare _borders: BorderController;
  declare nodeWinAtPointer: Node<any> | null;
  declare sortedWindows: Meta.Window[];

  // --- Signal handler ID arrays ---
  declare _displaySignals: number[] | undefined;
  declare _windowManagerSignals: number[] | undefined;
  declare _workspaceManagerSignals: number[] | undefined;
  declare _overviewSignals: number[] | null;

  // --- GLib source IDs ---
  declare _queueSourceId: number;
  declare _renderTreeSrcId: number;
  declare _reloadTreeSrcId: number;
  declare _workspaceChangingTimeoutId: number;
  declare _prefsOpenSrcId: number;

  /** CommandBus — typed AnvilAction dispatch (B3-1 / B10-2). */
  private _commandBus!: CommandBus;

  constructor(ext: AnvilExtension) {
    super();
    this.ext = ext;
    this.prefsTitle = `Anvil ${_("Settings")} - ${
      !production ? "DEV" : `${PACKAGE_VERSION}-${ext.metadata.version}`
    }`;
    this._rules = new RulesEngine();
    this.reloadWindowOverrides();
    this.disabled = false;
    this._session = createSessionFlags();
    // Keybindings wired after construction via wireKeybindings() (B4-9).
    // Host getters use `self` so lazy tree access works during/after construction.
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    // LayoutEngine before Tree: Tree._initWorkspaces calls determineSplitLayout().
    this._layout = new LayoutEngine({
      get tree() {
        return self.tree;
      },
      get settings() {
        return self.ext.settings;
      },
      get focusMetaWindow() {
        return self.focusMetaWindow;
      },
      get currentMonWsNode() {
        return self.currentMonWsNode;
      },
      notifyFocusChanged: (n, s) => self.notifyFocusChanged(n, s),
      moveWindow: (w, rect) => self.move(w, rect),
      rectForMonitor: (n, i) => self.rectForMonitor(n, i),
      sameParentMonitor: (a, b) => self.sameParentMonitor(a, b),
      floatingWindow: (n) => self.floatingWindow(n),
    });
    this._tree = new Tree({
      get settings() {
        return self.ext.settings;
      },
      get focusMetaWindow() {
        return self.focusMetaWindow;
      },
      determineSplitLayout: () => self.determineSplitLayout(),
      floatingWindow: (n) => self.floatingWindow(n),
      bindWorkspaceSignals: (ws) => self.bindWorkspaceSignals(ws),
    });
    this.eventQueue = new Queue();
    this.theme = this.ext.theme;
    // Always construct PointerPolicy; enable/disable behavior via settings (B9-2).
    this._ensurePointerPolicy();
    this._tilingRender = new TilingRender({
      settings: this.ext.settings,
      getTree: () => this.tree,
      moveWindow: (metaWindow, rect) => this.move(metaWindow, rect),
      getAllNodeWindows: () => this.allNodeWindows,
      isFloatingExempt: (w) => this.isFloatingExempt(w),
      isActiveWindowWorkspaceTiled: (w) => this.isActiveWindowWorkspaceTiled(w),
      getTiledChildren: (nodes) => this.tree.getTiledChildren(nodes),
      getResizeCount: (id) => self._grab.getResizeCount(id),
      findParent: (node, type) => this.tree.findParent(node, type),
      computeSizes: (n, c) => self._layout.computeSizes(n, c),
    });
    this._grab = new GrabResizeSession({
      get tree() {
        return self.tree;
      },
      get focusMetaWindow() {
        return self.focusMetaWindow;
      },
      get settings() {
        return self.ext.settings;
      },
      get nodeWinAtPointer() {
        return self.nodeWinAtPointer;
      },
      set nodeWinAtPointer(n) {
        self.nodeWinAtPointer = n;
      },
      get eventQueueLength() {
        return self.eventQueue.length;
      },
      findNodeWindow: (w) => self.findNodeWindow(w),
      findNodeWindowAtPointer: (n) => self.findNodeWindowAtPointer(n) ?? null,
      trackCurrentMonWs: () => self.trackCurrentMonWs(),
      freezeRender: () => self.freezeRender(),
      unfreezeRender: () => self.unfreezeRender(),
      renderTree: (from, force) => self.renderTree(from, force),
      queueEvent: (ev, interval) => self.queueEvent(ev, interval),
      move: (w, rect) => self.move(w, rect),
      calculateGaps: (n) => self._tilingRender.calculateGaps(n),
      processNode: (n) => self._tilingRender.processNode(n),
      getMonitorConstraints: (i) => self._tilingRender.getMonitorConstraints(i),
      floatingWindow: (n) => !!self.floatingWindow(n),
      minimizedWindow: (n) => !!self.minimizedWindow(n),
      allowDragDropTile: () => Boolean(self.allowDragDropTile()),
      moveWindowToPointer: (n, preview) => self.moveWindowToPointer(n, preview),
      updateStackedFocus: (n) => self.updateStackedFocus(n),
      updateTabbedFocus: (n) => self.updateTabbedFocus(n),
    });
    this._tracker = new WindowTracker({
      get tree() {
        return self.tree;
      },
      get focusMetaWindow() {
        return self.focusMetaWindow;
      },
      get prefsTitle() {
        return self.prefsTitle;
      },
      get windowsAllWorkspaces() {
        return self.windowsAllWorkspaces;
      },
      get settings() {
        return self.ext.settings;
      },
      isFloatingExempt: (w) => self.isFloatingExempt(w),
      isActiveWindowWorkspaceTiled: (w) => self.isActiveWindowWorkspaceTiled(w),
      floatingWindow: (n) => self.floatingWindow(n),
      reloadTree: (from) => self.reloadTree(from),
      updateMetaWorkspaceMonitor: (from, mon, w) => self.updateMetaWorkspaceMonitor(from, mon, w),
      updateMetaPositionSize: (w, from) => self.updateMetaPositionSize(w, from),
      renderTree: (from, force) => self.renderTree(from, force),
      queueEvent: (ev, interval) => self.queueEvent(ev, interval),
      unfreezeRender: () => self.unfreezeRender(),
      ensureBorderActors: (a) => self.ensureBorderActors(a),
      hideActorBorder: (a) => self.hideActorBorder(a),
      updateBorderLayout: () => self.updateBorderLayout(),
      updateDecorationLayout: () => self.updateDecorationLayout(),
      updateStackedFocus: (n) => self.updateStackedFocus(n),
      updateTabbedFocus: (n) => self.updateTabbedFocus(n),
      notifyFocusChanged: (n, s) => self.notifyFocusChanged(n, s),
      moveCenter: (w) => self.moveCenter(w),
      removeFloatOverride: (w, withWmId) => self.removeFloatOverride(w, withWmId),
      trackCurrentMonWs: () => self.trackCurrentMonWs(),
      autoSplitFromFocus: () => self.layoutEngine.autoSplitFromFocus(),
    });
    this._settingsBridge = new SettingsBridge({
      get settings() {
        return self.ext.settings;
      },
      get tree() {
        return self.tree;
      },
      reloadWindowOverrides: () => self.reloadWindowOverrides(),
      bordersEnabled: () => self._bordersEnabled(),
      ensureAllBorderActors: () => self.ensureAllBorderActors(),
      updateBorderLayout: () => self.updateBorderLayout(),
      destroyAllBorderActors: () => self.destroyAllBorderActors(),
      pointerPolicyNeeded: () => self._pointerPolicyNeeded(),
      ensurePointerPolicy: () => self._ensurePointerPolicy(),
      teardownPointerPolicy: () => self._teardownPointerPolicy(),
      setHoverFocusEnabled: (enabled) => {
        self._pointerPolicy?.setHoverFocusEnabled(enabled);
      },
      renderTree: (from, force) => self.renderTree(from, force),
      determineSplitLayout: () => self.determineSplitLayout(),
      reloadStylesheet: () => {
        self.theme?.reloadStylesheet();
      },
      cleanupAlwaysFloat: () => self.cleanupAlwaysFloat(),
      restoreAlwaysFloat: () => self.restoreAlwaysFloat(),
      clearResizedWindows: () => self._grab.clearResizedWindows(),
    });
    this._focus = new FocusController({
      get layoutEngine() {
        return self._layout;
      },
      isRenderFrozen: () => self._freezeRender,
      queueEvent: (ev, interval) => self.queueEvent(ev, interval),
      renderTree: (from, force) => self.renderTree(from, force),
    });
    this._borders = new BorderController({
      get tree() {
        return self.tree;
      },
      get settings() {
        return self.ext.settings;
      },
      get focusMetaWindow() {
        return self.focusMetaWindow;
      },
      calculateGaps: (n) => self._tilingRender.calculateGaps(n),
      findNodeWindow: (w) => self.findNodeWindow(w),
    });
    this._initCommandHandlers();

    Logger.info("anvil initialized");
  }

  /** Grab session state — Stage 6 facades for tests and commands. */
  get grabOp() {
    return this._grab.grabOp;
  }
  set grabOp(v: Meta.GrabOp) {
    this._grab.grabOp = v;
  }
  get cancelGrab() {
    return this._grab.cancelGrab;
  }
  set cancelGrab(v: boolean) {
    this._grab.cancelGrab = v;
  }
  get _resizedWindows() {
    return this._grab.resizedWindows;
  }

  get pointerPolicy() {
    return this._pointerPolicy;
  }

  get tilingRender() {
    return this._tilingRender;
  }

  get layoutEngine() {
    return this._layout;
  }

  get shouldFocusOnHover() {
    return this._pointerPolicy?.hoverFocusEnabled ?? false;
  }

  set shouldFocusOnHover(enabled: boolean) {
    this._ensurePointerPolicy();
    this._pointerPolicy!.setHoverFocusEnabled(enabled);
  }

  private _pointerPolicyNeeded(): boolean {
    const settings = this.ext.settings;
    if (!settings) return false;
    return (
      settings.get_boolean("focus-on-hover-enabled") ||
      settings.get_boolean("move-pointer-focus-enabled")
    );
  }

  private _ensurePointerPolicy(): void {
    if (this._pointerPolicy) return;
    this._pointerPolicy = new PointerPolicy({
      settings: this.ext.settings,
      isWorkspaceChanging: () => this._workspaceChanging,
      isDisabled: () => this.disabled,
    });
    this._pointerPolicy.setHoverFocusEnabled(
      !!this.ext.settings?.get_boolean("focus-on-hover-enabled")
    );
  }

  /**
   * Disable pointer features without destroying the instance (B9-2 always-on).
   * Full dispose only on extension disable via disposePointerPolicy().
   */
  private _teardownPointerPolicy(): void {
    if (!this._pointerPolicy) return;
    this._pointerPolicy.setHoverFocusEnabled(false);
    this._pointerPolicy.disable();
  }

  private _disposePointerPolicy(): void {
    if (!this._pointerPolicy) return;
    this._pointerPolicy.disable();
    this._pointerPolicy = null;
  }

  notifyFocusChanged(node: Node<any> | null, source: PointerFocusSource) {
    if (this._pointerPolicy) {
      this._pointerPolicy.onFocusChanged({ node, source });
    }
    if (node) this.tree.debugParentNodes(node);
  }

  notifyWorkspaceSettled() {
    this._pointerPolicy?.onWorkspaceSettled();
  }

  addFloatOverride(metaWindow: Meta.Window, withWmId: boolean) {
    this._rules.addFloatOverride(metaWindow, withWmId, this.ext.configMgr);
    this.windowProps = this._rules.windowProps;
  }

  removeFloatOverride(metaWindow: Meta.Window, withWmId: boolean) {
    this._rules.removeFloatOverride(metaWindow, withWmId, this.ext.configMgr);
    this.windowProps = this._rules.windowProps;
  }

  toggleFloatingMode(action: FloatAction, metaWindow: Meta.Window) {
    const nodeWindow = this.findNodeWindow(metaWindow);
    // action is required; historical guard was `!(action || action.mode)`.
    if (!nodeWindow || !action) return;
    if (nodeWindow.nodeType !== NODE_TYPES.WINDOW) return;

    const withWmId = action.name === "FloatToggle";
    const floatingExempt = this.isFloatingExempt(metaWindow);

    if (floatingExempt) {
      this.removeFloatOverride(metaWindow, withWmId);
      this.windowProps = this.ext.configMgr.windowProps ?? this.windowProps;
      this._rules.windowProps = this.windowProps;
      if (!this.isActiveWindowWorkspaceTiled(metaWindow)) {
        nodeWindow.mode = WINDOW_MODES.FLOAT;
      } else {
        nodeWindow.mode = WINDOW_MODES.TILE;
      }
    } else {
      this.addFloatOverride(metaWindow, withWmId);
      this.windowProps = this.ext.configMgr.windowProps ?? this.windowProps;
      this._rules.windowProps = this.windowProps;
      nodeWindow.mode = WINDOW_MODES.FLOAT;
    }
  }

  queueEvent(eventObj: { name: string; callback: () => void }, interval: number = 220) {
    this.eventQueue.enqueue(eventObj);

    if (!this._queueSourceId) {
      this._queueSourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, interval, () => {
        const currEventObj = this.eventQueue.dequeue();
        if (currEventObj) {
          currEventObj.callback();
        }
        const result = this.eventQueue.length !== 0;
        if (!result) {
          this._queueSourceId = 0;
        }
        return result;
      });
    }
  }

  /**
   * This is the central place to bind all the non-window signals.
   */
  _bindSignals() {
    if (this._signalsBound) return;

    const extDisplay = global.display;
    const shellWm = global.window_manager;

    this._displaySignals = [
      extDisplay.connect("window-created", (_d, w) => {
        this._tracker.onWindowCreated(_d, w);
      }),
      extDisplay.connect("grab-op-begin", (_d, m, g) => this._handleGrabOpBegin(_d, m, g)),
      extDisplay.connect("window-entered-monitor", (_, monitor, metaWindow) => {
        this.updateMetaWorkspaceMonitor("window-entered-monitor", monitor, metaWindow);
        this.trackCurrentMonWs();
      }),
      extDisplay.connect("grab-op-end", (_d, m, g) => this._handleGrabOpEnd(_d, m, g)),
      extDisplay.connect("showing-desktop-changed", () => {
        this.hideWindowBorders();
        this.updateDecorationLayout();
      }),
      extDisplay.connect("in-fullscreen-changed", () => {
        this.renderTree("full-screen-changed");
      }),
      extDisplay.connect("workareas-changed", (_display) => {
        if (global.display.get_n_monitors() == 0) {
          Logger.debug(`workareas-changed: no monitors, ignoring signal`);
          return;
        }
        if (this.tree.getNodeByType("WINDOW").length > 0) {
          const workspaceReload = this.workspaceAdded || this.workspaceRemoved;
          if (workspaceReload) {
            this.trackCurrentWindows();
            this.workspaceRemoved = false;
            this.workspaceAdded = false;
          } else {
            this.renderTree("workareas-changed");
          }
        }
      }),
    ];

    this._windowManagerSignals = [
      shellWm.connect("map", (_, actor) => {
        this._tracker.trackMappedActor(actor);
      }),
      shellWm.connect("minimize", () => {
        this.hideWindowBorders();
        const focusNodeWindow = this.tree.findNode(this.focusMetaWindow);
        if (focusNodeWindow) {
          if (this.tree.getTiledChildren(focusNodeWindow!.parentNode!.childNodes).length === 0) {
            this._layout.resetSiblingPercent(focusNodeWindow!.parentNode!.parentNode);
          }
          this._layout.resetSiblingPercent(focusNodeWindow!.parentNode!);
        }

        const prevFrozen = this._freezeRender;
        if (prevFrozen) this.unfreezeRender();
        this.renderTree("minimize");
        if (prevFrozen) this.freezeRender();
      }),
      shellWm.connect("unminimize", () => {
        const focusNodeWindow = this.tree.findNode(this.focusMetaWindow);
        if (focusNodeWindow) {
          this._layout.resetSiblingPercent(focusNodeWindow!.parentNode!);
        }

        const prevFrozen = this._freezeRender;
        if (prevFrozen) this.unfreezeRender();
        this.renderTree("unminimize");
        if (prevFrozen) this.freezeRender();
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
        this.hideWindowBorders();
        this.updateDecorationLayout();
      }),
      extWsm.connect("workspace-added", (_wsm, wsIndex) => {
        this.tree.addWorkspace(wsIndex);
        this.trackCurrentMonWs();
        this.workspaceAdded = true;
        this.renderTree("workspace-added");
      }),
      extWsm.connect("workspace-removed", (_wsm, wsIndex) => {
        this.tree.removeWorkspace(wsIndex);
        this.trackCurrentMonWs();
        this.workspaceRemoved = true;
        this.updateDecorationLayout();
        this.renderTree("workspace-removed");
      }),
      extWsm.connect("active-workspace-changed", () => {
        // Bug #374 fix: Set flag to prevent focus jumping during workspace transitions
        // Ported from jcrussell/forge
        this._workspaceChanging = true;
        this.hideWindowBorders();
        this.trackCurrentMonWs();
        this.updateDecorationLayout();
        this.renderTree("active-workspace-changed");
        // Clear previous timer to avoid races on rapid workspace switches
        if (this._workspaceChangingTimeoutId) {
          GLib.Source.remove(this._workspaceChangingTimeoutId);
          this._workspaceChangingTimeoutId = 0;
        }
        // Clear flag after workspace animation completes (300ms)
        // Also refocus pointer to correct monitor in multi-monitor setups
        this._workspaceChangingTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
          this._workspaceChangingTimeoutId = 0;
          this._workspaceChanging = false;
          // Tree should have rendered by now (idle_add runs before 300ms timeout)
          this.notifyWorkspaceSettled();
          return false;
        });
      }),
    ];

    const numberOfWorkspaces = extWsm.get_n_workspaces();

    for (let i = 0; i < numberOfWorkspaces; i++) {
      const workspace = extWsm.get_workspace_by_index(i)!;
      this.bindWorkspaceSignals(workspace);
    }

    // Stage 8: settings key → handler map (SettingsBridge)
    this._settingsBridge.enable();

    this._overviewSignals = [
      Main.overview.connect("hiding", () => {
        this.fromOverview = true;
        const eventObj = {
          name: "focus-after-overview",
          callback: () => {
            const focusNodeWindow = this.tree.findNode(this.focusMetaWindow);
            this.updateStackedFocus(focusNodeWindow);
            this.updateTabbedFocus(focusNodeWindow);
            this.notifyFocusChanged(focusNodeWindow, "overview");
          },
        };
        this.queueEvent(eventObj);
      }),
      Main.overview.connect("showing", () => {
        this.toOverview = true;
      }),
    ];

    this._signalsBound = true;
  }

  cleanupAlwaysFloat() {
    // remove the setting for each node window
    this.allNodeWindows.forEach((w) => {
      if (w.mode === WINDOW_MODES.FLOAT) {
        const mw = w.nodeValue as Meta.Window;
        if (mw.is_above()) mw.unmake_above();
      }
    });
  }

  restoreAlwaysFloat() {
    this.allNodeWindows.forEach((w) => {
      if (w.mode === WINDOW_MODES.FLOAT) {
        const mw = w.nodeValue as Meta.Window;
        if (!mw.is_above()) mw.make_above();
      }
    });
  }

  trackCurrentMonWs() {
    const metaWindow = this.focusMetaWindow;
    if (!metaWindow) return;
    const currentMonitor = global.display.get_current_monitor();
    const currentWorkspace = global.display.get_workspace_manager().get_active_workspace_index();

    const currentMonWs = `mo${currentMonitor}ws${currentWorkspace}`;
    const activeMetaMonWs = `mo${metaWindow.get_monitor()}ws${metaWindow.get_workspace().index()}`;
    const currentWsNode = this.tree.findNode(`ws${currentWorkspace}`);

    if (!currentWsNode) {
      return;
    }

    // Search for all the valid windows on the workspace
    const monWindows = currentWsNode.getNodeByType(NODE_TYPES.WORKSPACE).flatMap((ws) => {
      return ws
        .getNodeByType(NODE_TYPES.WINDOW)
        .filter(
          (w) =>
            !(w.nodeValue as Meta.Window).minimized &&
            w.isTile() &&
            w.nodeValue !== metaWindow &&
            // The searched window should be on the same monitor workspace
            // This ensures that Anvil already updated the workspace node tree:
            currentMonWs === activeMetaMonWs
        )
        .map((w) => w.nodeValue);
    });

    this.sortedWindows = global.display
      .sort_windows_by_stacking(monWindows as Meta.Window[])
      .reverse();
  }

  // TODO move this to workspace.js
  bindWorkspaceSignals(metaWorkspace: Meta.Workspace) {
    if (metaWorkspace) {
      const ws = metaWorkspace as AnvilMetaWorkspace;
      if (!ws.workspaceSignals) {
        const workspaceSignals = [
          metaWorkspace.connect("window-added", (_, metaWindow) => {
            this._tracker.onWorkspaceWindowAdded(metaWindow);
          }),
        ];
        ws.workspaceSignals = workspaceSignals;
      }
    }
  }

  /**
   * Wire CommandBus to private handlers. New commands: extend AnvilAction and
   * CommandBusHost — do not reintroduce a mega-switch (architecture rule 3).
   */
  private _initCommandHandlers() {
    this._commandBus = new CommandBus({
      handleFloat: (a) => this._handleFloat(a),
      handleMove: (a) => this._handleMove(a),
      handleFocus: (a) => this._handleFocus(a),
      handleSwap: (a) => this._handleSwap(a),
      handleSplit: (a) => this._handleSplit(a),
      handleLayoutToggle: () => this._handleLayoutToggle(),
      handleFocusBorderToggle: () => this._handleFocusBorderToggle(),
      handleTilingModeToggle: () => this._handleTilingModeToggle(),
      handleGapSize: (a) => this._handleGapSize(a),
      handleWorkspaceActiveTileToggle: () => this._handleWorkspaceActiveTileToggle(),
      handleLayoutStackedToggle: () => this._handleLayoutStackedToggle(),
      handleLayoutTabbedToggle: () => this._handleLayoutTabbedToggle(),
      handleCancelOperation: () => this._handleCancelOperation(),
      handlePrefsOpen: () => this._handlePrefsOpen(),
      handleWindowSwapLastActive: () => this._handleWindowSwapLastActive(),
      handleSnapLayoutMove: (a) => this._handleSnapLayoutMove(a),
      handleShowTabDecorationToggle: () => this._handleShowTabDecorationToggle(),
      handleWindowResize: (a) => this._handleWindowResize(a),
      handleWindowClose: () => this._handleWindowClose(),
    });
  }

  /** Dispatch a typed user action via CommandBus (B3-1). */
  command(action: AnvilAction) {
    this._commandBus.dispatch(action);
  }

  /** Injectable command bus for tests / keybinding service (B10-2). */
  get commandBus(): CommandBus {
    return this._commandBus;
  }

  private _handleFloat(action: FloatAction) {
    const focusWindow = this.focusMetaWindow;
    const focusNodeWindow = this.findNodeWindow(focusWindow);

    this.toggleFloatingMode(action, focusWindow);

    const rectRequest = {
      x: action.x,
      y: action.y,
      width: action.width,
      height: action.height,
    };

    const moveRect = {
      x: Utils.resolveX(rectRequest, focusWindow),
      y: Utils.resolveY(rectRequest, focusWindow),
      width: Utils.resolveWidth(rectRequest, focusWindow),
      height: Utils.resolveHeight(rectRequest, focusWindow),
    };

    this.move(focusWindow, moveRect);

    const existParent = focusNodeWindow!.parentNode!;

    if (this.tree.getTiledChildren(existParent.childNodes).length <= 1) {
      existParent.percent = undefined;
      this._layout.resetSiblingPercent(existParent.parentNode!);
    }

    this._layout.resetSiblingPercent(existParent);
    this.renderTree("float-toggle", true);
  }

  private _handleMove(action: DirectionAction) {
    let focusNodeWindow = this.findNodeWindow(this.focusMetaWindow);
    this.unfreezeRender();
    const moveDirection = Utils.resolveDirection(action.direction)!;

    const prev = focusNodeWindow;
    const moved = this._layout.move(focusNodeWindow!, moveDirection);
    if (!focusNodeWindow) {
      focusNodeWindow = this.findNodeWindow(this.focusMetaWindow);
    }
    this.queueEvent({
      name: "move",
      callback: () => {
        if (this.eventQueue.length <= 0) {
          this.unfreezeRender();
          if (focusNodeWindow!.parentNode!.layout === LAYOUT_TYPES.STACKED) {
            focusNodeWindow!.parentNode!.appendChild(focusNodeWindow!);
            safeRaise(focusNodeWindow!.nodeValue as Meta.Window);
            safeActivate(
              focusNodeWindow!.nodeValue as Meta.Window,
              global.display.get_current_time()
            );
            this.renderTree("move-stacked-queue");
          }
          if (focusNodeWindow!.parentNode!.layout === LAYOUT_TYPES.TABBED) {
            safeRaise(focusNodeWindow!.nodeValue as Meta.Window);
            safeActivate(
              focusNodeWindow!.nodeValue as Meta.Window,
              global.display.get_current_time()
            );
            if (prev) prev!.parentNode!.lastTabFocus = prev.nodeValue;
            this.renderTree("move-tabbed-queue");
          }
          this.notifyFocusChanged(focusNodeWindow, "move");
        }
      },
    });
    if (moved) {
      if (prev) prev!.parentNode!.lastTabFocus = prev.nodeValue;
      this.renderTree("move-window");
    }
  }

  private _handleFocus(action: DirectionAction) {
    let focusNodeWindow = this.findNodeWindow(this.focusMetaWindow);
    const focusDirection = Utils.resolveDirection(action.direction)!;
    focusNodeWindow = this._focus.focusDirection(focusNodeWindow, focusDirection);
    if (!focusNodeWindow) {
      focusNodeWindow = this.findNodeWindow(this.focusMetaWindow);
    }
    // In headless environments (container tests), there is no pointer
    // to auto-focus the window. Explicitly activate so get_focus_window()
    // returns the correct window.
    if (focusNodeWindow) {
      const win = focusNodeWindow.nodeValue as Meta.Window;
      safeRaise(win);
      safeActivate(win, global.display.get_current_time());
    }
  }

  private _handleSwap(action: DirectionAction) {
    const focusNodeWindow = this.findNodeWindow(this.focusMetaWindow);
    if (!focusNodeWindow) return;
    this.unfreezeRender();
    const swapDirection = Utils.resolveDirection(action.direction)!;
    this._layout.swap(focusNodeWindow, swapDirection);
    const swapWin = focusNodeWindow.nodeValue as Meta.Window;
    safeRaise(swapWin);
    safeActivate(swapWin, global.display.get_current_time());
    this.updateTabbedFocus(focusNodeWindow);
    this.updateStackedFocus(focusNodeWindow);
    this.notifyFocusChanged(focusNodeWindow, "swap");
    this.renderTree("swap", true);
  }

  private _handleSplit(action: SplitAction) {
    const focusNodeWindow = this.findNodeWindow(this.focusMetaWindow);
    if (!focusNodeWindow) return;
    const currentLayout = focusNodeWindow!.parentNode!.layout;
    if (currentLayout === LAYOUT_TYPES.STACKED || currentLayout === LAYOUT_TYPES.TABBED) {
      return;
    }
    const orientation = action.orientation
      ? action.orientation.toUpperCase()
      : ORIENTATION_TYPES.NONE;
    this._layout.split(focusNodeWindow, orientation);
    this.renderTree("split");
  }

  private _handleLayoutToggle() {
    const focusNodeWindow = this.findNodeWindow(this.focusMetaWindow);
    if (!focusNodeWindow) return;
    const currentLayout = focusNodeWindow!.parentNode!.layout;
    if (currentLayout === LAYOUT_TYPES.HSPLIT) {
      focusNodeWindow!.parentNode!.layout = LAYOUT_TYPES.VSPLIT;
    } else if (currentLayout === LAYOUT_TYPES.VSPLIT) {
      focusNodeWindow!.parentNode!.layout = LAYOUT_TYPES.HSPLIT;
    }
    this.tree.attachNode = focusNodeWindow!.parentNode!;
    this.renderTree("layout-split-toggle");
    {
      const win = focusNodeWindow.nodeValue as Meta.Window;
      safeRaise(win);
      safeActivate(win, global.display.get_current_time());
    }
    this.notifyFocusChanged(focusNodeWindow, "command");
  }

  private _handleFocusBorderToggle() {
    const focusBorderEnabled = this.ext.settings.get_boolean("focus-border-toggle");
    this.ext.settings.set_boolean("focus-border-toggle", !focusBorderEnabled);
  }

  private _handleTilingModeToggle() {
    // FIXME, not sure if this toggle is still needed from a use case
    // perspective, since Extension.disable also should do the same thing.
    const tilingModeEnabled = this.ext.settings.get_boolean("tiling-mode-enabled");
    this.ext.settings.set_boolean("tiling-mode-enabled", !tilingModeEnabled);
    if (tilingModeEnabled) {
      this.floatAllWindows();
    } else {
      this.unfloatAllWindows();
    }
    this.renderTree(`tiling-mode-toggle ${!tilingModeEnabled}`);
  }

  private _handleGapSize(action: GapSizeAction) {
    let gapIncrement = this.ext.settings.get_uint("window-gap-size-increment");
    const amount = action.amount;
    gapIncrement = gapIncrement + amount;
    if (gapIncrement < 0) gapIncrement = 0;
    if (gapIncrement > 8) gapIncrement = 8;
    this.ext.settings.set_uint("window-gap-size-increment", gapIncrement);
  }

  private _handleWorkspaceActiveTileToggle() {
    const activeWorkspace = global.workspace_manager.get_active_workspace_index();
    const skippedWorkspaces = this.ext.settings.get_string("workspace-skip-tile");
    let workspaceSkipped = false;
    let skippedArr: string[] = [];
    if (skippedWorkspaces.length === 0) {
      skippedArr.push(`${activeWorkspace}`);
      this.floatWorkspace(activeWorkspace);
    } else {
      skippedArr = skippedWorkspaces.split(",");

      for (let i = 0; i < skippedArr.length; i++) {
        if (`${skippedArr[i]}` === `${activeWorkspace}`) {
          workspaceSkipped = true;
          break;
        }
      }

      if (workspaceSkipped) {
        // tile this workspace
        const indexWs = skippedArr.indexOf(`${activeWorkspace}`);
        skippedArr.splice(indexWs, 1);
        this.unfloatWorkspace(activeWorkspace);
      } else {
        // skip tiling workspace
        skippedArr.push(`${activeWorkspace}`);
        this.floatWorkspace(activeWorkspace);
      }
    }
    this.ext.settings.set_string("workspace-skip-tile", skippedArr.toString());
    this.renderTree("workspace-toggle");
  }

  private _handleLayoutStackedToggle() {
    const focusNodeWindow = this.findNodeWindow(this.focusMetaWindow);
    if (!focusNodeWindow) return;
    if (!this.ext.settings.get_boolean("stacked-tiling-mode-enabled")) return;

    if (focusNodeWindow!.parentNode!.isMonitor()) {
      this._layout.split(focusNodeWindow, ORIENTATION_TYPES.HORIZONTAL, true);
    }

    const parent = focusNodeWindow!.parentNode!;
    if (parent.layout === LAYOUT_TYPES.STACKED) {
      this._layout.setLayout(parent, this.determineSplitLayout());
    } else {
      this._layout.setLayout(parent, LAYOUT_TYPES.STACKED);
      const lastChild = parent.lastChild;
      if (lastChild && lastChild.nodeType === NODE_TYPES.WINDOW) {
        (lastChild.nodeValue as Meta.Window).activate(global.display.get_current_time());
      }
    }
    this.unfreezeRender();
    this.tree.attachNode = parent;
    this.renderTree("layout-stacked-toggle");
  }

  private _handleLayoutTabbedToggle() {
    const focusNodeWindow = this.findNodeWindow(this.focusMetaWindow);
    if (!focusNodeWindow) return;
    if (!this.ext.settings.get_boolean("tabbed-tiling-mode-enabled")) return;

    if (focusNodeWindow!.parentNode!.isMonitor()) {
      this._layout.split(focusNodeWindow, ORIENTATION_TYPES.HORIZONTAL, true);
    }

    const parent = focusNodeWindow!.parentNode!;
    if (parent.layout === LAYOUT_TYPES.TABBED) {
      this._layout.setLayout(parent, this.determineSplitLayout());
    } else {
      this._layout.setLayout(parent, LAYOUT_TYPES.TABBED);
      parent.lastTabFocus = focusNodeWindow.nodeValue;
    }
    this.unfreezeRender();
    this.tree.attachNode = parent;
    this.renderTree("layout-tabbed-toggle");
  }

  private _handleCancelOperation() {
    const focusNodeWindow = this.findNodeWindow(this.focusMetaWindow);
    if (focusNodeWindow?.mode === WINDOW_MODES.GRAB_TILE) {
      this.cancelGrab = true;
    }
  }

  private _handlePrefsOpen() {
    const existWindow = Utils.findWindowWith(this.prefsTitle);
    if (existWindow && existWindow.get_workspace()) {
      existWindow
        .get_workspace()
        .activate_with_focus(existWindow, global.display.get_current_time());
      this.moveCenter(existWindow);
    } else {
      this.ext.openPreferences();
    }
  }

  private _handleWindowSwapLastActive() {
    const focusNodeWindow = this.findNodeWindow(this.focusMetaWindow);
    if (focusNodeWindow) {
      const lastActiveWindow = global.display.get_tab_next(
        Meta.TabList.NORMAL,
        global.display.get_workspace_manager().get_active_workspace(),
        focusNodeWindow.nodeValue as Meta.Window,
        false
      );
      const lastActiveNodeWindow = this.tree.findNode(lastActiveWindow);
      this._layout.swapPairs(lastActiveNodeWindow!, focusNodeWindow);
      this.notifyFocusChanged(focusNodeWindow, "swap");
      this.renderTree("swap-last-active");
    }
  }

  private _handleSnapLayoutMove(action: SnapLayoutMoveAction) {
    const focusNodeWindow = this.findNodeWindow(this.focusMetaWindow);
    if (!focusNodeWindow) return;

    const metaWindow = focusNodeWindow.nodeValue as Meta.Window;
    const workareaRect = metaWindow.get_work_area_current_monitor();
    const currentFrame = this.focusMetaWindow?.get_frame_rect() ?? null;
    const snap = computeSnapLayout(action.direction, workareaRect, action.amount, currentFrame);
    if (!snap) return;

    let rect: RectLike | { x: string | number; y: string | number; width: number; height: number } =
      snap.rect;
    if ("x" in rect && rect.x === "center" && this.focusMetaWindow) {
      rect = {
        x: Utils.resolveX(rect as { x?: string | number }, this.focusMetaWindow),
        y: Utils.resolveY(rect as { y?: string | number }, this.focusMetaWindow),
        width: rect.width,
        height: rect.height,
      };
    }
    focusNodeWindow.rect = rect as RectLike;
    if (snap.processGap) {
      focusNodeWindow.rect = this._tilingRender.processGap(focusNodeWindow) as RectLike;
    }
    if (!focusNodeWindow.isFloat()) {
      this.addFloatOverride(metaWindow, false);
    }
    this.move(metaWindow, focusNodeWindow.rect!);
    this.queueEvent({
      name: "snap-layout-move",
      callback: () => {
        this.renderTree("snap-layout-move");
      },
    });
  }

  private _handleShowTabDecorationToggle() {
    const focusNodeWindow = this.findNodeWindow(this.focusMetaWindow);
    if (!focusNodeWindow) return;
    if (!this.ext.settings.get_boolean("tabbed-tiling-mode-enabled")) return;

    const showTabs = this.ext.settings.get_boolean("showtab-decoration-enabled");
    this.ext.settings.set_boolean("showtab-decoration-enabled", !showTabs);

    this.unfreezeRender();
    this.tree.attachNode = focusNodeWindow!.parentNode!;
    this.renderTree("showtab-decoration-enabled");
  }

  private _handleWindowResize(action: WindowResizeAction) {
    const grabByDir: Record<WindowResizeAction["direction"], Meta.GrabOp> = {
      Right: Meta.GrabOp.KEYBOARD_RESIZING_E,
      Left: Meta.GrabOp.KEYBOARD_RESIZING_W,
      Top: Meta.GrabOp.KEYBOARD_RESIZING_N,
      Bottom: Meta.GrabOp.KEYBOARD_RESIZING_S,
    };
    const grabOp = grabByDir[action.direction];
    if (grabOp !== undefined) {
      this.resize(grabOp, action.amount);
    }
  }

  private _handleWindowClose() {
    const focusWindow = this.focusMetaWindow;
    if (focusWindow) {
      focusWindow.delete(global.display.get_current_time());
    }
  }

  resize(grabOp: Meta.GrabOp, amount: number) {
    // Keyboard path keeps calling begin/end facades so existing spies/tests work.
    const metaWindow = this.focusMetaWindow;
    if (!metaWindow) return;
    const display = global.display;

    this._handleGrabOpBegin(display, metaWindow, grabOp);

    const rect = metaWindow.get_frame_rect();
    const direction = Utils.directionFromGrab(grabOp);

    switch (direction) {
      case Meta.MotionDirection.RIGHT:
        rect.width = rect.width + amount;
        break;
      case Meta.MotionDirection.LEFT:
        rect.width = rect.width + amount;
        rect.x = rect.x - amount;
        break;
      case Meta.MotionDirection.UP:
        rect.height = rect.height + amount;
        break;
      case Meta.MotionDirection.DOWN:
        rect.height = rect.height + amount;
        rect.y = rect.y - amount;
        break;
    }
    this.move(metaWindow, rect);
    this.queueEvent(
      {
        name: "manual-resize",
        callback: () => {
          if (this.eventQueue.length === 0) {
            this._handleGrabOpEnd(display, metaWindow, grabOp);
          }
        },
      },
      50
    );
  }

  _stopLiveResizeLoop() {
    this._grab.dispose();
  }

  disable() {
    Utils._disableDecorations();
    this._removeSignals();
    this.disabled = true;
    Logger.debug(`extension:disable`);
  }

  enable() {
    // Pair with disable(): re-enable after a prior disable (B4-8).
    this.disabled = false;
    this._bindSignals();
    this.reloadTree("enable");
    Logger.debug(`extension:enable`);
  }

  /**
   * Wire keybindings after both WM and Keybindings are constructed.
   * Call from AnvilExtension.enable — never create Keybindings in a getter.
   * @see codebase-review.md B2-2, B4-9
   */
  wireKeybindings(kbd: Keybindings) {
    this._kbd = kbd;
  }

  findNodeWindow(metaWindow: Meta.Window) {
    return this.tree.findNode(metaWindow);
  }

  get focusMetaWindow() {
    return global.display.get_focus_window();
  }

  get tree() {
    if (!this._tree) {
      // Lazy recreate with TreeHost (Stage 7 — no concrete WM dependency on Tree)
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      const self = this;
      this._tree = new Tree({
        get settings() {
          return self.ext.settings;
        },
        get focusMetaWindow() {
          return self.focusMetaWindow;
        },
        determineSplitLayout: () => self.determineSplitLayout(),
        floatingWindow: (n) => self.floatingWindow(n),
        bindWorkspaceSignals: (ws) => self.bindWorkspaceSignals(ws),
      });
    }
    return this._tree;
  }

  get kbd() {
    // No lazy construction (B4-9). Must be wired via wireKeybindings() after
    // AnvilExtension constructs Keybindings.
    if (!this._kbd) {
      throw new Error("WindowManager.kbd used before wireKeybindings()");
    }
    return this._kbd;
  }

  get windowsActiveWorkspace() {
    const wsManager = global.workspace_manager;
    return global.display.get_tab_list(Meta.TabList.NORMAL_ALL, wsManager.get_active_workspace());
  }

  get windowsAllWorkspaces() {
    const wsManager = global.workspace_manager;
    const windowsAll: Meta.Window[] = [];

    for (let i = 0; i < wsManager.get_n_workspaces(); i++) {
      Array.prototype.push.apply(
        windowsAll,
        global.display.get_tab_list(Meta.TabList.NORMAL_ALL, wsManager.get_workspace_by_index(i))
      );
    }
    windowsAll.sort((w1, w2) => {
      return w1.get_stable_sequence() - w2.get_stable_sequence();
    });
    return windowsAll;
  }

  getWindowsOnWorkspace(workspaceIndex: number) {
    const workspaceNode = this.tree.findNode(`ws${workspaceIndex}`);
    if (!workspaceNode) return [];
    const workspaceWindows = workspaceNode.getNodeByType(NODE_TYPES.WINDOW);
    return workspaceWindows;
  }

  determineSplitLayout() {
    return this._layout.determineSplitLayout();
  }

  floatWorkspace(workspaceIndex: number) {
    const workspaceWindows = this.getWindowsOnWorkspace(workspaceIndex);
    if (!workspaceWindows) return;
    workspaceWindows.forEach((w) => {
      w.float = true;
    });
  }

  unfloatWorkspace(workspaceIndex: number) {
    const workspaceWindows = this.getWindowsOnWorkspace(workspaceIndex);
    if (!workspaceWindows) return;
    workspaceWindows.forEach((w) => {
      w.tile = true;
    });
  }

  _bordersEnabled() {
    const settings = this.ext.settings;
    return (
      settings.get_boolean("focus-border-toggle") || settings.get_boolean("split-border-toggle")
    );
  }

  ensureBorderActors(windowActor: AnvilWindowActor | null) {
    this._borders.ensureBorderActors(windowActor);
  }

  ensureAllBorderActors() {
    this._borders.ensureAllBorderActors();
  }

  destroyAllBorderActors() {
    this._borders.destroyAllBorderActors();
  }

  hideActorBorder(actor: AnvilWindowActor | null) {
    this._borders.hideActorBorder(actor);
  }

  hideWindowBorders() {
    this._borders.hideWindowBorders();
  }

  // Window movement API
  move(metaWindow: Meta.Window, rect: { x: number; y: number; width: number; height: number }) {
    if (!metaWindow) return;
    if ((metaWindow as any).grabbed) return;
    try {
      // GNOME 49+
      metaWindow.set_unmaximize_flags(Meta.MaximizeFlags.BOTH);
      metaWindow.unmaximize();
    } catch {
      // pre-49 fallback
      (metaWindow as any).unmaximize(Meta.MaximizeFlags.HORIZONTAL);
      (metaWindow as any).unmaximize(Meta.MaximizeFlags.VERTICAL);
      (metaWindow as any).unmaximize(Meta.MaximizeFlags.BOTH);
    }

    const windowActor = metaWindow.get_compositor_private() as AnvilWindowActor | null;
    if (!windowActor) return;
    windowActor.remove_all_transitions();

    metaWindow.move_frame(true, rect.x, rect.y);
    metaWindow.move_resize_frame(true, rect.x, rect.y, rect.width, rect.height);
  }

  moveCenter(metaWindow: Meta.Window) {
    if (!metaWindow) return;
    const frameRect = metaWindow.get_frame_rect();
    const rectRequest = {
      x: "center",
      y: "center",
      width: frameRect.width,
      height: frameRect.height,
    };

    const moveRect = {
      x: Utils.resolveX(rectRequest, metaWindow),
      y: Utils.resolveY(rectRequest, metaWindow),
      width: Utils.resolveWidth(rectRequest, metaWindow),
      height: Utils.resolveHeight(rectRequest, metaWindow),
    };
    this.move(metaWindow, moveRect);
  }

  rectForMonitor(node: Node<any>, targetMonitor: number) {
    if (!node || (node && node.nodeType !== NODE_TYPES.WINDOW)) return null;
    if (targetMonitor < 0) return null;
    const metaWindow = node.nodeValue as Meta.Window;
    const currentWorkArea = metaWindow.get_work_area_current_monitor();
    const nextWorkArea = metaWindow.get_work_area_for_monitor(targetMonitor);

    if (currentWorkArea && nextWorkArea) {
      let rect: RectLike | null = node.rect;
      if (!rect && node.mode === WINDOW_MODES.FLOAT) {
        rect = metaWindow.get_frame_rect();
      }
      if (!rect) return null;
      const hRatio = nextWorkArea.height / currentWorkArea.height;
      const wRatio = nextWorkArea.width / currentWorkArea.width;
      rect.height *= hRatio;
      rect.width *= wRatio;

      if (nextWorkArea.y < currentWorkArea.y) {
        rect.y =
          ((nextWorkArea.y + rect.y - currentWorkArea.y) / currentWorkArea.height) *
          nextWorkArea.height;
      } else if (nextWorkArea.y > currentWorkArea.y) {
        rect.y = (rect.y / currentWorkArea.height) * nextWorkArea.height + nextWorkArea.y;
      }

      if (nextWorkArea.x < currentWorkArea.x) {
        rect.x =
          ((nextWorkArea.x + rect.x - currentWorkArea.x) / currentWorkArea.width) *
          nextWorkArea.width;
      } else if (nextWorkArea.x > currentWorkArea.x) {
        rect.x = (rect.x / currentWorkArea.width) * nextWorkArea.width + nextWorkArea.x;
      }
      return rect;
    }
    return null;
  }

  _removeSignals() {
    if (!this._signalsBound) return;

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

    const allWindows = this.windowsAllWorkspaces;

    if (allWindows) {
      for (const metaWindowRaw of allWindows) {
        const metaWindow = metaWindowRaw as AnvilMetaWindow;
        if (metaWindow.windowSignals !== undefined) {
          for (const windowSignal of metaWindow.windowSignals) {
            metaWindow.disconnect(windowSignal);
          }
          metaWindow.windowSignals.length = 0;
          metaWindow.windowSignals = undefined;
        }

        this._tracker.clearPendingWindowSignals(metaWindow);

        const windowActor = metaWindow.get_compositor_private() as AnvilWindowActor | null;
        if (windowActor && windowActor.actorSignals) {
          for (const actorSignal of windowActor.actorSignals) {
            windowActor.disconnect(actorSignal);
          }
          windowActor.actorSignals.length = 0;
          windowActor.actorSignals = undefined;
        }

        if (windowActor && windowActor.border) {
          windowActor.border.hide();
          if (global.window_group) {
            global.window_group.remove_child(windowActor.border);
          }
          windowActor.border = undefined;
        }

        if (windowActor && windowActor.splitBorder) {
          windowActor.splitBorder.hide();
          if (global.window_group) {
            global.window_group.remove_child(windowActor.splitBorder);
          }
          windowActor.splitBorder = undefined;
        }
      }
    }

    this._settingsBridge.disable();

    if (this._renderTreeSrcId) {
      GLib.Source.remove(this._renderTreeSrcId);
      this._renderTreeSrcId = 0;
    }

    if (this._reloadTreeSrcId) {
      GLib.Source.remove(this._reloadTreeSrcId);
      this._reloadTreeSrcId = 0;
    }

    this._tracker.dispose();
    this._grab.dispose();

    if (this._queueSourceId) {
      GLib.Source.remove(this._queueSourceId);
      this._queueSourceId = 0;
    }

    this._disposePointerPolicy();

    if (this._prefsOpenSrcId) {
      GLib.Source.remove(this._prefsOpenSrcId);
      this._prefsOpenSrcId = 0;
    }

    if (this._overviewSignals) {
      for (const overviewSignal of this._overviewSignals) {
        Main.overview.disconnect(overviewSignal);
      }
      this._overviewSignals.length = 0;
      this._overviewSignals = null;
    }

    this._signalsBound = false;
  }

  renderTree(from: string, force: boolean = false) {
    const wasFrozen = this._freezeRender;
    if (force && wasFrozen) this.unfreezeRender();
    if (this._freezeRender || !this.ext.settings.get_boolean("tiling-mode-enabled")) {
      this.updateDecorationLayout();
      this.updateBorderLayout();
    } else {
      if (!this._renderTreeSrcId) {
        this._renderTreeSrcId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
          this._tilingRender.render(from);
          this._renderTreeSrcId = 0;
          this.updateDecorationLayout();
          this.updateBorderLayout();
          if (wasFrozen) this.freezeRender();
          return false;
        });
      }
    }
  }

  get allNodeWindows() {
    return this.tree.getNodeByType(NODE_TYPES.WINDOW);
  }

  /**
   * Reloads the tree. This is an expensive operation.
   * Useful when using dynamic workspaces in GNOME-shell.
   *
   * TODO: add support to reload the tree from a JSON dump file.
   * TODO: move this to tree.js
   */
  reloadTree(from: string) {
    if (!this._reloadTreeSrcId) {
      this._reloadTreeSrcId = GLib.idle_add(GLib.PRIORITY_LOW, () => {
        Utils._disableDecorations();
        // empty out the root children nodes
        this.tree.childNodes.length = 0;
        this.tree.attachNode = null;
        // initialize the workspaces and monitors id strings
        this.tree._initWorkspaces();
        this.trackCurrentWindows();
        this.renderTree(from);
        this._reloadTreeSrcId = 0;
        return false;
      });
    }
  }

  sameParentMonitor(firstNode: Node<any>, secondNode: Node<any>) {
    if (!firstNode || !secondNode) return false;
    if (!firstNode.nodeValue || !secondNode.nodeValue) return false;
    const firstWin = firstNode.nodeValue as Meta.Window;
    const secondWin = secondNode.nodeValue as Meta.Window;
    if (!firstWin.get_workspace()) return false;
    if (!secondWin.get_workspace()) return false;
    const firstMonWs = `mo${firstWin.get_monitor()}ws${firstWin.get_workspace().index()}`;
    const secondMonWs = `mo${secondWin.get_monitor()}ws${secondWin.get_workspace().index()}`;
    return firstMonWs === secondMonWs;
  }

  showWindowBorders() {
    this._borders.showWindowBorders();
  }

  updateBorderLayout() {
    this._borders.updateBorderLayout();
  }

  _clearPendingWindowSignals(metaWindow: AnvilMetaWindow) {
    this._tracker.clearPendingWindowSignals(metaWindow);
  }

  _trackWindowWhenReady(display: Meta.Display, metaWindow: Meta.Window, afterTrack?: () => void) {
    this._tracker.trackWhenReady(display, metaWindow, afterTrack);
  }

  _trackMappedWindowActor(
    actor:
      | (AnvilWindowActor & {
          meta_window?: Meta.Window | null;
          get_meta_window?: () => Meta.Window | null;
        })
      | null
  ) {
    this._tracker.trackMappedActor(actor);
  }

  _scheduleCurrentWindowReconcile() {
    this._tracker.scheduleReconcile();
  }

  _reconcileCurrentWindows(from: string) {
    this._tracker.reconcileCurrentWindows(from);
  }

  trackWindow(_display: Meta.Display, metaWindow: Meta.Window) {
    this._tracker.trackWindow(_display, metaWindow);
  }

  postProcessWindow(nodeWindow: Node<any> | null) {
    this._tracker.postProcessWindow(nodeWindow);
  }

  trackCurrentWindows() {
    this._tracker.trackCurrentWindows();
  }

  _validWindow(metaWindow: Meta.Window) {
    return this._tracker.validWindow(metaWindow);
  }

  windowDestroy(actor: AnvilWindowActor) {
    this._tracker.windowDestroy(actor);
  }

  /**
   * Restore focus to another window after one is closed (#258)
   * Ported from jcrussell/forge
   */
  _restoreFocusAfterWindowClosed(closedNodeWindow: import("./tree.js").Node<any>) {
    this._tracker.restoreFocusAfterWindowClosed(closedNodeWindow);
  }

  updateStackedFocus(focusNodeWindow: Node<any> | undefined | null) {
    this._focus.updateStackedFocus(focusNodeWindow);
  }

  updateTabbedFocus(focusNodeWindow: Node<any> | null | undefined) {
    this._focus.updateTabbedFocus(focusNodeWindow);
  }

  /**
   * Check if a Meta Window's workspace is skipped for tiling.
   */
  isActiveWindowWorkspaceTiled(metaWindow: Meta.Window) {
    if (!metaWindow) return true;
    const skipWs = this.ext.settings.get_string("workspace-skip-tile");
    const skipArr = skipWs.split(",");
    let skipThisWs = false;

    for (let i = 0; i < skipArr.length; i++) {
      const activeWorkspaceForWin = metaWindow.get_workspace();
      if (activeWorkspaceForWin) {
        const wsIndex = activeWorkspaceForWin.index();
        if (skipArr[i].trim() === `${wsIndex}`) {
          skipThisWs = true;
          break;
        }
      }
    }
    return !skipThisWs;
  }

  /**
   * Check the current active workspace's tiling mode
   */
  isCurrentWorkspaceTiled() {
    const skipWs = this.ext.settings.get_string("workspace-skip-tile");
    const skipArr = skipWs.split(",");
    let skipThisWs = false;
    const wsMgr = global.workspace_manager;
    const wsIndex = wsMgr.get_active_workspace_index();

    for (let i = 0; i < skipArr.length; i++) {
      if (skipArr[i].trim() === `${wsIndex}`) {
        skipThisWs = true;
        break;
      }
    }
    return !skipThisWs;
  }

  updateMetaWorkspaceMonitor(from: string, _monitor: number | null, metaWindow: Meta.Window) {
    if (this._validWindow(metaWindow)) {
      if (metaWindow.get_workspace() === null) return;
      const existNodeWindow = this.tree.findNode(metaWindow);
      const metaMonWs = `mo${metaWindow.get_monitor()}ws${metaWindow.get_workspace().index()}`;
      const metaMonWsNode = this.tree.findNode(metaMonWs);
      if (existNodeWindow) {
        if (existNodeWindow.parentNode && metaMonWsNode) {
          // Uses the existing workspace, monitor that the metaWindow
          // belongs to.
          const containsWindow = metaMonWsNode.contains(existNodeWindow);
          if (!containsWindow) {
            // handle cleanup of resize percentages - preserve proportions
            // Store parent reference before moving, then redistribute after
            // Ported from jcrussell/forge
            const existParent = existNodeWindow.parentNode;
            metaMonWsNode.appendChild(existNodeWindow);
            this._layout.redistributeSiblingPercent(existParent);

            // Ensure that the workspace tiling is honored
            if (this.isActiveWindowWorkspaceTiled(metaWindow)) {
              if (this.grabOp !== Meta.GrabOp.WINDOW_BASE) this.updateTabbedFocus(existNodeWindow);
              this.updateStackedFocus(existNodeWindow);
            } else {
              if (this.floatingWindow(existNodeWindow)) {
                safeRaise(existNodeWindow.nodeValue as Meta.Window);
              }
            }
          }
        }
      }
      this.renderTree(from);
    }
  }

  /**
   * Handle any updates to the current focused window's position.
   * Useful for updating the active window border, etc.
   */
  updateMetaPositionSize(_metaWindow: Meta.Window, from: string) {
    const focusMetaWindow = this.focusMetaWindow;
    if (!focusMetaWindow) return;

    const focusNodeWindow = this.findNodeWindow(focusMetaWindow);
    if (!focusNodeWindow) return;

    const tilingModeEnabled = this.ext.settings.get_boolean("tiling-mode-enabled");

    if (focusNodeWindow.grabMode && tilingModeEnabled) {
      if (focusNodeWindow.grabMode === GRAB_TYPES.RESIZING) {
        this._handleResizing(focusNodeWindow);
      } else if (focusNodeWindow.grabMode === GRAB_TYPES.MOVING) {
        this._handleMoving(focusNodeWindow);
      }
    } else {
      if (
        (() => {
          try {
            // GNOME 49+
            return !focusMetaWindow.is_maximized();
          } catch {
            // pre-49 fallback
            return (focusMetaWindow as AnvilMetaWindow).get_maximized() === 0;
          }
        })()
      ) {
        this.renderTree(from);
      }
    }
    this.updateBorderLayout();
    this.updateDecorationLayout();
  }

  updateDecorationLayout() {
    if (this._freezeRender) return;
    const activeWsNode = this.currentWsNode;
    const allCons = this.tree.getNodeByType(NODE_TYPES.CON);

    // First, hide all decorations:
    allCons.forEach((con) => {
      if (con.decoration) {
        con.decoration.hide();
      }
    });

    // Next, handle showing-desktop usually by Super + D
    if (!activeWsNode) return;
    const allWindows = activeWsNode.getNodeByType(NODE_TYPES.WINDOW);
    const allHiddenWindows = allWindows.filter((w) => {
      const metaWindow = w.nodeValue as Meta.Window;
      return !metaWindow.showing_on_its_workspace() || metaWindow.minimized;
    });

    // Then if all hidden, do not proceed showing the decorations at all;
    if (allWindows.length === allHiddenWindows.length) return;

    // Show the decoration where on all monitors of active workspace
    // But not on the monitor where there is a maximized or fullscreen window
    // Note, that when multi-display, user can have multi maximized windows,
    // So it needs to be fully filtered:
    const monWsNoMaxWindows = activeWsNode.getNodeByType(NODE_TYPES.MONITOR).filter((monitor) => {
      return (
        monitor.getNodeByType(NODE_TYPES.WINDOW).filter((w) => {
          return (() => {
            try {
              // GNOME 49+
              return (
                (w.nodeValue as Meta.Window).is_maximized() ||
                (w.nodeValue as Meta.Window).is_fullscreen()
              );
            } catch {
              // pre-49 fallback
              return (
                (w.nodeValue as AnvilMetaWindow).get_maximized() === Meta.MaximizeFlags.BOTH ||
                (w.nodeValue as Meta.Window).is_fullscreen()
              );
            }
          })();
        }).length === 0
      );
    });

    monWsNoMaxWindows.forEach((monitorWs) => {
      const activeMonWsCons = monitorWs.getNodeByType(NODE_TYPES.CON);
      activeMonWsCons.forEach((con) => {
        const tiled = this.tree.getTiledChildren(con.childNodes);
        const showTabs = this.ext.settings.get_boolean("showtab-decoration-enabled");
        if (con.decoration && tiled.length > 0 && showTabs) {
          con.decoration.show();
          const focusMetaWindow = this.focusMetaWindow;
          if (global.window_group.contains(con.decoration) && focusMetaWindow) {
            global.window_group.remove_child(con.decoration);
            // Show it below the focused window
            global.window_group.insert_child_below(
              con.decoration,
              focusMetaWindow.get_compositor_private()
            );
          }
          con.childNodes.forEach((cn) => {
            cn.render();
          });
        }
      });
    });
  }

  freezeRender() {
    this._freezeRender = true;
  }

  unfreezeRender() {
    this._freezeRender = false;
  }

  floatingWindow(node: Node<any> | null) {
    if (!node) return false;
    return node.nodeType === NODE_TYPES.WINDOW && node.mode === WINDOW_MODES.FLOAT;
  }

  minimizedWindow(node: Node<any> | null) {
    if (!node) return false;
    return node._type === NODE_TYPES.WINDOW && node._data && (node._data as Meta.Window).minimized;
  }

  /**
   *
   * Handle previewing and applying where a drag-drop window is going to be tiled
   *
   */
  moveWindowToPointer(focusNodeWindow: Node<any>, preview: boolean = false) {
    if (this.cancelGrab) {
      return;
    }
    if (!focusNodeWindow || focusNodeWindow.mode !== WINDOW_MODES.GRAB_TILE) return;

    const nodeWinAtPointer = this.nodeWinAtPointer;

    if (nodeWinAtPointer) {
      const targetRect = (nodeWinAtPointer.nodeValue as Meta.Window).get_frame_rect();
      const parentNodeTarget = nodeWinAtPointer.parentNode;
      const currPointer = global.get_pointer() as unknown as [number, number];
      const horizontal = parentNodeTarget!.isHSplit() || parentNodeTarget!.isTabbed();
      const isMonParent = parentNodeTarget!.nodeType === NODE_TYPES.MONITOR;
      const isConParent = parentNodeTarget!.nodeType === NODE_TYPES.CON;
      const centerLayout = this.ext.settings.get_string("dnd-center-layout").toUpperCase();
      const stacked = parentNodeTarget!.isStacked();
      const tabbed = parentNodeTarget!.isTabbed();
      const stackedOrTabbed = stacked || tabbed;
      const updatePreview = (
        focusNodeWindow: Node<any>,
        previewParams: { className: string; targetRect: any }
      ) => {
        const previewHint = focusNodeWindow.previewHint;
        const previewHintEnabled = this.ext.settings.get_boolean("preview-hint-enabled");
        const previewRect = previewParams.targetRect;
        if (previewHint && previewHintEnabled) {
          if (!previewRect) {
            previewHint.hide();
            return;
          }
          previewHint.set_style_class_name(previewParams.className);
          previewHint.set_position(previewRect.x, previewRect.y);
          previewHint.set_size(previewRect.width, previewRect.height);
          previewHint.show();
        }
      };
      const regions = (
        targetRect: { x: number; y: number; width: number; height: number },
        regionWidth: number
      ) => {
        leftRegion = {
          x: targetRect.x,
          y: targetRect.y,
          width: targetRect.width * regionWidth,
          height: targetRect.height,
        };

        rightRegion = {
          x: targetRect.x + targetRect.width * (1 - regionWidth),
          y: targetRect.y,
          width: targetRect.width * regionWidth,
          height: targetRect.height,
        };

        topRegion = {
          x: targetRect.x,
          y: targetRect.y,
          width: targetRect.width,
          height: targetRect.height * regionWidth,
        };

        bottomRegion = {
          x: targetRect.x,
          y: targetRect.y + targetRect.height * (1 - regionWidth),
          width: targetRect.width,
          height: targetRect.height * regionWidth,
        };

        centerRegion = {
          x: targetRect.x + targetRect.width * regionWidth,
          y: targetRect.y + targetRect.height * regionWidth,
          width: targetRect.width - targetRect.width * regionWidth * 2,
          height: targetRect.height - targetRect.height * regionWidth * 2,
        };

        return {
          left: leftRegion,
          right: rightRegion,
          top: topRegion,
          bottom: bottomRegion,
          center: centerRegion,
        };
      };
      let referenceNode: Node<any> | null = null;
      let containerNode: Node<any> | null = null;
      let childNode = focusNodeWindow;
      let previewParams: { className: string; targetRect: any } = {
        className: "",
        targetRect: null,
      };
      let leftRegion;
      let rightRegion;
      let topRegion;
      let bottomRegion;
      let centerRegion;
      const previewWidth = 0.5;
      const hoverWidth = 0.3;

      // Hover region detects where the pointer is on the target drop window
      const hoverRegions = regions(targetRect, hoverWidth);

      // Preview region interprets the hover intersect where the focus window
      // would go when dropped
      const previewRegions = regions(targetRect, previewWidth);

      leftRegion = hoverRegions.left;
      rightRegion = hoverRegions.right;
      topRegion = hoverRegions.top;
      bottomRegion = hoverRegions.bottom;
      centerRegion = hoverRegions.center;

      const isLeft = Utils.rectContainsPoint(leftRegion, currPointer);
      const isRight = Utils.rectContainsPoint(rightRegion, currPointer);
      const isTop = Utils.rectContainsPoint(topRegion, currPointer);
      const isBottom = Utils.rectContainsPoint(bottomRegion, currPointer);
      const isCenter = Utils.rectContainsPoint(centerRegion, currPointer);

      if (isCenter) {
        if (centerLayout == "SWAP") {
          referenceNode = nodeWinAtPointer;
          previewParams = {
            className: "",
            targetRect: targetRect,
          };
        } else {
          if (stackedOrTabbed) {
            containerNode = parentNodeTarget;
            referenceNode = null;
            previewParams = {
              className: stacked ? "window-tilepreview-stacked" : "window-tilepreview-tabbed",
              targetRect: targetRect,
            };
          } else {
            if (isMonParent) {
              childNode.createCon = true;
              containerNode = parentNodeTarget;
              referenceNode = nodeWinAtPointer;
              previewParams = {
                className: "",
                targetRect: targetRect,
              };
            } else {
              containerNode = parentNodeTarget;
              referenceNode = null;
              const parentTargetRect = this._tilingRender.processGap(parentNodeTarget!);
              previewParams = {
                className: "",
                targetRect: parentTargetRect,
              };
            }
          }
        }
      } else if (isLeft) {
        previewParams = {
          className: "",
          targetRect: previewRegions.left,
        };

        if (stackedOrTabbed) {
          // treat any windows on stacked or tabbed layouts to be
          // a single node unit: the con itself and then
          // split left, top, right or bottom accordingly (subsequent if conditions):
          childNode.detachWindow = true;
          if (!isMonParent) {
            referenceNode = parentNodeTarget;
            containerNode = parentNodeTarget!.parentNode;
          } else {
            // It is a monitor that's a stack/tab
            // TODO: update the stacked/tabbed toggles to not
            // change layout if the parent is a monitor?
          }
        } else {
          if (horizontal) {
            containerNode = parentNodeTarget;
            referenceNode = nodeWinAtPointer;
          } else {
            // vertical orientation
            childNode.createCon = true;
            containerNode = parentNodeTarget;
            referenceNode = nodeWinAtPointer;
          }
        }
      } else if (isRight) {
        previewParams = {
          className: "",
          targetRect: previewRegions.right,
        };
        if (stackedOrTabbed) {
          // treat any windows on stacked or tabbed layouts to be
          // a single node unit: the con itself and then
          // split left, top, right or bottom accordingly (subsequent if conditions):
          childNode.detachWindow = true;
          if (!isMonParent) {
            referenceNode = parentNodeTarget!.nextSibling;
            containerNode = parentNodeTarget!.parentNode;
          } else {
            // It is a monitor that's a stack/tab
            // TODO: update the stacked/tabbed toggles to not
            // change layout if the parent is a monitor?
          }
        } else {
          if (horizontal) {
            containerNode = parentNodeTarget;
            referenceNode = nodeWinAtPointer.nextSibling;
          } else {
            childNode.createCon = true;
            containerNode = parentNodeTarget;
            referenceNode = nodeWinAtPointer.nextSibling;
          }
        }
      } else if (isTop) {
        previewParams = {
          className: "",
          targetRect: previewRegions.top,
        };
        if (stackedOrTabbed) {
          // treat any windows on stacked or tabbed layouts to be
          // a single node unit: the con itself and then
          // split left, top, right or bottom accordingly (subsequent if conditions):
          if (!isMonParent) {
            containerNode = parentNodeTarget;
            referenceNode = null;
            previewParams = {
              className: stacked ? "window-tilepreview-stacked" : "window-tilepreview-tabbed",
              targetRect: targetRect,
            };
          } else {
            // It is a monitor that's a stack/tab
            // TODO: update the stacked/tabbed toggles to not
            // change layout if the parent is a monitor?
          }
        } else {
          if (horizontal) {
            childNode.createCon = true;
            containerNode = parentNodeTarget;
            referenceNode = nodeWinAtPointer;
          } else {
            containerNode = parentNodeTarget;
            referenceNode = nodeWinAtPointer;
          }
        }
      } else if (isBottom) {
        previewParams = {
          className: "",
          targetRect: previewRegions.bottom,
        };
        if (stackedOrTabbed) {
          // treat any windows on stacked or tabbed layouts to be
          // a single node unit: the con itself and then
          // split left, top, right or bottom accordingly (subsequent if conditions):
          if (!isMonParent) {
            containerNode = parentNodeTarget;
            referenceNode = null;
            previewParams = {
              className: stacked ? "window-tilepreview-stacked" : "window-tilepreview-tabbed",
              targetRect: targetRect,
            };
          } else {
            // It is a monitor that's a stack/tab
            // TODO: update the stacked/tabbed toggles to not
            // change layout if the parent is a monitor?
          }
        } else {
          if (horizontal) {
            childNode = focusNodeWindow;
            childNode.createCon = true;
            containerNode = parentNodeTarget;
            referenceNode = nodeWinAtPointer.nextSibling;
          } else {
            childNode = focusNodeWindow;
            containerNode = parentNodeTarget;
            referenceNode = nodeWinAtPointer.nextSibling;
          }
        }
      }

      if (!isCenter) {
        if (stackedOrTabbed) {
          if (isLeft || isRight) {
            previewParams.className = "window-tilepreview-tiled";
          } else if (isTop || isBottom) {
            previewParams.className = stacked
              ? "window-tilepreview-stacked"
              : "window-tilepreview-tabbed";
          }
        } else {
          previewParams.className = "window-tilepreview-tiled";
        }
      } else if (isCenter) {
        if (!stackedOrTabbed) previewParams.className = this._getDragDropCenterPreviewStyle();
      }

      if (!preview) {
        const previousParent = focusNodeWindow!.parentNode!;
        this._layout.resetSiblingPercent(containerNode);
        this._layout.resetSiblingPercent(previousParent);

        if (focusNodeWindow.tab) {
          const decoParent = focusNodeWindow.tab.get_parent();
          if (decoParent) decoParent.remove_child(focusNodeWindow.tab);
        }

        if (childNode.createCon) {
          const numWin = parentNodeTarget!.childNodes.filter(
            (c) => c.nodeType === NODE_TYPES.WINDOW
          ).length;
          const numChild = parentNodeTarget!.childNodes.length;
          const sameNumChild = numWin === numChild;
          // Child Node will still be created
          if (
            !isCenter &&
            ((isConParent && numWin === 1 && sameNumChild) ||
              (isMonParent && numWin == 2 && sameNumChild))
          ) {
            childNode = parentNodeTarget!;
          } else {
            childNode = new Node(NODE_TYPES.CON, new St.Bin());
            containerNode!.insertBefore(childNode!, referenceNode);
            childNode.appendChild(nodeWinAtPointer);
          }

          if (isLeft || isTop) {
            childNode.insertBefore(focusNodeWindow, nodeWinAtPointer);
          } else if (isRight || isBottom || isCenter) {
            childNode.insertBefore(focusNodeWindow, null);
          }

          if (isLeft || isRight) {
            childNode.layout = LAYOUT_TYPES.HSPLIT;
          } else if (isTop || isBottom) {
            childNode.layout = LAYOUT_TYPES.VSPLIT;
          } else if (isCenter) {
            childNode.layout = (LAYOUT_TYPES as Record<string, string>)[centerLayout];
          }
        } else if (childNode.detachWindow) {
          const orientation =
            isLeft || isRight ? ORIENTATION_TYPES.HORIZONTAL : ORIENTATION_TYPES.VERTICAL;
          this._layout.split(childNode as Node<any>, orientation);
          containerNode!.insertBefore(childNode!.parentNode!, referenceNode);
        } else if (isCenter && centerLayout == "SWAP") {
          this._layout.swapPairs(referenceNode!, focusNodeWindow);
          this.renderTree("drag-swap");
        } else {
          // Child Node is a WINDOW
          containerNode!.insertBefore(childNode, referenceNode);
          if (isLeft || isRight) {
            containerNode!.layout = LAYOUT_TYPES.HSPLIT;
          } else if (isTop || isBottom) {
            if (!stackedOrTabbed) containerNode!.layout = LAYOUT_TYPES.VSPLIT;
          } else if (isCenter) {
            if (containerNode!.isHSplit() || containerNode!.isVSplit()) {
              containerNode!.layout = (LAYOUT_TYPES as Record<string, string>)[centerLayout];
            }
          }
        }
        previousParent.resetLayoutSingleChild();
      } else {
        updatePreview(focusNodeWindow, previewParams);
      }
      childNode.createCon = false;
      childNode.detachWindow = false;
    }
  }

  findNodeWindowAtPointer(focusNodeWindow: Node<any>) {
    const pointerCoord = global.get_pointer() as unknown as [number, number];

    const nodeWinAtPointer = this._findNodeWindowAtPointer(
      focusNodeWindow.nodeValue as Meta.Window,
      pointerCoord
    );
    return nodeWinAtPointer;
  }

  _findNodeWindowAtPointer(metaWindow: Meta.Window, pointer: [number, number]) {
    if (!metaWindow) return undefined;

    const sortedWindows = this.sortedWindows;

    if (!sortedWindows) {
      Logger.warn("No sorted windows");
      return;
    }

    const w = Utils.metaWindowAtPoint(pointer, sortedWindows);
    if (w) return this.tree.getNodeByValue(w);

    return null;
  }

  _handleGrabOpBegin(display: Meta.Display, metaWindow: Meta.Window, grabOp: Meta.GrabOp) {
    this._grab.begin(display, metaWindow, grabOp);
  }

  _handleGrabOpEnd(display: Meta.Display, metaWindow: Meta.Window, grabOp: Meta.GrabOp) {
    this._grab.end(display, metaWindow, grabOp);
  }

  _grabCleanup(focusNodeWindow: Node<any> | null) {
    this._grab.cleanup(focusNodeWindow);
  }

  allowDragDropTile() {
    return this.kbd.allowDragDropTile();
  }

  _handleResizing(focusNodeWindow: Node<any> | null) {
    this._grab.handleResizing(focusNodeWindow);
  }

  _handleMoving(focusNodeWindow: Node<any> | null) {
    this._grab.handleMoving(focusNodeWindow);
  }

  /** Float/tile classification — delegated to RulesEngine (sole owner). */
  isFloatingExempt(metaWindow: Meta.Window | null) {
    // Keep rules cache aligned with WM windowProps (tests may mutate either).
    this._rules.windowProps = this.windowProps;
    return this._rules.isFloatingExempt(metaWindow);
  }

  _getDragDropCenterPreviewStyle() {
    const centerLayout = this.ext.settings.get_string("dnd-center-layout");
    return `window-tilepreview-${centerLayout}`;
  }

  get currentMonWsNode() {
    const monWs = this.currentMonWs;
    if (monWs) {
      return this.tree.findNode(monWs);
    }
    return null;
  }

  get currentWsNode() {
    const ws = this.currentWs;
    if (ws) {
      return this.tree.findNode(ws);
    }
    return null;
  }

  get currentMonWs() {
    const monWs = `${this.currentMon}${this.currentWs}`;
    return monWs;
  }

  get currentWs() {
    const display = global.display;
    const wsMgr = display.get_workspace_manager();
    return `ws${wsMgr.get_active_workspace_index()}`;
  }

  get currentMon() {
    const display = global.display;
    return `mo${display.get_current_monitor()}`;
  }

  /**
   * Reload window overrides from the configuration file
   * This is called when the preferences page modifies the overrides
   */
  reloadWindowOverrides() {
    this._rules.reloadFromConfig(this.ext.configMgr);
    this.windowProps = this._rules.windowProps;
  }

  /**
   * Official test probe payload (B1-3). Used by AnvilExtension.getTestState().
   * Does not expose private fields to callers.
   */
  getTestStateJson(): string {
    return JSON.stringify({
      treeExists: !!this._tree,
      tilingEnabled: this.ext.settings.get_boolean("tiling-mode-enabled"),
      stackedEnabled: this.ext.settings.get_boolean("stacked-tiling-mode-enabled"),
      tabbedEnabled: this.ext.settings.get_boolean("tabbed-tiling-mode-enabled"),
      tree: this._tree ? this._tree.serializeForTest() : null,
    });
  }

  floatAllWindows() {
    this.tree.getNodeByType(NODE_TYPES.WINDOW).forEach((w) => {
      if (w.isFloat()) {
        w.prevFloat = true;
      }
      w.mode = WINDOW_MODES.FLOAT;
    });
  }

  unfloatAllWindows() {
    this.tree.getNodeByType(NODE_TYPES.WINDOW).forEach((w) => {
      if (!w.prevFloat) {
        w.mode = WINDOW_MODES.TILE;
      } else {
        // Reset the float marker
        w.prevFloat = false;
      }
    });
  }
}
