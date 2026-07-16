/*
 * Pointer Policy — when the cursor warps with focus, and hover-focus behaviour.
 */

import GLib from "gi://GLib";
import Clutter from "gi://Clutter";
import GObject from "gi://GObject";
import Gio from "gi://Gio";
import Meta from "gi://Meta";

import * as Main from "resource:///org/gnome/shell/ui/main.js";

import { Logger } from "../shared/logger.js";
import * as Utils from "./utils.js";
import type { Node } from "./tree.js";
import { safeRaise, safeFocus } from "./mutter-safe.js";

export type PointerFocusSource =
  | "keyboard"
  | "signal"
  | "overview"
  | "command"
  | "move"
  | "swap"
  | "window-create";

export interface PointerPolicyOptions {
  settings: Gio.Settings;
  isWorkspaceChanging: () => boolean;
  isDisabled: () => boolean;
}

export class PointerPolicy extends GObject.Object {
  static {
    GObject.registerClass(this);
  }

  private _settings: Gio.Settings;
  private _isWorkspaceChanging: () => boolean;
  private _isDisabled: () => boolean;
  private _hoverFocusEnabled = false;
  private _pointerFocusTimeoutId = 0;

  lastFocusedWindow: Node | null = null;
  lastFocusedWindowMonitor = 0;
  lastFocusedWindowWorkspace = 0;

  constructor(options: PointerPolicyOptions) {
    super();
    this._settings = options.settings;
    this._isWorkspaceChanging = options.isWorkspaceChanging;
    this._isDisabled = options.isDisabled;
    this.lastFocusedWindowMonitor = global.display.get_current_monitor();
    this.lastFocusedWindowWorkspace = global.display
      .get_workspace_manager()
      .get_active_workspace_index();
  }

  setHoverFocusEnabled(enabled: boolean) {
    this._hoverFocusEnabled = enabled;
    if (enabled) {
      this._startHoverLoop();
    } else {
      this._stopHoverLoop();
    }
  }

  disable() {
    this._stopHoverLoop();
  }

  /**
   * Focus changed — optionally warp the pointer to the focused window.
   */
  onFocusChanged({ node, source: _source }: { node: Node | null; source: PointerFocusSource }) {
    if (!node || !node._data) return;

    if (this._settings.get_boolean("move-pointer-focus-enabled")) {
      this._storePointerLastPosition(this.lastFocusedWindow);
      if (this._canWarpToNode(node)) {
        this._warpToNode(node);
      }
    }

    this.lastFocusedWindow = node;
    this.lastFocusedWindowMonitor = (node._data as Meta.Window).get_monitor();
    this.lastFocusedWindowWorkspace = global.display
      .get_workspace_manager()
      .get_active_workspace_index();
  }

  /**
   * Workspace animation settled — warp pointer to focused window's monitor if needed.
   */
  onWorkspaceSettled() {
    if (!this._settings.get_boolean("move-pointer-focus-enabled")) return;
    if (!this.lastFocusedWindow || !this.lastFocusedWindow._data) return;

    const currentMonitor = global.display.get_current_monitor();
    if (currentMonitor !== this.lastFocusedWindowMonitor) {
      const monitorGeom = global.display.get_monitor_geometry(this.lastFocusedWindowMonitor);
      if (monitorGeom) {
        const seat = Clutter.get_default_backend().get_default_seat();
        if (seat) {
          seat.warp_pointer(
            monitorGeom.x + Math.floor(monitorGeom.width / 2),
            monitorGeom.y + Math.floor(monitorGeom.height / 2)
          );
        }
      }
    }
  }

  private _startHoverLoop() {
    if (this._pointerFocusTimeoutId) {
      GLib.Source.remove(this._pointerFocusTimeoutId);
    }

    this._pointerFocusTimeoutId = GLib.timeout_add(
      GLib.PRIORITY_DEFAULT,
      16,
      this._focusWindowUnderPointer.bind(this)
    );
  }

  private _stopHoverLoop() {
    if (this._pointerFocusTimeoutId) {
      GLib.Source.remove(this._pointerFocusTimeoutId);
      this._pointerFocusTimeoutId = 0;
    }
  }

  /** @returns true to continue polling, false to stop */
  private _focusWindowUnderPointer(): boolean {
    if (!this._hoverFocusEnabled || this._isDisabled()) return false;

    if (Main.overview.visible) return true;

    if (this._isWorkspaceChanging()) return true;

    const focusedWindow = global.display.get_focus_window();
    if (focusedWindow) {
      const focusedType = focusedWindow.get_window_type();
      if (focusedType === Meta.WindowType.MODAL_DIALOG || focusedType === Meta.WindowType.DIALOG) {
        return true;
      }
    }

    const pointer = global.get_pointer() as unknown as [number, number];
    const metaWindow = this._getMetaWindowAtPointer(pointer);

    if (metaWindow) {
      safeFocus(metaWindow, global.display.get_current_time());
      safeRaise(metaWindow);
    }

    return true;
  }

  private _getMetaWindowAtPointer(pointer: [number, number]) {
    const windows = global.get_window_actors();
    const metaWindows: Meta.Window[] = [];

    for (let i = windows.length - 1; i >= 0; i--) {
      const metaWindow = windows[i].meta_window;
      if (metaWindow) {
        metaWindows.push(metaWindow);
      }
    }

    return Utils.metaWindowAtPoint(pointer, metaWindows);
  }

  private _canWarpToNode(nodeWindow: Node) {
    if (nodeWindow && nodeWindow._data) {
      const metaWindow = nodeWindow.nodeValue as Meta.Window;
      const metaRect = metaWindow.get_frame_rect();
      const pointerCoord = global.get_pointer() as unknown as [number, number];
      return (
        metaRect &&
        metaRect.width > 8 &&
        metaRect.height > 8 &&
        !Utils.rectContainsPoint(metaRect, pointerCoord) &&
        !metaWindow.minimized &&
        !Main.overview.visible &&
        !this._pointerIsOverParentDecoration(nodeWindow, pointerCoord)
      );
    }
    return false;
  }

  private _pointerIsOverParentDecoration(nodeWindow: Node, pointerCoord: [number, number]) {
    if (pointerCoord && nodeWindow?.parentNode) {
      const node = nodeWindow.parentNode;
      if (node.isTabbed() || node.isStacked()) {
        return Utils.rectContainsPoint(node.rect!, pointerCoord);
      }
    }
    return false;
  }

  private _warpToNode(nodeWindow: Node) {
    const newCoord = this._getPointerPositionInside(nodeWindow);
    if (newCoord && newCoord.x && newCoord.y) {
      const seat = Clutter.get_default_backend().get_default_seat();
      if (seat) {
        const wmTitle = (nodeWindow.nodeValue as Meta.Window).get_title();
        Logger.debug(`moved pointer to [${wmTitle}] at (${newCoord.x},${newCoord.y})`);
        seat.warp_pointer(newCoord.x, newCoord.y);
      }
    }
  }

  private _getPointerPositionInside(nodeWindow: Node | null) {
    if (nodeWindow && nodeWindow._data) {
      const metaWindow = nodeWindow.nodeValue as Meta.Window;
      const metaRect = metaWindow.get_frame_rect();
      const [wx, wy] = nodeWindow.pointer
        ? [nodeWindow.pointer.x, nodeWindow.pointer.y]
        : [metaRect.width / 2, 8];
      const px = wx >= metaRect.width ? metaRect.width - 8 : wx;
      const py = wy >= metaRect.height ? metaRect.height - 8 : wy;
      return {
        x: metaRect.x + px,
        y: metaRect.y + py,
      };
    }
    return null;
  }

  private _storePointerLastPosition(nodeWindow: Node | null) {
    if (nodeWindow && nodeWindow._data) {
      const metaWindow = nodeWindow.nodeValue as Meta.Window;
      const metaRect = metaWindow.get_frame_rect();
      const pointerCoord = global.get_pointer() as unknown as [number, number];
      if (Utils.rectContainsPoint(metaRect, pointerCoord)) {
        const px = pointerCoord[0] - metaRect.x;
        const py = pointerCoord[1] - metaRect.y;
        if (px > 0 && py > 0) {
          nodeWindow.pointer = { x: px, y: py };
          Logger.debug(`stored pointer for [${metaWindow.get_title()}] at (${px},${py})`);
        }
      }
    }
  }
}
