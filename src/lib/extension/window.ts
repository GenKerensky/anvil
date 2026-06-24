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
import Clutter from "gi://Clutter";

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
  POSITION,
  LAYOUT_TYPES,
  ORIENTATION_TYPES,
  NODE_TYPES,
  RectLike,
} from "./tree.js";
import { production } from "../shared/settings.js";
import { safeRaise, safeFocus, safeActivate } from "./mutter-safe.js";
import { PointerPolicy, type PointerFocusSource } from "./pointer-policy.js";
import { TilingRender } from "./tiling-render.js";

type AnvilExtension = import("../../extension.js").default;

export const WINDOW_MODES = Utils.createEnum(["FLOAT", "TILE", "GRAB_TILE", "DEFAULT"]);

// Simplify the grab modes
export const GRAB_TYPES = Utils.createEnum(["RESIZING", "MOVING", "UNKNOWN"]);

// Bug #351 fix: Window types that shouldn't be tiled (browser popups, tooltips, etc.)
// Ported from jcrussell/forge
const INVALID_WINDOW_TYPES = new Set([
  Meta.WindowType.UTILITY,
  Meta.WindowType.POPUP_MENU,
  Meta.WindowType.DROPDOWN_MENU,
  Meta.WindowType.TOOLTIP,
]);

// Runtime-monkey-patched Meta types — these properties are set by anvil at runtime
// and are not present in @girs type declarations.
type AnvilMetaWindow = Meta.Window & {
  windowSignals?: number[];
  firstRender?: boolean;
  /** @deprecated pre-GNOME 49 fallback, removed from @girs types */
  get_maximized(): number;
};
type AnvilWindowActor = Clutter.Actor & {
  actorSignals?: number[];
  border?: St.Bin;
  splitBorder?: St.Bin;
};
type AnvilMetaWorkspace = Meta.Workspace & {
  workspaceSignals?: number[];
};

export class WindowManager extends GObject.Object {
  static {
    GObject.registerClass(this);
  }

  ext: AnvilExtension;
  windowProps!: WindowConfig;

  // --- State ---
  declare prefsTitle: string;
  declare disabled: boolean;
  declare _signalsBound: boolean;
  declare _freezeRender: boolean;
  declare _workspaceChanging: boolean;
  declare workspaceAdded: boolean;
  declare workspaceRemoved: boolean;
  declare fromOverview: boolean;
  declare toOverview: boolean;
  declare cancelGrab: boolean;

  // --- Object references ---
  declare _settingsChangedId: number;
  declare _kbd: import("./keybindings.js").Keybindings;
  declare _tree: Tree;
  declare eventQueue: Queue;
  declare theme: import("./extension-theme-manager.js").ExtensionThemeManager;
  declare _pointerPolicy: PointerPolicy;
  declare _tilingRender: TilingRender;
  declare nodeWinAtPointer: Node<any> | null;
  declare _draggedNodeWindow: Node<any> | null;
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
  declare _wsWindowAddSrcId: number;
  declare _workspaceChangingTimeoutId: number;
  declare _prefsOpenSrcId: number;
  declare _liveResizeSrcId: number;

  // --- Grab state ---
  declare grabOp: Meta.GrabOp;

  // --- Resize exemption tracking ---
  // Map<windowId, resizeCount> — only exempt after 2+ completed grabs
  // to avoid race with async Wayland size-changed signals.
  declare _resizedWindows: Map<number, number>;

  // --- Live resize pair tracking ---
  // Stores the resize pair found during _handleResizing so that
  // _liveResizeNeighbors can process the common ancestor when the
  // pair lives in a different parent container (diffParent case).
  declare _lastResizePair: Node<any> | null;

  constructor(ext: AnvilExtension) {
    super();
    this.ext = ext;
    this.prefsTitle = `Anvil ${_("Settings")} - ${
      !production ? "DEV" : `${PACKAGE_VERSION}-${ext.metadata.version}`
    }`;
    this.reloadWindowOverrides();
    this._kbd = this.ext.keybindings;
    this._tree = new Tree(this);
    this.eventQueue = new Queue();
    this.theme = this.ext.theme;
    this._pointerPolicy = new PointerPolicy({
      settings: this.ext.settings,
      isWorkspaceChanging: () => this._workspaceChanging,
      isDisabled: () => this.disabled,
    });
    this._pointerPolicy.setHoverFocusEnabled(
      !!this.ext.settings?.get_boolean("focus-on-hover-enabled")
    );
    this._tilingRender = new TilingRender({
      settings: this.ext.settings,
      getTree: () => this.tree,
      moveWindow: (metaWindow, rect) => this.move(metaWindow, rect),
      getAllNodeWindows: () => this.allNodeWindows,
      isFloatingExempt: (w) => this.isFloatingExempt(w),
      isActiveWindowWorkspaceTiled: (w) => this.isActiveWindowWorkspaceTiled(w),
      getTiledChildren: (nodes) => this.tree.getTiledChildren(nodes),
      getResizeCount: (id) => this._resizedWindows.get(id) || 0,
      findParent: (node, type) => this.tree.findParent(node, type),
    });
    this.cancelGrab = false;
    this._workspaceChanging = false;
    this._resizedWindows = new Map();
    this._lastResizePair = null;

    Logger.info("anvil initialized");
  }

  get pointerPolicy() {
    return this._pointerPolicy;
  }

  get tilingRender() {
    return this._tilingRender;
  }

  get lastFocusedWindow() {
    return this._pointerPolicy.lastFocusedWindow;
  }

  set lastFocusedWindow(node: Node<any> | null) {
    this._pointerPolicy.lastFocusedWindow = node;
  }

  get lastFocusedWindowMonitor() {
    return this._pointerPolicy.lastFocusedWindowMonitor;
  }

  set lastFocusedWindowMonitor(monitor: number) {
    this._pointerPolicy.lastFocusedWindowMonitor = monitor;
  }

  get lastFocusedWindowWorkspace() {
    return this._pointerPolicy.lastFocusedWindowWorkspace;
  }

  set lastFocusedWindowWorkspace(ws: number) {
    this._pointerPolicy.lastFocusedWindowWorkspace = ws;
  }

  get shouldFocusOnHover() {
    return this._pointerPolicy.hoverFocusEnabled;
  }

  set shouldFocusOnHover(enabled: boolean) {
    this._pointerPolicy.setHoverFocusEnabled(enabled);
  }

  private _onPointerFocusChanged(node: Node<any> | null, source: PointerFocusSource) {
    this._pointerPolicy.onFocusChanged({ node, source });
    if (node) this.tree.debugParentNodes(node);
  }

  addFloatOverride(metaWindow: Meta.Window, withWmId: boolean) {
    const configMgr = this.ext.configMgr;
    const currentProps = configMgr.windowProps;
    if (!currentProps) return;
    const overrides = currentProps.overrides;
    const wmClass = metaWindow.get_wm_class() ?? "";
    const wmId = metaWindow.get_id();

    for (const override of overrides) {
      // if the window is already floating
      if (
        override.wmClass === wmClass &&
        override.mode === "float" &&
        !override.wmTitle &&
        (!withWmId || override.wmId === String(wmId))
      )
        return;
    }
    overrides.push({
      wmClass,
      wmId: withWmId ? String(wmId) : undefined,
      mode: "float",
    });

    // Save the updated overrides back to the ConfigManager
    currentProps.overrides = overrides;
    configMgr.windowProps = currentProps;
  }

  removeFloatOverride(metaWindow: Meta.Window, withWmId: boolean) {
    const configMgr = this.ext.configMgr;
    const currentProps = configMgr.windowProps;
    if (!currentProps) return;
    let overrides = currentProps.overrides;
    const wmClass = metaWindow.get_wm_class() ?? "";
    const wmId = String(metaWindow.get_id());
    overrides = overrides.filter(
      (override) =>
        !(
          override.wmClass === wmClass &&
          // rules with a Title are written by the user and peristent
          !override.wmTitle &&
          (!withWmId || override.wmId === wmId)
        )
    );

    // Save the updated overrides back to the ConfigManager
    currentProps.overrides = overrides;
    configMgr.windowProps = currentProps;
  }

  toggleFloatingMode(action: any, metaWindow: Meta.Window) {
    const nodeWindow = this.findNodeWindow(metaWindow);
    if (!nodeWindow || !(action || action.mode)) return;
    if (nodeWindow.nodeType !== NODE_TYPES.WINDOW) return;

    const withWmId = action.name === "FloatToggle";
    const floatingExempt = this.isFloatingExempt(metaWindow);

    if (floatingExempt) {
      this.removeFloatOverride(metaWindow, withWmId);
      this.windowProps = this.ext.configMgr.windowProps ?? this.windowProps;
      if (!this.isActiveWindowWorkspaceTiled(metaWindow)) {
        nodeWindow.mode = WINDOW_MODES.FLOAT;
      } else {
        nodeWindow.mode = WINDOW_MODES.TILE;
      }
    } else {
      this.addFloatOverride(metaWindow, withWmId);
      this.windowProps = this.ext.configMgr.windowProps ?? this.windowProps;
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
      extDisplay.connect("window-created", (_d, w) => this.trackWindow(_d, w)),
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
      shellWm.connect("minimize", () => {
        this.hideWindowBorders();
        const focusNodeWindow = this.tree.findNode(this.focusMetaWindow);
        if (focusNodeWindow) {
          if (this.tree.getTiledChildren(focusNodeWindow!.parentNode!.childNodes).length === 0) {
            this.tree.resetSiblingPercent(focusNodeWindow!.parentNode!.parentNode);
          }
          this.tree.resetSiblingPercent(focusNodeWindow!.parentNode!);
        }

        const prevFrozen = this._freezeRender;
        if (prevFrozen) this.unfreezeRender();
        this.renderTree("minimize");
        if (prevFrozen) this.freezeRender();
      }),
      shellWm.connect("unminimize", () => {
        const focusNodeWindow = this.tree.findNode(this.focusMetaWindow);
        if (focusNodeWindow) {
          this.tree.resetSiblingPercent(focusNodeWindow!.parentNode!);
        }

        const prevFrozen = this._freezeRender;
        if (prevFrozen) this.unfreezeRender();
        this.renderTree("unminimize");
        if (prevFrozen) this.freezeRender();
      }),
      shellWm.connect("show-tile-preview", (_, _metaWindow, _rect, _num) => {
        // Empty
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
          this._pointerPolicy.onWorkspaceSettled();
          return false;
        });
      }),
    ];

    const numberOfWorkspaces = extWsm.get_n_workspaces();

    for (let i = 0; i < numberOfWorkspaces; i++) {
      const workspace = extWsm.get_workspace_by_index(i)!;
      this.bindWorkspaceSignals(workspace);
    }

    const settings = this.ext.settings;

    // Phase A fix: Save settings handler ID for cleanup on disable
    // Credit: mayconrcmello/forge PR #523
    this._settingsChangedId = settings.connect("changed", (_, settingName) => {
      switch (settingName) {
        case "window-overrides-reload-trigger":
          // Reload window overrides when triggered by preferences
          // This prevents the main extension from overwriting changes made by preferences
          this.reloadWindowOverrides();
          break;
        case "focus-border-toggle":
        case "focus-border-hidden-on-single":
          this.renderTree(settingName);
          break;
        case "focus-on-hover-enabled":
          this._pointerPolicy.setHoverFocusEnabled(settings.get_boolean(settingName));
          break;
        case "tiling-mode-enabled":
          this.renderTree(settingName);
          break;
        case "window-gap-size-increment":
        case "window-gap-size":
        case "window-gap-hidden-on-single":
        case "workspace-skip-tile":
          this.renderTree(settingName, true);
          break;
        case "stacked-tiling-mode-enabled":
          if (!settings.get_boolean(settingName)) {
            const stackedNodes = this.tree.getNodeByLayout(LAYOUT_TYPES.STACKED);
            stackedNodes.forEach((node) => {
              node.prevLayout = node.layout;
              node.layout = this.determineSplitLayout();
            });
          } else {
            const hSplitNodes = this.tree.getNodeByLayout(LAYOUT_TYPES.HSPLIT);
            const vSplitNodes = this.tree.getNodeByLayout(LAYOUT_TYPES.VSPLIT);
            Array.prototype.push.apply(hSplitNodes, vSplitNodes);
            hSplitNodes.forEach((node) => {
              if (node.prevLayout && node.prevLayout === LAYOUT_TYPES.STACKED) {
                node.layout = LAYOUT_TYPES.STACKED;
              }
            });
          }
          this.renderTree(settingName);
          break;
        case "tabbed-tiling-mode-enabled":
          if (!settings.get_boolean(settingName)) {
            const tabbedNodes = this.tree.getNodeByLayout(LAYOUT_TYPES.TABBED);
            tabbedNodes.forEach((node) => {
              node.prevLayout = node.layout;
              node.layout = this.determineSplitLayout();
            });
          } else {
            const hSplitNodes = this.tree.getNodeByLayout(LAYOUT_TYPES.HSPLIT);
            const vSplitNodes = this.tree.getNodeByLayout(LAYOUT_TYPES.VSPLIT);
            Array.prototype.push.apply(hSplitNodes, vSplitNodes);
            hSplitNodes.forEach((node) => {
              if (node.prevLayout && node.prevLayout === LAYOUT_TYPES.TABBED) {
                node.layout = LAYOUT_TYPES.TABBED;
              }
            });
          }
          this.renderTree(settingName);
          break;
        case "css-updated":
          this.theme?.reloadStylesheet();
          break;
        case "float-always-on-top-enabled":
          if (!settings.get_boolean(settingName)) {
            this.cleanupAlwaysFloat();
          } else {
            this.restoreAlwaysFloat();
          }
          break;
        case "monitor-constraints":
          this._resizedWindows.clear();
          this.renderTree(settingName, true);
          break;
        default:
          break;
      }
    });

    this._overviewSignals = [
      Main.overview.connect("hiding", () => {
        this.fromOverview = true;
        const eventObj = {
          name: "focus-after-overview",
          callback: () => {
            const focusNodeWindow = this.tree.findNode(this.focusMetaWindow);
            this.updateStackedFocus(focusNodeWindow);
            this.updateTabbedFocus(focusNodeWindow);
            this._onPointerFocusChanged(focusNodeWindow, "overview");
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
            if (!this._wsWindowAddSrcId) {
              this._wsWindowAddSrcId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {
                this.updateMetaWorkspaceMonitor(
                  "window-added",
                  metaWindow.get_monitor(),
                  metaWindow
                );
                this._wsWindowAddSrcId = 0;
                return false;
              });
            }
          }),
        ];
        ws.workspaceSignals = workspaceSignals;
      }
    }
  }

  // TODO move this in command.js
  command(action: any) {
    const focusWindow = this.focusMetaWindow;
    // Do not check if the node window is null, some of the commands do not need the focus window
    let focusNodeWindow = this.findNodeWindow(focusWindow);
    let currentLayout;

    switch (action.name) {
      case "FloatNonPersistentToggle":
      case "FloatToggle":
      case "FloatClassToggle": {
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
          existParent.percent = 0.0;
          this.tree.resetSiblingPercent(existParent.parentNode!);
        }

        this.tree.resetSiblingPercent(existParent);
        this.renderTree("float-toggle", true);
        break;
      }
      case "Move": {
        this.unfreezeRender();
        const moveDirection = Utils.resolveDirection(action.direction)!;

        const prev = focusNodeWindow;
        const moved = this.tree.move(focusNodeWindow!, moveDirection);
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
              this._onPointerFocusChanged(focusNodeWindow, "move");
            }
          },
        });
        if (moved) {
          if (prev) prev!.parentNode!.lastTabFocus = prev.nodeValue;
          this.renderTree("move-window");
        }

        break;
      }
      case "Focus": {
        const focusDirection = Utils.resolveDirection(action.direction)!;
        focusNodeWindow = this.tree.focus(focusNodeWindow, focusDirection);
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
        break;
      }
      case "Swap": {
        if (!focusNodeWindow) return;
        this.unfreezeRender();
        const swapDirection = Utils.resolveDirection(action.direction)!;
        this.tree.swap(focusNodeWindow, swapDirection);
        const swapWin = focusNodeWindow.nodeValue as Meta.Window;
        safeRaise(swapWin);
        safeActivate(swapWin, global.display.get_current_time());
        this.updateTabbedFocus(focusNodeWindow);
        this.updateStackedFocus(focusNodeWindow);
        this._onPointerFocusChanged(focusNodeWindow, "swap");
        this.renderTree("swap", true);
        break;
      }
      case "Split": {
        if (!focusNodeWindow) return;
        currentLayout = focusNodeWindow!.parentNode!.layout;
        if (currentLayout === LAYOUT_TYPES.STACKED || currentLayout === LAYOUT_TYPES.TABBED) {
          return;
        }
        const orientation = action.orientation
          ? action.orientation.toUpperCase()
          : ORIENTATION_TYPES.NONE;
        this.tree.split(focusNodeWindow, orientation);
        this.renderTree("split");
        break;
      }
      case "LayoutToggle":
        if (!focusNodeWindow) return;
        currentLayout = focusNodeWindow!.parentNode!.layout;
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
        this._onPointerFocusChanged(focusNodeWindow, "command");
        break;
      case "FocusBorderToggle": {
        const focusBorderEnabled = this.ext.settings.get_boolean("focus-border-toggle");
        this.ext.settings.set_boolean("focus-border-toggle", !focusBorderEnabled);
        break;
      }
      case "TilingModeToggle": {
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
        break;
      }
      case "GapSize": {
        let gapIncrement = this.ext.settings.get_uint("window-gap-size-increment");
        const amount = action.amount;
        gapIncrement = gapIncrement + amount;
        if (gapIncrement < 0) gapIncrement = 0;
        if (gapIncrement > 8) gapIncrement = 8;
        this.ext.settings.set_uint("window-gap-size-increment", gapIncrement);
        break;
      }
      case "WorkspaceActiveTileToggle": {
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
        break;
      }
      case "LayoutStackedToggle":
        if (!focusNodeWindow) return;
        if (!this.ext.settings.get_boolean("stacked-tiling-mode-enabled")) return;

        if (focusNodeWindow!.parentNode!.isMonitor()) {
          this.tree.split(focusNodeWindow, ORIENTATION_TYPES.HORIZONTAL, true);
        }

        currentLayout = focusNodeWindow!.parentNode!.layout;

        if (currentLayout === LAYOUT_TYPES.STACKED) {
          focusNodeWindow!.parentNode!.layout = this.determineSplitLayout();
          this.tree.resetSiblingPercent(focusNodeWindow!.parentNode!);
        } else {
          if (currentLayout === LAYOUT_TYPES.TABBED) {
            focusNodeWindow!.parentNode!.lastTabFocus = null;
          }
          focusNodeWindow!.parentNode!.layout = LAYOUT_TYPES.STACKED;
          const lastChild = focusNodeWindow!.parentNode!.lastChild;
          if (lastChild && lastChild.nodeType === NODE_TYPES.WINDOW) {
            (lastChild.nodeValue as Meta.Window).activate(global.display.get_current_time());
          }
        }
        this.unfreezeRender();
        this.tree.attachNode = focusNodeWindow!.parentNode!;
        this.renderTree("layout-stacked-toggle");
        break;
      case "LayoutTabbedToggle":
        if (!focusNodeWindow) return;
        if (!this.ext.settings.get_boolean("tabbed-tiling-mode-enabled")) return;

        if (focusNodeWindow!.parentNode!.isMonitor()) {
          this.tree.split(focusNodeWindow, ORIENTATION_TYPES.HORIZONTAL, true);
        }

        currentLayout = focusNodeWindow!.parentNode!.layout;

        if (currentLayout === LAYOUT_TYPES.TABBED) {
          focusNodeWindow!.parentNode!.layout = this.determineSplitLayout();
          this.tree.resetSiblingPercent(focusNodeWindow!.parentNode!);
          focusNodeWindow!.parentNode!.lastTabFocus = null;
        } else {
          focusNodeWindow!.parentNode!.layout = LAYOUT_TYPES.TABBED;
          focusNodeWindow!.parentNode!.lastTabFocus = focusNodeWindow.nodeValue;
        }
        this.unfreezeRender();
        this.tree.attachNode = focusNodeWindow!.parentNode!;
        this.renderTree("layout-tabbed-toggle");
        break;
      case "CancelOperation":
        if (focusNodeWindow?.mode === WINDOW_MODES.GRAB_TILE) {
          this.cancelGrab = true;
        }
        break;
      case "PrefsOpen": {
        const existWindow = Utils.findWindowWith(this.prefsTitle);
        if (existWindow && existWindow.get_workspace()) {
          existWindow
            .get_workspace()
            .activate_with_focus(existWindow, global.display.get_current_time());
          this.moveCenter(existWindow);
        } else {
          this.ext.openPreferences();
        }
        break;
      }
      case "WindowSwapLastActive":
        if (focusNodeWindow) {
          const lastActiveWindow = global.display.get_tab_next(
            Meta.TabList.NORMAL,
            global.display.get_workspace_manager().get_active_workspace(),
            focusNodeWindow.nodeValue as Meta.Window,
            false
          );
          const lastActiveNodeWindow = this.tree.findNode(lastActiveWindow);
          this.tree.swapPairs(lastActiveNodeWindow!, focusNodeWindow);
          this._onPointerFocusChanged(focusNodeWindow, "swap");
          this.renderTree("swap-last-active");
        }
        break;
      case "SnapLayoutMove": {
        if (focusNodeWindow) {
          const workareaRect = (
            focusNodeWindow.nodeValue as Meta.Window
          ).get_work_area_current_monitor();
          const layoutAmount = action.amount;
          const layoutDirection = action.direction.toUpperCase();
          let layout = {} as Record<string, string | number | undefined>;
          let processGap = false;

          switch (layoutDirection) {
            case "LEFT":
              layout.width = layoutAmount * workareaRect.width;
              layout.height = workareaRect.height;
              layout.x = workareaRect.x;
              layout.y = workareaRect.y;
              processGap = true;
              break;
            case "RIGHT":
              layout.width = layoutAmount * workareaRect.width;
              layout.height = workareaRect.height;
              layout.x = workareaRect.x + (workareaRect.width - layout.width);
              layout.y = workareaRect.y;
              processGap = true;
              break;
            case "CENTER": {
              const metaRect = this.focusMetaWindow.get_frame_rect();
              layout.x = "center";
              layout.y = "center";
              layout = {
                x: Utils.resolveX(layout, this.focusMetaWindow),
                y: Utils.resolveY(layout, this.focusMetaWindow),
                width: metaRect.width,
                height: metaRect.height,
              };
              break;
            }
            default:
              break;
          }
          focusNodeWindow.rect = layout as any;
          if (processGap) {
            focusNodeWindow.rect = this._tilingRender.processGap(focusNodeWindow) as any;
          }
          if (!focusNodeWindow.isFloat()) {
            this.addFloatOverride(focusNodeWindow.nodeValue as Meta.Window, false);
          }
          this.move(focusNodeWindow.nodeValue as Meta.Window, focusNodeWindow.rect!);
          this.queueEvent({
            name: "snap-layout-move",
            callback: () => {
              this.renderTree("snap-layout-move");
            },
          });
          break;
        }
        break;
      }
      case "ShowTabDecorationToggle": {
        if (!focusNodeWindow) return;
        if (!this.ext.settings.get_boolean("tabbed-tiling-mode-enabled")) return;

        const showTabs = this.ext.settings.get_boolean("showtab-decoration-enabled");
        this.ext.settings.set_boolean("showtab-decoration-enabled", !showTabs);

        this.unfreezeRender();
        this.tree.attachNode = focusNodeWindow!.parentNode!;
        this.renderTree("showtab-decoration-enabled");
        break;
      }
      case "WindowResizeRight":
        this.resize(Meta.GrabOp.KEYBOARD_RESIZING_E, action.amount);
        break;

      case "WindowResizeLeft":
        this.resize(Meta.GrabOp.KEYBOARD_RESIZING_W, action.amount);
        break;

      case "WindowResizeTop":
        this.resize(Meta.GrabOp.KEYBOARD_RESIZING_N, action.amount);
        break;

      case "WindowResizeBottom":
        this.resize(Meta.GrabOp.KEYBOARD_RESIZING_S, action.amount);
        break;

      case "WindowClose":
        if (focusWindow) {
          focusWindow.delete(global.display.get_current_time());
        }
        break;

      default:
        break;
    }
  }

  resize(grabOp: Meta.GrabOp, amount: number) {
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

  disable() {
    Utils._disableDecorations();
    this._removeSignals();
    this.disabled = true;
    Logger.debug(`extension:disable`);
  }

  enable() {
    this._bindSignals();
    this.reloadTree("enable");
    Logger.debug(`extension:enable`);
  }

  findNodeWindow(metaWindow: Meta.Window) {
    return this.tree.findNode(metaWindow);
  }

  get focusMetaWindow() {
    return global.display.get_focus_window();
  }

  get tree() {
    if (!this._tree) {
      this._tree = new Tree(this);
    }
    return this._tree;
  }

  get kbd() {
    if (!this._kbd) {
      this._kbd = new Keybindings(this.ext);
      this.ext.keybindings = this._kbd;
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
    // if the monitor width is less than height, the monitor could be vertical orientation;
    const monitorRect = global.display.get_monitor_geometry(global.display.get_current_monitor());
    if (monitorRect.width < monitorRect.height) {
      return LAYOUT_TYPES.VSPLIT;
    }
    return LAYOUT_TYPES.HSPLIT;
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

  hideActorBorder(actor: AnvilWindowActor | null) {
    if (!actor) return;
    if (actor.border) {
      actor.border.hide();
    }
    if (actor.splitBorder) {
      actor.splitBorder.hide();
    }
  }

  hideWindowBorders() {
    this.tree.nodeWindows.forEach((nodeWindow) => {
      const actor = nodeWindow.windowActor;
      if (actor) {
        this.hideActorBorder(actor);
      }
      if (nodeWindow!.parentNode!.isTabbed()) {
        // Bug #268 fix: Defensive check — tab widget may have been destroyed
        // Ported from jcrussell/forge
        if (nodeWindow.tab && !(nodeWindow.tab as any)._destroyed && nodeWindow.tab.get_parent()) {
          try {
            nodeWindow.tab.remove_style_class_name("window-tabbed-tab-active");
          } catch {
            // Logger.warn(e);
          }
        }
      }
    });
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

    if (this._settingsChangedId) {
      this.ext.settings.disconnect(this._settingsChangedId);
      this._settingsChangedId = 0;
    }

    if (this._renderTreeSrcId) {
      GLib.Source.remove(this._renderTreeSrcId);
      this._renderTreeSrcId = 0;
    }

    if (this._reloadTreeSrcId) {
      GLib.Source.remove(this._reloadTreeSrcId);
      this._reloadTreeSrcId = 0;
    }

    if (this._wsWindowAddSrcId) {
      GLib.Source.remove(this._wsWindowAddSrcId);
      this._wsWindowAddSrcId = 0;
    }

    if (this._queueSourceId) {
      GLib.Source.remove(this._queueSourceId);
      this._queueSourceId = 0;
    }

    this._pointerPolicy.disable();

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

  processFloats() {
    this._tilingRender.processFloats();
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
    const metaWindow = this.focusMetaWindow;
    if (!metaWindow) return;
    const windowActor = metaWindow.get_compositor_private() as AnvilWindowActor | null;
    if (!windowActor) return;
    const nodeWindow = this.findNodeWindow(metaWindow);
    if (!nodeWindow) return;
    if (metaWindow.get_wm_class() === null) return;

    const borders: St.Bin[] = [];
    const focusBorderEnabled = this.ext.settings.get_boolean("focus-border-toggle");
    const splitBorderEnabled = this.ext.settings.get_boolean("split-border-toggle");
    const tilingModeEnabled = this.ext.settings.get_boolean("tiling-mode-enabled");
    const gap = this.calculateGaps(nodeWindow);
    const maximized = () => {
      try {
        // GNOME 49+
        return metaWindow.is_maximized() || metaWindow.is_fullscreen() || gap === 0;
      } catch {
        // pre-49 fallback
        return (
          (metaWindow as AnvilMetaWindow).get_maximized() === 3 ||
          metaWindow.is_fullscreen() ||
          gap === 0
        );
      }
    };
    const monitorCount = global.display.get_n_monitors();
    const tiledChildren = this.tree.getTiledChildren(nodeWindow!.parentNode!.childNodes);
    let inset = 3;
    const parentNode = nodeWindow!.parentNode!;

    const floatingWindow = nodeWindow.isFloat();
    const tiledBorder = windowActor.border;

    if (parentNode.isTabbed()) {
      if (nodeWindow.tab) {
        nodeWindow.tab.add_style_class_name("window-tabbed-tab-active");
      }
    }

    // Feature #262: Skip focus border if single window and setting enabled
    // Ported from jcrussell/forge
    const focusBorderHiddenOnSingle = this.ext.settings.get_boolean(
      "focus-border-hidden-on-single"
    );
    const monitorNode = this.tree.findParent(nodeWindow!, NODE_TYPES.MONITOR);
    const tiledOnMonitor = monitorNode
      ? monitorNode
          .getNodeByMode(WINDOW_MODES.TILE)
          .filter((t: import("./tree.js").Node<any>) => t.isWindow() && !t.nodeValue.minimized)
      : [];
    const isSingleWindow = tiledOnMonitor.length === 1 && monitorCount === 1;
    const skipBorderForSingle = focusBorderHiddenOnSingle && isSingleWindow && !floatingWindow;

    if (tiledBorder && focusBorderEnabled && !skipBorderForSingle) {
      if (
        !maximized() ||
        (gap === 0 && tiledChildren.length === 1 && monitorCount > 1) ||
        (gap === 0 && tiledChildren.length > 1)
      ) {
        if (tilingModeEnabled) {
          if (parentNode.isStacked()) {
            if (!floatingWindow) {
              tiledBorder.set_style_class_name("window-stacked-border");
            } else {
              tiledBorder.set_style_class_name("window-floated-border");
            }
          } else if (parentNode.isTabbed()) {
            if (!floatingWindow) {
              tiledBorder.set_style_class_name("window-tabbed-border");
              if (nodeWindow.backgroundTab) {
                tiledBorder.add_style_class_name("window-tabbed-bg");
              }
            } else {
              tiledBorder.set_style_class_name("window-floated-border");
            }
          } else {
            if (!floatingWindow) {
              tiledBorder.set_style_class_name("window-tiled-border");
            } else {
              tiledBorder.set_style_class_name("window-floated-border");
            }
          }
        } else {
          tiledBorder.set_style_class_name("window-floated-border");
        }
        borders.push(tiledBorder);
      }
    }

    if (
      gap === 0 ||
      (() => {
        try {
          // GNOME 49+
          return metaWindow.is_maximized();
        } catch {
          // pre-49 fallback
          return (
            (metaWindow as AnvilMetaWindow).get_maximized() === 1 ||
            (metaWindow as AnvilMetaWindow).get_maximized() === 2
          );
        }
      })()
    ) {
      inset = 0;
    }

    // handle the split border
    // It should only show when V or H-Split and with single child CONs
    if (
      splitBorderEnabled &&
      focusBorderEnabled &&
      tilingModeEnabled &&
      !nodeWindow.isFloat() &&
      !maximized &&
      parentNode.childNodes.length === 1 &&
      (parentNode.isCon() || parentNode.isMonitor()) &&
      !(parentNode.isTabbed() || parentNode.isStacked())
    ) {
      if (!windowActor.splitBorder) {
        const splitBorder = new St.Bin({ style_class: "window-split-border" });
        global.window_group.add_child(splitBorder);
        windowActor.splitBorder = splitBorder;
      }

      const splitBorder = windowActor.splitBorder;
      splitBorder.remove_style_class_name("window-split-vertical");
      splitBorder.remove_style_class_name("window-split-horizontal");

      if (parentNode.isVSplit()) {
        splitBorder.add_style_class_name("window-split-vertical");
      } else if (parentNode.isHSplit()) {
        splitBorder.add_style_class_name("window-split-horizontal");
      }
      borders.push(splitBorder);
    }

    const rect = metaWindow.get_frame_rect();

    borders.forEach((border) => {
      border.set_size(rect.width + inset * 2, rect.height + inset * 2);
      border.set_position(rect.x - inset, rect.y - inset);
      if (metaWindow.appears_focused && !metaWindow.minimized) {
        border.show();
      }
      if (global.window_group && global.window_group.contains(border)) {
        // TODO - sort the borders with split border being on top
        global.window_group.remove_child(border);
        // Add the border just above the focused window
        global.window_group.insert_child_above(border, metaWindow.get_compositor_private());
      }
    });
  }

  updateBorderLayout() {
    this.hideWindowBorders();
    this.showWindowBorders();
  }

  calculateGaps(node: Node<any>) {
    return this._tilingRender.calculateGaps(node);
  }

  /**
   * Track meta/mutter windows and append them to the tree.
   * Windows can be attached on any of the following Node Types:
   * MONITOR, CONTAINER
   *
   */
  trackWindow(_display: Meta.Display, metaWindow: Meta.Window) {
    const autoSplit = this.ext.settings?.get_boolean("auto-split-enabled");
    const focusMetaWindow = this.focusMetaWindow;
    if (autoSplit && focusMetaWindow) {
      const currentFocusNode = this.tree.findNode(focusMetaWindow);
      if (currentFocusNode) {
        const currentParentFocusNode = currentFocusNode!.parentNode!;
        const layout = currentParentFocusNode.layout;
        if (layout === LAYOUT_TYPES.HSPLIT || layout === LAYOUT_TYPES.VSPLIT) {
          const frameRect = focusMetaWindow.get_frame_rect();
          const splitHorizontal = frameRect.width > frameRect.height;
          const orientation = splitHorizontal ? "horizontal" : "vertical";
          this.command({ name: "Split", orientation: orientation });
        }
      }
    }
    // Make window types configurable
    if (this._validWindow(metaWindow)) {
      const existNodeWindow = this.tree.findNode(metaWindow);
      Logger.debug(`Meta Window ${metaWindow.get_title()} ${metaWindow.get_window_type()}`);
      if (!existNodeWindow) {
        let attachTarget;

        const activeMonitor = global.display.get_current_monitor();
        const activeWorkspace = global.display.get_workspace_manager().get_active_workspace_index();
        const metaMonWs = `mo${activeMonitor}ws${activeWorkspace}`;

        // Check if the active monitor / workspace has windows
        const metaMonWsNode = this.tree.findNode(metaMonWs);
        if (!metaMonWsNode) {
          // Reload the tree as a last resort
          this.reloadTree("no-meta-monws");
          return;
        }

        const windowNodes = metaMonWsNode.getNodeByType(NODE_TYPES.WINDOW);
        const hasWindows = windowNodes.length > 0;

        attachTarget = this.tree.attachNode;
        attachTarget = attachTarget ? this.tree.findNode(attachTarget.nodeValue) : null;

        if (!attachTarget) {
          attachTarget = metaMonWsNode;
        } else {
          if (hasWindows) {
            if (attachTarget && metaMonWsNode.contains(attachTarget)) {
              // Use the attach target
            } else {
              // Find the first window
              attachTarget = windowNodes[0];
            }
          } else {
            attachTarget = metaMonWsNode;
          }
        }

        const nodeWindow = this.tree.createNode(
          attachTarget.nodeValue,
          NODE_TYPES.WINDOW,
          metaWindow,
          WINDOW_MODES.FLOAT
        );

        const anvilMetaWin = metaWindow as AnvilMetaWindow;
        anvilMetaWin.firstRender = true;

        const windowActor = metaWindow.get_compositor_private() as AnvilWindowActor | null;

        if (!anvilMetaWin.windowSignals) {
          const windowSignals = [
            metaWindow.connect("position-changed", (_metaWindow: Meta.Window) => {
              const from = "position-changed";
              this.updateMetaPositionSize(_metaWindow, from);
            }),
            metaWindow.connect("size-changed", (_metaWindow: Meta.Window) => {
              const from = "size-changed";
              this.updateMetaPositionSize(_metaWindow, from);
            }),
            metaWindow.connect("unmanaged", (_metaWindow: Meta.Window) => {
              this.hideActorBorder(windowActor);
            }),
            metaWindow.connect("focus", (_metaWindowFocus: Meta.Window) => {
              this.queueEvent({
                name: "focus-update",
                callback: () => {
                  this.unfreezeRender();
                  this.updateBorderLayout();
                  this.updateDecorationLayout();
                  this.updateStackedFocus(undefined);
                  this.updateTabbedFocus(undefined);
                  const focusNodeWindow = this.tree.findNode(this.focusMetaWindow);
                  this._onPointerFocusChanged(focusNodeWindow, "signal");
                },
              });
              const focusNodeWindow = this.tree.findNode(this.focusMetaWindow);
              if (focusNodeWindow) {
                // handle the attach node
                this.tree.attachNode = focusNodeWindow._parent;
                if (this.floatingWindow(focusNodeWindow)) {
                  this.queueEvent({
                    name: "raise-float",
                    callback: () => {
                      this.renderTree("raise-float-queue");
                    },
                  });
                }
                this.tree.attachNode = focusNodeWindow;
              }
              this.renderTree("focus", true);
            }),
            metaWindow.connect("workspace-changed", (_metaWindow: Meta.Window) => {
              this.updateMetaWorkspaceMonitor("metawindow-workspace-changed", null, _metaWindow);
              this.trackCurrentMonWs();
            }),
          ];
          anvilMetaWin.windowSignals = windowSignals;
        }

        if (windowActor && !windowActor.actorSignals) {
          const actorSignals = [windowActor.connect("destroy", this.windowDestroy.bind(this))];
          windowActor.actorSignals = actorSignals;
        }

        if (windowActor && !windowActor.border) {
          const border = new St.Bin({ style_class: "window-tiled-border" });

          if (global.window_group) global.window_group.add_child(border);

          windowActor.border = border;
          border.show();
        }

        this.postProcessWindow(nodeWindow as Node<any> | null);
        this.queueEvent(
          {
            name: "window-create-queue",
            callback: () => {
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
              this.renderTree("window-create", true);
            },
          },
          200
        );

        if (nodeWindow?.parentNode) {
          const childNodes = this.tree.getTiledChildren(nodeWindow!.parentNode!.childNodes);
          childNodes.forEach((n) => {
            n.percent = 0.0;
          });
        }
      }
    }
  }

  postProcessWindow(nodeWindow: Node<any> | null) {
    if (!nodeWindow) return;
    const metaWindow = nodeWindow.nodeValue as Meta.Window;
    if (metaWindow) {
      if (metaWindow.get_title() === this.prefsTitle) {
        metaWindow
          .get_workspace()
          .activate_with_focus(metaWindow, global.display.get_current_time());
        this.moveCenter(metaWindow);
      } else {
        this._onPointerFocusChanged(nodeWindow, "window-create");
      }
    }
  }

  updateStackedFocus(focusNodeWindow: Node<any> | undefined | null) {
    if (!focusNodeWindow) return;
    const parentNode = focusNodeWindow!.parentNode!;
    if (parentNode.layout === LAYOUT_TYPES.STACKED && !this._freezeRender) {
      parentNode.appendChild(focusNodeWindow);
      parentNode.childNodes
        .filter((child: Node<any>) => child.isWindow())
        .forEach((child: Node<any>) => safeRaise(child.nodeValue as Meta.Window));
      this.queueEvent({
        name: "render-focus-stack",
        callback: () => {
          this.renderTree("focus-stacked");
        },
      });
    }
  }

  updateTabbedFocus(focusNodeWindow: Node<any> | null | undefined) {
    if (!focusNodeWindow) return;
    if (focusNodeWindow!.parentNode!.layout === LAYOUT_TYPES.TABBED && !this._freezeRender) {
      safeRaise(focusNodeWindow.nodeValue as Meta.Window);
    }
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

  enforceUltrawideSize(node: Node<any>, rect: RectLike): RectLike {
    return this._tilingRender.enforceUltrawideSize(node, rect);
  }

  _getMonitorConnector(monitorIndex: number): string | null {
    return this._tilingRender.getMonitorConnector(monitorIndex);
  }

  _getMonitorConstraints(monitorIndex: number) {
    return this._tilingRender.getMonitorConstraints(monitorIndex);
  }

  trackCurrentWindows() {
    this.tree.attachNode = null;
    const windowsAll = this.windowsAllWorkspaces;
    for (let i = 0; i < windowsAll.length; i++) {
      const metaWindow = windowsAll[i];
      this.trackWindow(global.display, metaWindow);
      // This updates and handles dynamic workspaces
      this.updateMetaWorkspaceMonitor(
        "track-current-windows",
        metaWindow.get_monitor(),
        metaWindow
      );
    }
    this.updateDecorationLayout();
  }

  _validWindow(metaWindow: Meta.Window) {
    // Bug #309, #322 fix: Filter out XWayland Video Bridge and ddterm windows
    // Ported from jcrussell/forge
    const wmClass = metaWindow.get_wm_class();
    if (wmClass && wmClass.toLowerCase().includes("xwaylandvideobridge")) {
      return false;
    }
    if (wmClass && wmClass.toLowerCase().includes("ddterm")) {
      return false;
    }

    // Bug #351 fix: Filter out invalid window types (browser popups, tooltips, etc.)
    // Ported from jcrussell/forge
    const windowType = metaWindow.get_window_type();
    if (INVALID_WINDOW_TYPES.has(windowType)) return false;
    return (
      windowType === Meta.WindowType.NORMAL ||
      windowType === Meta.WindowType.MODAL_DIALOG ||
      windowType === Meta.WindowType.DIALOG
    );
  }

  windowDestroy(actor: AnvilWindowActor) {
    // Release any resources on the window
    const border = actor.border;
    if (border) {
      if (global.window_group) {
        global.window_group.remove_child(border);
        border.hide();
      }
    }

    const splitBorder = actor.splitBorder;
    if (splitBorder) {
      if (global.window_group) {
        global.window_group.remove_child(splitBorder);
        splitBorder.hide();
      }
    }

    const nodeWindow = this.tree.findNodeByActor(actor) as unknown as
      | import("./tree.js").Node<any>
      | null;

    // Bug #258 fix: Check if this window has focus before removing
    // Ported from jcrussell/forge
    const metaWindow = nodeWindow?.nodeValue as Meta.Window | undefined;
    const hadFocus = !!metaWindow && this.focusMetaWindow === metaWindow;

    if (nodeWindow?.isWindow()) {
      this.tree.removeNode(nodeWindow);
      this.renderTree("window-destroy-quick", true);
      this.removeFloatOverride(nodeWindow.nodeValue as Meta.Window, true);

      // Bug #258 fix: Restore focus if this window had it and tiling is enabled
      // Ported from jcrussell/forge
      if (hadFocus && this.ext.settings.get_boolean("tiling-mode-enabled")) {
        this._restoreFocusAfterWindowClosed(nodeWindow);
      }
    }

    // find the next attachNode here
    const focusNodeWindow = this.tree.findNode(this.focusMetaWindow);
    if (focusNodeWindow) {
      this.tree.attachNode = focusNodeWindow!.parentNode!;
    }

    this.queueEvent({
      name: "window-destroy",
      callback: () => {
        this.renderTree("window-destroy", true);
      },
    });
  }

  /**
   * Restore focus to another window after one is closed (#258)
   * Ported from jcrussell/forge
   */
  _restoreFocusAfterWindowClosed(closedNodeWindow: import("./tree.js").Node<any>) {
    if (!closedNodeWindow || !closedNodeWindow.parentNode) return;

    // Try to find a sibling window in the same container
    const parent = closedNodeWindow.parentNode;
    const siblings = parent.childNodes.filter(
      (node: import("./tree.js").Node<any>) =>
        node.isWindow() && node !== closedNodeWindow && node.nodeValue
    );

    if (siblings.length > 0) {
      // Focus the first available sibling
      const targetWindow = siblings[0].nodeValue as Meta.Window;
      if (targetWindow && !targetWindow.minimized) {
        safeRaise(targetWindow);
        safeFocus(targetWindow, global.display.get_current_time());
        safeActivate(targetWindow, global.display.get_current_time());
        return;
      }
    }

    // If no siblings, try to find any window on the current workspace
    const wsManager = global.display.get_workspace_manager();
    const currentWs = wsManager.get_active_workspace();
    const workspaceWindows = currentWs
      .list_windows()
      .filter((w: Meta.Window) => !w.minimized && w.get_window_type() === Meta.WindowType.NORMAL);

    if (workspaceWindows.length > 0) {
      safeRaise(workspaceWindows[0]);
      safeFocus(workspaceWindows[0], global.display.get_current_time());
      safeActivate(workspaceWindows[0], global.display.get_current_time());
    }
  }

  /**
   * Handles any workspace/monitor update for the Meta.Window.
   */
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
            this.tree.redistributeSiblingPercent(existParent);

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

  /** @deprecated Use pointerPolicy.onFocusChanged — kept for test compatibility */
  movePointerWith(nodeWindow: Node<any> | null) {
    this._onPointerFocusChanged(nodeWindow, "command");
  }

  getPointer(): [number, number] {
    return this._pointerPolicy.getPointer();
  }

  /** @deprecated Use pointerPolicy.onWorkspaceSettled */
  refocusPointerMonitor() {
    this._pointerPolicy.onWorkspaceSettled();
  }

  minimizedWindow(node: Node<any> | null) {
    if (!node) return false;
    return node._type === NODE_TYPES.WINDOW && node._data && (node._data as Meta.Window).minimized;
  }

  swapWindowsUnderPointer(focusNodeWindow: Node<any>) {
    if (this.cancelGrab) {
      return;
    }
    const nodeWinAtPointer = this.findNodeWindowAtPointer(focusNodeWindow);
    if (nodeWinAtPointer) this.tree.swapPairs(focusNodeWindow, nodeWinAtPointer);
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
      const currPointer = this.getPointer();
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
        this.tree.resetSiblingPercent(containerNode);
        this.tree.resetSiblingPercent(previousParent);

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
          this.tree.split(childNode as Node<any>, orientation);
          containerNode!.insertBefore(childNode!.parentNode!, referenceNode);
        } else if (isCenter && centerLayout == "SWAP") {
          this.tree.swapPairs(referenceNode!, focusNodeWindow);
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

  canMovePointerInsideNodeWindow(nodeWindow: Node<any> | null) {
    return this._pointerPolicy.canWarpToNode(nodeWindow);
  }

  getPointerPositionInside(nodeWindow: Node<any> | null) {
    return this._pointerPolicy.getPointerPositionInside(nodeWindow);
  }

  storePointerLastPosition(nodeWindow: Node<any> | null) {
    this._pointerPolicy.storePointerLastPosition(nodeWindow);
  }

  findNodeWindowAtPointer(focusNodeWindow: Node<any>) {
    const pointerCoord = global.get_pointer() as unknown as [number, number];

    const nodeWinAtPointer = this._findNodeWindowAtPointer(
      focusNodeWindow.nodeValue as Meta.Window,
      pointerCoord
    );
    return nodeWinAtPointer;
  }

  _focusWindowUnderPointer(): boolean {
    return this._pointerPolicy.runHoverFocusPoll();
  }

  _findNodeWindowAtPointer(metaWindow: Meta.Window, pointer: [number, number]) {
    if (!metaWindow) return undefined;

    const sortedWindows = this.sortedWindows;

    if (!sortedWindows) {
      Logger.warn("No sorted windows");
      return;
    }

    for (let i = 0, n = sortedWindows.length; i < n; i++) {
      const w = sortedWindows[i];
      const metaRect = w.get_frame_rect();
      const atPointer = Utils.rectContainsPoint(metaRect, pointer);
      if (atPointer) return this.tree.getNodeByValue(w);
    }

    return null;
  }

  _handleGrabOpBegin(_display: Meta.Display, _metaWindow: Meta.Window, grabOp: Meta.GrabOp) {
    this.grabOp = grabOp;
    this.trackCurrentMonWs();
    const focusMetaWindow = this.focusMetaWindow;

    Logger.debug(
      `_handleGrabOpBegin: grabOp=${grabOp} metaWindow=${
        _metaWindow?.get_title() || "none"
      } focusMetaWindow=${focusMetaWindow?.get_title() || "none"}`
    );

    if (focusMetaWindow) {
      const focusNodeWindow = this.findNodeWindow(focusMetaWindow);
      if (!focusNodeWindow) return;

      const frameRect = focusMetaWindow.get_frame_rect();
      const gaps = this.calculateGaps(focusNodeWindow);

      focusNodeWindow.grabMode = Utils.grabMode(grabOp);
      if (
        focusNodeWindow.grabMode === GRAB_TYPES.MOVING &&
        focusNodeWindow.mode === WINDOW_MODES.TILE
      ) {
        this.freezeRender();
        focusNodeWindow.mode = WINDOW_MODES.GRAB_TILE;
      }

      focusNodeWindow.initGrabOp = grabOp;
      // Only set initRect if not already tracking a resize (preserves original during key repeat)
      if (!focusNodeWindow.initRect) {
        focusNodeWindow.initRect = Utils.removeGapOnRect(frameRect, gaps);
      }

      // Bug #433 fix: Track the window being dragged for preview hint cleanup
      // Ported from jcrussell/forge
      this._draggedNodeWindow = focusNodeWindow;

      // Start live-resize polling loop for resize grabs
      if (focusNodeWindow.grabMode === GRAB_TYPES.RESIZING) {
        this._startLiveResizeLoop(focusNodeWindow);
      }
    }
  }

  _startLiveResizeLoop(focusNodeWindow: Node<any>) {
    this._stopLiveResizeLoop();

    // Cache gaps once — they don't change during a resize
    const gaps = this.calculateGaps(focusNodeWindow);
    let lastWidth = focusNodeWindow.initRect?.width;
    let lastHeight = focusNodeWindow.initRect?.height;

    this._liveResizeSrcId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16, () => {
      const metaWindow = focusNodeWindow.nodeValue as Meta.Window;
      if (!metaWindow || !focusNodeWindow.grabMode) {
        this._liveResizeSrcId = 0;
        return GLib.SOURCE_REMOVE;
      }

      const frameRect = metaWindow.get_frame_rect();
      const currentRect = Utils.removeGapOnRect(frameRect, gaps);

      // Skip if size hasn't changed — also prevents double-processing on X11
      // where size-changed signals fire alongside this loop
      if (currentRect.width === lastWidth && currentRect.height === lastHeight) {
        return GLib.SOURCE_CONTINUE;
      }
      lastWidth = currentRect.width;
      lastHeight = currentRect.height;

      this._handleResizing(focusNodeWindow);

      // Update initRect so next tick delta is relative to current frame,
      // not the grab start (prevents percent accumulation)
      focusNodeWindow.initRect = currentRect;

      this._liveResizeNeighbors(focusNodeWindow);

      return GLib.SOURCE_CONTINUE;
    });
  }

  _stopLiveResizeLoop() {
    if (this._liveResizeSrcId) {
      GLib.Source.remove(this._liveResizeSrcId);
      this._liveResizeSrcId = 0;
    }
  }

  _handleGrabOpEnd(_display: Meta.Display, _metaWindow: Meta.Window, grabOp: Meta.GrabOp) {
    this._stopLiveResizeLoop();
    this.unfreezeRender();
    const focusMetaWindow = this.focusMetaWindow;

    Logger.debug(
      `_handleGrabOpEnd: grabOp=${grabOp} metaWindow=${
        _metaWindow?.get_title() || "none"
      } focusMetaWindow=${focusMetaWindow?.get_title() || "none"}`
    );
    if (focusMetaWindow) {
      const focusNodeWindow = this.findNodeWindow(focusMetaWindow);
      if (focusNodeWindow) {
        Logger.debug(
          `_handleGrabOpEnd: percent=${focusNodeWindow.percent} initRect=${JSON.stringify(
            focusNodeWindow.initRect
          )} grabMode=${focusNodeWindow.grabMode}`
        );
      }
    }
    if (!focusMetaWindow) return;
    const focusNodeWindow = this.findNodeWindow(focusMetaWindow);

    if (focusNodeWindow && !this.cancelGrab) {
      // WINDOW_BASE is when grabbing the window decoration
      // COMPOSITOR is when something like Overview requesting a grab, especially when Super is pressed.
      if (grabOp === Meta.GrabOp.WINDOW_BASE || grabOp === Meta.GrabOp.MOVING_UNCONSTRAINED) {
        if (this.allowDragDropTile()) {
          this.moveWindowToPointer(focusNodeWindow);
        }
      }
    }

    // Bug #433 fix: Clean up preview hint from the originally dragged window
    // This handles cases where focus changed during drag (e.g., crossing monitors)
    // Ported from jcrussell/forge
    if (this._draggedNodeWindow && this._draggedNodeWindow !== focusNodeWindow) {
      this._grabCleanup(this._draggedNodeWindow);
    }
    this._draggedNodeWindow = null;

    this._grabCleanup(focusNodeWindow);

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
      this.renderTree("grab-op-end");
    }

    // Track manually resized windows for per-monitor resize exemption.
    // Must run AFTER renderTree so the first resize is still clamped by
    // enforceUltrawideSize; subsequent renders will see the window in
    // _resizedWindows and skip clamping.
    // Use a timeout (instead of idle_add) to ensure all async renders
    // triggered by the resize (e.g., from size-changed signals) complete
    // before the counter is incremented. This prevents a race where a
    // late render sees the incremented counter and undoes the clamping.
    // Use _metaWindow (the window that was actually resized) instead of
    // focusMetaWindow to avoid race conditions where focus changed during
    // async resize operations.
    if (_metaWindow && Utils.grabMode(grabOp) === GRAB_TYPES.RESIZING) {
      const monitorIndex = _metaWindow.get_monitor();
      const constraints = this._tilingRender.getMonitorConstraints(monitorIndex);
      if (constraints?.resizeExempt) {
        const winId = _metaWindow.get_id();
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
          const currentCount = this._resizedWindows.get(winId) || 0;
          this._resizedWindows.set(winId, currentCount + 1);
          return GLib.SOURCE_REMOVE;
        });
      }
    }

    this.updateStackedFocus(focusNodeWindow);
    this.updateTabbedFocus(focusNodeWindow);
    this.nodeWinAtPointer = null;

    // Phase C fix: Clear stale grabOp to prevent suppression of tabbed focus updates
    // Credit: mayconrcmello/forge PR #526
    this.grabOp = Meta.GrabOp.NONE;
  }

  _grabCleanup(focusNodeWindow: Node<any> | null) {
    this.cancelGrab = false;
    this._lastResizePair = null;
    if (!focusNodeWindow) return;
    focusNodeWindow.initRect = null;
    focusNodeWindow.grabMode = null;
    focusNodeWindow.initGrabOp = null;

    // Bug #175 fix: Ensure preview hint is always cleaned up (add try-catch)
    // Ported from jcrussell/forge
    if (focusNodeWindow.previewHint) {
      try {
        focusNodeWindow.previewHint.hide();
        if (global.window_group && global.window_group.contains(focusNodeWindow.previewHint)) {
          global.window_group.remove_child(focusNodeWindow.previewHint);
        }
        focusNodeWindow.previewHint.destroy();
      } catch (e) {
        Logger.warn(`Failed to cleanup preview hint: ${e}`);
      } finally {
        focusNodeWindow.previewHint = null;
      }
    }

    if (focusNodeWindow.mode === WINDOW_MODES.GRAB_TILE) {
      focusNodeWindow.mode = WINDOW_MODES.TILE;
    }
  }

  allowDragDropTile() {
    return this.kbd.allowDragDropTile();
  }

  _handleResizing(focusNodeWindow: Node<any> | null) {
    if (!focusNodeWindow || focusNodeWindow.isFloat()) {
      return;
    }
    const grabOps = Utils.decomposeGrabOp(this.grabOp);
    for (const grabOp of grabOps) {
      const initGrabOp = focusNodeWindow.initGrabOp;
      const direction = Utils.directionFromGrab(grabOp);
      const orientation = Utils.orientationFromGrab(grabOp);
      let parentNodeForFocus = focusNodeWindow!.parentNode!;
      const position = Utils.positionFromGrabOp(grabOp);
      // normalize the rect without gaps
      const focusMeta = this.focusMetaWindow;
      if (!focusMeta) return;
      const frameRect = focusMeta.get_frame_rect();
      const gaps = this.calculateGaps(focusNodeWindow);
      const currentRect = Utils.removeGapOnRect(frameRect, gaps);
      let firstRect;
      let secondRect;
      let parentRect;
      let resizePairForWindow;

      if (initGrabOp === Meta.GrabOp.KEYBOARD_RESIZING_UNKNOWN) {
        Logger.debug(`_handleResizing: KEYBOARD_RESIZING_UNKNOWN — return early`);
        return;
      } else {
        resizePairForWindow = this.tree.nextVisible(focusNodeWindow, direction!);
        if (!resizePairForWindow) {
          // Edge case: window at the edge has no sibling in the resize direction
          // (e.g. resizing the right edge of the rightmost window).
          // Try the opposite direction to find the resize pair.
          if (direction !== undefined) {
            const oppositeDir = Utils.oppositeDirectionOf(direction) as Meta.MotionDirection;
            resizePairForWindow = this.tree.nextVisible(focusNodeWindow, oppositeDir);
          }
        }
      }

      this._lastResizePair = resizePairForWindow || null;

      const sameParent = resizePairForWindow
        ? resizePairForWindow.parentNode === focusNodeWindow!.parentNode!
        : false;

      Logger.debug(
        `_handleResizing: title=${focusMeta.get_title()} initRect=${JSON.stringify(
          focusNodeWindow.initRect
        )} currentRect=${JSON.stringify(
          currentRect
        )} direction=${direction} orientation=${orientation} sameParent=${sameParent} resizePair=${
          resizePairForWindow
            ? resizePairForWindow.isWindow()
              ? (resizePairForWindow.nodeValue as Meta.Window)?.get_title()
              : resizePairForWindow.nodeType
            : "none"
        }`
      );

      if (orientation === ORIENTATION_TYPES.HORIZONTAL) {
        if (sameParent) {
          // use the window or con pairs
          if (this.tree.getTiledChildren(parentNodeForFocus.childNodes).length <= 1) {
            return;
          }

          firstRect = focusNodeWindow.initRect;
          if (resizePairForWindow) {
            if (
              !this.floatingWindow(resizePairForWindow) &&
              !this.minimizedWindow(resizePairForWindow)
            ) {
              secondRect = resizePairForWindow.rect;
            } else {
              // TODO try to get the next resize pair?
            }
          }

          if (!firstRect || !secondRect) {
            return;
          }

          parentRect = parentNodeForFocus.rect!;
          const changePx = currentRect.width - firstRect!.width;
          const firstPercent = (firstRect!.width + changePx) / parentRect.width;
          const secondPercent = (secondRect!.width - changePx) / parentRect.width;
          focusNodeWindow.percent = firstPercent;
          resizePairForWindow!.percent = secondPercent;
        } else {
          // use the parent pairs (con to another con or window)
          if (resizePairForWindow && resizePairForWindow.parentNode) {
            if (this.tree.getTiledChildren(resizePairForWindow.parentNode.childNodes).length <= 1) {
              return;
            }
            const firstWindowRect = focusNodeWindow.initRect;
            let index: number | null = resizePairForWindow.index;
            if (position === POSITION.BEFORE) {
              // Find the opposite node
              index = index! + 1;
            } else {
              index = index! - 1;
            }
            const childNodes = resizePairForWindow.parentNode.childNodes;
            if (index === null || index < 0 || index >= childNodes.length) return;
            parentNodeForFocus = childNodes[index!];
            firstRect = parentNodeForFocus.rect;
            secondRect = resizePairForWindow.rect;
            if (!firstRect || !secondRect) {
              return;
            }

            parentRect = parentNodeForFocus.parentNode!.rect!;
            const changePx = currentRect.width - firstWindowRect!.width;
            const firstPercent = (firstRect.width + changePx) / parentRect.width;
            const secondPercent = (secondRect.width - changePx) / parentRect.width;
            parentNodeForFocus.percent = firstPercent;
            resizePairForWindow.percent = secondPercent;
            Logger.debug(
              `_handleResizing HORIZONTAL diffParent: changePx=${changePx} firstPercent=${firstPercent} secondPercent=${secondPercent} parentW=${parentRect.width}`
            );
          }
        }
      } else if (orientation === ORIENTATION_TYPES.VERTICAL) {
        if (sameParent) {
          // use the window or con pairs
          if (this.tree.getTiledChildren(parentNodeForFocus.childNodes).length <= 1) {
            return;
          }
          firstRect = focusNodeWindow.initRect;
          if (resizePairForWindow) {
            if (
              !this.floatingWindow(resizePairForWindow) &&
              !this.minimizedWindow(resizePairForWindow)
            ) {
              secondRect = resizePairForWindow.rect;
            } else {
              // TODO try to get the next resize pair?
            }
          }
          if (!firstRect || !secondRect) {
            return;
          }
          parentRect = parentNodeForFocus.rect!;
          const changePx = currentRect.height - firstRect!.height;
          const firstPercent = (firstRect!.height + changePx) / parentRect.height;
          const secondPercent = (secondRect!.height - changePx) / parentRect.height;
          focusNodeWindow.percent = firstPercent;
          resizePairForWindow!.percent = secondPercent;
          Logger.debug(
            `_handleResizing VERTICAL sameParent: changePx=${changePx} firstPercent=${firstPercent} secondPercent=${secondPercent} parentH=${parentRect.height}`
          );
        } else {
          // use the parent pairs (con to another con or window)
          if (resizePairForWindow && resizePairForWindow.parentNode) {
            if (this.tree.getTiledChildren(resizePairForWindow.parentNode.childNodes).length <= 1) {
              return;
            }
            const firstWindowRect = focusNodeWindow.initRect;
            let index: number | null = resizePairForWindow.index;
            if (position === POSITION.BEFORE) {
              // Find the opposite node
              index = index! + 1;
            } else {
              index = index! - 1;
            }
            const childNodes = resizePairForWindow.parentNode.childNodes;
            if (index === null || index < 0 || index >= childNodes.length) return;
            parentNodeForFocus = childNodes[index!];
            firstRect = parentNodeForFocus.rect;
            secondRect = resizePairForWindow.rect;
            if (!firstRect || !secondRect) {
              return;
            }

            parentRect = parentNodeForFocus.parentNode!.rect!;
            const changePx = currentRect.height - firstWindowRect!.height;
            const firstPercent = (firstRect.height + changePx) / parentRect.height;
            const secondPercent = (secondRect.height - changePx) / parentRect.height;
            parentNodeForFocus.percent = firstPercent;
            resizePairForWindow.percent = secondPercent;
            Logger.debug(
              `_handleResizing VERTICAL diffParent: changePx=${changePx} firstPercent=${firstPercent} secondPercent=${secondPercent} parentH=${parentRect.height}`
            );
          }
        }
      }
    }

    // Reposition focused window to prevent "traveling" during resize
    // Ported from jcrussell/forge
    this._repositionDuringResize(focusNodeWindow);
  }

  /**
   * Repositions the focused window during resize to prevent "traveling".
   * Uses initRect as reference to calculate correct position based on which
   * edge is being dragged.
   * Ported from jcrussell/forge
   */
  _repositionDuringResize(focusNodeWindow: Node<any> | null) {
    if (!focusNodeWindow || !focusNodeWindow.initRect) {
      Logger.debug(`_repositionDuringResize: skip — no focusNodeWindow or no initRect`);
      return;
    }

    const metaWindow = focusNodeWindow.nodeValue as Meta.Window;
    if (!metaWindow) return;

    const frameRect = metaWindow.get_frame_rect();
    const initRect = focusNodeWindow.initRect;
    const gaps = this.calculateGaps(focusNodeWindow);

    const grabOps = Utils.decomposeGrabOp(this.grabOp);
    let targetX = frameRect.x;
    let targetY = frameRect.y;

    for (const grabOp of grabOps) {
      const position = Utils.positionFromGrabOp(grabOp);
      const orientation = Utils.orientationFromGrab(grabOp);

      if (orientation === ORIENTATION_TYPES.HORIZONTAL) {
        if (position === POSITION.AFTER) {
          // Resizing right edge - x should stay fixed at initRect.x + gaps
          targetX = initRect.x + gaps;
        } else if (position === POSITION.BEFORE) {
          // Resizing left edge - x should adjust based on width change
          targetX = initRect.x + gaps - (frameRect.width - (initRect.width - gaps * 2));
        }
      } else if (orientation === ORIENTATION_TYPES.VERTICAL) {
        if (position === POSITION.AFTER) {
          // Resizing bottom edge - y should stay fixed at initRect.y + gaps
          targetY = initRect.y + gaps;
        } else if (position === POSITION.BEFORE) {
          // Resizing top edge - y should adjust based on height change
          targetY = initRect.y + gaps - (frameRect.height - (initRect.height - gaps * 2));
        }
      }
    }

    // Only reposition if position actually differs
    if (targetX !== frameRect.x || targetY !== frameRect.y) {
      metaWindow.move_frame(true, targetX, targetY);
    }
  }

  /**
   * During a mouse-drag resize, immediately re-layout all tiled windows
   * EXCEPT the one currently being dragged (GNOME owns its position).
   * Bypasses this.move() which is blocked by metaWindow.grabbed on Wayland.
   */
  _liveResizeNeighbors(draggingNodeWindow: Node<any>) {
    const draggingMetaWin = draggingNodeWindow.nodeValue as Meta.Window;

    // Only reprocess the affected container subtree, not the entire tree.
    // When the resize pair lives in a different parent (diffParent case),
    // we must process the common ancestor so that both subtrees get
    // updated rects.
    let parentNode = draggingNodeWindow.parentNode;
    if (parentNode && this._lastResizePair) {
      const resizePairParent = this._lastResizePair.parentNode;
      if (resizePairParent && resizePairParent !== parentNode) {
        const ancestors = new Set<Node<any>>();
        let ancestor: Node<any> | null = draggingNodeWindow.parentNode;
        while (ancestor) {
          ancestors.add(ancestor);
          ancestor = ancestor.parentNode;
        }
        ancestor = this._lastResizePair.parentNode;
        while (ancestor) {
          if (ancestors.has(ancestor)) {
            parentNode = ancestor;
            break;
          }
          ancestor = ancestor.parentNode;
        }
      }
    }
    if (parentNode) {
      this._tilingRender.processNode(parentNode);
    }

    // Move all tiled windows except the one being dragged
    const tiledWindows = this.tree.getNodeByType(NODE_TYPES.WINDOW);
    tiledWindows.forEach((nodeWin) => {
      if (nodeWin.nodeValue === draggingMetaWin) return; // GNOME owns this
      if (nodeWin.isFloat()) return;
      if (!nodeWin.renderRect) return;
      const r = nodeWin.renderRect;
      if (r.width > 0 && r.height > 0) {
        // Call move_resize_frame directly — this.move() bails out because
        // metaWindow.grabbed is true for all windows during a Wayland grab
        const actor = (
          nodeWin.nodeValue as Meta.Window
        ).get_compositor_private() as Clutter.Actor | null;
        if (!actor) return;
        actor.remove_all_transitions();
        (nodeWin.nodeValue as Meta.Window).move_resize_frame(true, r.x, r.y, r.width, r.height);
      }
    });
  }

  _handleMoving(focusNodeWindow: Node<any> | null) {
    if (!focusNodeWindow || focusNodeWindow.mode !== WINDOW_MODES.GRAB_TILE) return;

    const nodeWinAtPointer = this.findNodeWindowAtPointer(focusNodeWindow);
    this.nodeWinAtPointer = nodeWinAtPointer ?? null;

    const hidePreview = () => {
      if (focusNodeWindow.previewHint) {
        focusNodeWindow.previewHint.hide();
      }
    };

    if (nodeWinAtPointer) {
      if (!focusNodeWindow.previewHint) {
        const previewHint = new St.Bin();
        global.window_group.add_child(previewHint);
        focusNodeWindow.previewHint = previewHint;
      }

      if (this.allowDragDropTile()) {
        this.moveWindowToPointer(focusNodeWindow, true);
      } else {
        hidePreview();
      }
    } else {
      hidePreview();
    }
  }

  isFloatingExempt(metaWindow: Meta.Window) {
    if (!metaWindow) return true;
    const windowTitle = metaWindow.get_title();
    const windowType = metaWindow.get_window_type();
    const wmClass = metaWindow.get_wm_class();

    // Bug #294 fix: explicit TILE overrides take precedence over all
    // built-in float rules. Ported from jcrussell/forge
    for (const override of this.windowProps.overrides) {
      if (override.mode !== "tile") continue;

      let matchClass = false;
      let matchTitle: boolean;
      let matchId: boolean;

      if (override.wmClass) {
        matchClass = override.wmClass.includes(wmClass ?? "");
        if (!matchClass) continue;
      }
      if (override.wmTitle) {
        if (override.wmTitle === " ") {
          matchTitle = override.wmTitle === windowTitle;
        } else {
          const titles = override.wmTitle.split(",");
          matchTitle =
            titles.filter((t: string) => {
              if (windowTitle) {
                if (t.startsWith("!")) {
                  return !windowTitle.includes(t.slice(1));
                } else {
                  return windowTitle.includes(t);
                }
              }
              return false;
            }).length > 0;
        }
        if (!matchTitle) continue;
      }
      if (override.wmId) {
        matchId = override.wmId === String(metaWindow.get_id());
        if (!matchId) continue;
      }

      if (matchClass) return false;
    }

    // Bug #383 fix: Firefox PIP (Picture-in-Picture) windows should always float
    // Ported from jcrussell/forge
    if (windowTitle && windowTitle.toLowerCase().includes("picture-in-picture")) {
      return true;
    }

    // Bug #260 fix: Blender has rendering issues with tiling (cogl_framebuffer errors)
    // Ported from jcrussell/forge
    if (wmClass && wmClass.toLowerCase().includes("blender")) {
      return true;
    }

    // Bug #271 fix: Steam app has overlapping/sizing issues when tiled
    // Ported from jcrussell/forge
    if (
      wmClass &&
      (wmClass.toLowerCase().includes("steam") || wmClass.toLowerCase() === "steamwebhelper")
    ) {
      return true;
    }

    const floatByType =
      windowType === Meta.WindowType.DIALOG ||
      windowType === Meta.WindowType.MODAL_DIALOG ||
      metaWindow.get_transient_for() !== null ||
      metaWindow.get_wm_class() === null ||
      windowTitle === null ||
      windowTitle === "" ||
      windowTitle.length === 0 ||
      !metaWindow.allows_resize();

    const knownFloats = this.windowProps.overrides.filter((wprop) => wprop.mode === "float");

    const floatOverride =
      knownFloats.filter((kf) => {
        let matchTitle = false;
        let matchClass = false;
        let matchId = false;

        if (kf.wmTitle) {
          if (kf.wmTitle === " ") {
            matchTitle = kf.wmTitle === windowTitle;
          } else {
            const titles = kf.wmTitle.split(",");
            matchTitle =
              titles.filter((t: string) => {
                if (windowTitle) {
                  if (t.startsWith("!")) {
                    return !windowTitle.includes(t.slice(1));
                  } else {
                    return windowTitle.includes(t);
                  }
                }
                return false;
              }).length > 0;
          }
        }
        if (kf.wmClass) {
          matchClass = kf.wmClass.includes(metaWindow.get_wm_class() ?? "");
        }
        if (kf.wmId) {
          matchId = kf.wmId === String(metaWindow.get_id());
        }

        return (!kf.wmId || matchId) && (!kf.wmTitle || matchTitle) && matchClass;
      }).length > 0;

    return floatByType || floatOverride;
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
    // Get fresh data from the ConfigManager
    const freshProps = this.ext.configMgr.windowProps;
    if (freshProps) {
      this.windowProps = freshProps;
      this.windowProps.overrides = this.windowProps.overrides.filter((override) => !override.wmId);
      Logger.info(`Reloaded ${this.windowProps.overrides.length} window overrides from file`);
    }
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
