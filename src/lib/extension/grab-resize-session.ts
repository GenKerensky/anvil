/*
 * GrabResizeSession — grab-op begin/end, live resize, keyboard resize, exemption counts.
 *
 * Sole owner of grab session state (grabOp, cancelGrab, resizedWindows map, live loop).
 * Grab per-window fields (initRect / grabMode / initGrabOp) live on this session (B8-6);
 * Node still mirrors them during a grab for residual position-size readers.
 *
 * Live 16ms poll is a **Wayland fallback** only (B8-5). On X11, size-changed drives
 * handleResizing; the poll is not started.
 *
 * Geometry apply for neighbors uses TilingRender via host; percent delta math is pure.
 *
 * @see codebase-review.md F5 Stage 6, B8
 */

import GLib from "gi://GLib";
import Gio from "gi://Gio";
import Clutter from "gi://Clutter";
import Meta from "gi://Meta";
import St from "gi://St";

import { Logger } from "../shared/logger.js";
import * as Utils from "./utils.js";
import {
  ORIENTATION_TYPES,
  POSITION,
  NODE_TYPES,
  type Node,
  type RectLike,
  type Tree,
} from "./tree.js";
import { WINDOW_MODES, GRAB_TYPES } from "./window/constants.js";
import type { AnvilMetaWindow } from "./window/types.js";
import type { EventSchedulerPort } from "./event-scheduler.js";

export type MonitorConstraints = {
  maxWidth: number;
  maxHeight: number;
  enabled: boolean;
  resizeExempt: boolean;
} | null;

export interface GrabResizeHost {
  readonly tree: Tree;
  readonly focusMetaWindow: Meta.Window | null;
  readonly settings: Gio.Settings;
  nodeWinAtPointer: Node<any> | null;

  findNodeWindow(w: Meta.Window): Node<any> | null;
  findNodeWindowAtPointer(node: Node<any>): Node<any> | null;
  trackCurrentMonWs(): void;
  freezeRender(): void;
  unfreezeRender(): void;
  renderTree(from: string, force?: boolean): void;
  readonly scheduler: EventSchedulerPort;
  move(metaWindow: Meta.Window, rect: RectLike): void;
  calculateGaps(node: Node<any>): number;
  processNode(node: Node<any>): void;
  getMonitorConstraints(monitorIndex: number): MonitorConstraints;
  floatingWindow(node: Node<any>): boolean;
  minimizedWindow(node: Node<any>): boolean;
  allowDragDropTile(): boolean;
  moveWindowToPointer(node: Node<any>, previewOnly?: boolean): void;
  updateStackedFocus(node: Node<any> | null | undefined): void;
  updateTabbedFocus(node: Node<any> | null | undefined): void;
  observeGrabResizeUpdate(metaWindow: Meta.Window): void;
  observeGrabMoveUpdate(
    metaWindow: Meta.Window,
    pointer: readonly [number, number],
    eligible: boolean
  ): void;
}

/**
 * Pure percent update from a size delta against a sibling pair.
 * changePx = currentSize - firstSize for the edge being dragged.
 */
export function percentsFromSizeDelta(args: {
  firstSize: number;
  secondSize: number;
  parentSize: number;
  changePx: number;
}): { firstPercent: number; secondPercent: number } {
  const { firstSize, secondSize, parentSize, changePx } = args;
  if (parentSize <= 0) {
    return { firstPercent: 0, secondPercent: 0 };
  }
  return {
    firstPercent: (firstSize + changePx) / parentSize,
    secondPercent: (secondSize - changePx) / parentSize,
  };
}

type NodeGrabState = {
  initRect: RectLike | null;
  initGrabOp: Meta.GrabOp | null;
  grabMode: string | null;
};

function isWaylandCompositor(): boolean {
  try {
    const m = Meta as typeof Meta & { is_wayland_compositor?: () => boolean };
    if (typeof m.is_wayland_compositor === "function") {
      return m.is_wayland_compositor();
    }
  } catch {
    /* ignore */
  }
  // Prefer poll when we cannot detect — safer for nested/headless Wayland.
  return true;
}

export class GrabResizeSession {
  private _host: GrabResizeHost;
  grabOp: Meta.GrabOp = Meta.GrabOp.NONE;
  cancelGrab = false;
  resizedWindows: Map<number, number> = new Map();
  private _lastResizePair: Node<any> | null = null;
  private _grabbedMetaWindow: Meta.Window | null = null;
  private _liveResizeSrcId = 0;
  private _draggedNodeWindow: Node<any> | null = null;
  /** Session-owned grab fields (B8-6); mirrored onto Node for residual readers. */
  private _nodeGrab = new Map<number, NodeGrabState>();

  constructor(host: GrabResizeHost) {
    this._host = host;
  }

  private _winId(node: Node<any>): number | null {
    const w = node.nodeValue as Meta.Window | null;
    return w ? w.get_id() : null;
  }

  /** Write grab fields to session map + mirror onto Node (legacy). */
  private _setNodeGrab(node: Node<any>, patch: Partial<NodeGrabState>): void {
    const id = this._winId(node);
    const prev: NodeGrabState = (id !== null ? this._nodeGrab.get(id) : undefined) ?? {
      initRect: node.initRect ?? null,
      initGrabOp: node.initGrabOp ?? null,
      grabMode: node.grabMode ?? null,
    };
    const next = { ...prev, ...patch };
    if (id !== null) this._nodeGrab.set(id, next);
    node.initRect = next.initRect;
    node.initGrabOp = next.initGrabOp;
    node.grabMode = next.grabMode;
  }

  private _clearNodeGrab(node: Node<any>): void {
    const id = this._winId(node);
    if (id !== null) this._nodeGrab.delete(id);
    node.initRect = null;
    node.initGrabOp = null;
    node.grabMode = null;
  }

  getResizeCount(id: number): number {
    return this.resizedWindows.get(id) || 0;
  }

  /** True when a resize count has been recorded for `id` (counts are always ≥1). */
  hasResizeCount(id: number): boolean {
    return this.resizedWindows.has(id);
  }

  /** Number of windows with a recorded resize count (test probe). */
  get resizeCountEntries(): number {
    return this.resizedWindows.size;
  }

  /**
   * Seed a resize count for `id` (test-only). Lets tests simulate prior-resize
   * state without reaching into the internal `resizedWindows` map.
   */
  seedResizeCount(id: number, count: number): void {
    this.resizedWindows.set(id, count);
  }

  clearResizedWindows(): void {
    this.resizedWindows.clear();
  }

  dispose(): void {
    this._stopLiveResizeLoop();
    this._grabbedMetaWindow = null;
  }

  resizeByAmount(grabOp: Meta.GrabOp, amount: number) {
    const host = this._host;
    const metaWindow = host.focusMetaWindow;
    if (!metaWindow) return;
    const display = global.display;

    this.begin(display, metaWindow, grabOp);

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
    host.move(metaWindow, rect);
    host.scheduler.enqueue(
      {
        name: "manual-resize",
        callback: () => {
          if (host.scheduler.pendingCount === 0) {
            this.end(display, metaWindow, grabOp);
          }
        },
      },
      50
    );
  }

  begin(_display: Meta.Display, _metaWindow: Meta.Window, grabOp: Meta.GrabOp) {
    const host = this._host;
    if (!host.settings.get_boolean("tiling-mode-enabled")) return;
    this.grabOp = grabOp;
    this._grabbedMetaWindow = _metaWindow;
    host.trackCurrentMonWs();
    const focusMetaWindow = host.focusMetaWindow;

    Logger.debug(
      `_handleGrabOpBegin: grabOp=${grabOp} metaWindow=${
        _metaWindow?.get_title() || "none"
      } focusMetaWindow=${focusMetaWindow?.get_title() || "none"}`
    );

    if (focusMetaWindow) {
      const focusNodeWindow = host.findNodeWindow(focusMetaWindow);
      if (!focusNodeWindow) return;

      const frameRect = focusMetaWindow.get_frame_rect();
      const gaps = host.calculateGaps(focusNodeWindow);

      const mode = Utils.grabMode(grabOp);
      this._setNodeGrab(focusNodeWindow, {
        grabMode: mode,
        initGrabOp: grabOp,
        // Only set initRect if not already tracking a resize (preserves original during key repeat)
        initRect: focusNodeWindow.initRect
          ? focusNodeWindow.initRect
          : Utils.removeGapOnRect(frameRect, gaps),
      });
      if (mode === GRAB_TYPES.MOVING && focusNodeWindow.mode === WINDOW_MODES.TILE) {
        host.freezeRender();
        focusNodeWindow.mode = WINDOW_MODES.GRAB_TILE;
      }

      // Bug #433 fix: Track the window being dragged for preview hint cleanup
      // Ported from jcrussell/forge
      this._draggedNodeWindow = focusNodeWindow;

      // Live poll only on Wayland (B8-5). X11 relies on size-changed → handleResizing.
      if (mode === GRAB_TYPES.RESIZING && isWaylandCompositor()) {
        this._startLiveResizeLoop(focusNodeWindow);
      }
    }
  }

  end(_display: Meta.Display, _metaWindow: Meta.Window, grabOp: Meta.GrabOp) {
    const host = this._host;
    this._stopLiveResizeLoop();
    this._grabbedMetaWindow = null;
    host.unfreezeRender();
    const focusMetaWindow = host.focusMetaWindow;

    Logger.debug(
      `_handleGrabOpEnd: grabOp=${grabOp} metaWindow=${
        _metaWindow?.get_title() || "none"
      } focusMetaWindow=${focusMetaWindow?.get_title() || "none"}`
    );
    if (focusMetaWindow) {
      const focusNodeWindow = host.findNodeWindow(focusMetaWindow);
      if (focusNodeWindow) {
        Logger.debug(
          `_handleGrabOpEnd: percent=${focusNodeWindow.percent} initRect=${JSON.stringify(
            focusNodeWindow.initRect
          )} grabMode=${focusNodeWindow.grabMode}`
        );
      }
    }
    if (!focusMetaWindow) return;
    const focusNodeWindow = host.findNodeWindow(focusMetaWindow);

    if (focusNodeWindow && !this.cancelGrab) {
      // WINDOW_BASE is when grabbing the window decoration
      // COMPOSITOR is when something like Overview requesting a grab, especially when Super is pressed.
      if (grabOp === Meta.GrabOp.WINDOW_BASE || grabOp === Meta.GrabOp.MOVING_UNCONSTRAINED) {
        if (host.allowDragDropTile()) {
          host.moveWindowToPointer(focusNodeWindow);
        }
      }
    }

    // Bug #433 fix: Clean up preview hint from the originally dragged window
    // This handles cases where focus changed during drag (e.g., crossing monitors)
    // Ported from jcrussell/forge
    if (this._draggedNodeWindow && this._draggedNodeWindow !== focusNodeWindow) {
      this.cleanup(this._draggedNodeWindow);
    }
    this._draggedNodeWindow = null;

    this.cleanup(focusNodeWindow);

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
      host.renderTree("grab-op-end");
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
      const constraints = host.getMonitorConstraints(monitorIndex);
      if (constraints?.resizeExempt) {
        const winId = _metaWindow.get_id();
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
          const currentCount = this.resizedWindows.get(winId) || 0;
          this.resizedWindows.set(winId, currentCount + 1);
          return GLib.SOURCE_REMOVE;
        });
      }
    }

    host.updateStackedFocus(focusNodeWindow);
    host.updateTabbedFocus(focusNodeWindow);
    host.nodeWinAtPointer = null;

    // Phase C fix: Clear stale grabOp to prevent suppression of tabbed focus updates
    // Credit: mayconrcmello/forge PR #526
    this.grabOp = Meta.GrabOp.NONE;
  }

  cleanup(focusNodeWindow: Node<any> | null) {
    this.cancelGrab = false;
    this._lastResizePair = null;
    if (!focusNodeWindow) return;
    this._clearNodeGrab(focusNodeWindow);

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

  handleResizing(focusNodeWindow: Node<any> | null) {
    const host = this._host;
    if (!host.settings.get_boolean("tiling-mode-enabled")) return;
    const observedWindow = this._grabbedMetaWindow ?? host.focusMetaWindow;
    if (observedWindow) host.observeGrabResizeUpdate(observedWindow);
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
      const focusMeta = host.focusMetaWindow;
      if (!focusMeta) return;
      const frameRect = focusMeta.get_frame_rect();
      const gaps = host.calculateGaps(focusNodeWindow);
      const currentRect = Utils.removeGapOnRect(frameRect, gaps);
      let firstRect;
      let secondRect;
      let parentRect;
      let resizePairForWindow;

      if (initGrabOp === Meta.GrabOp.KEYBOARD_RESIZING_UNKNOWN) {
        Logger.debug(`_handleResizing: KEYBOARD_RESIZING_UNKNOWN — return early`);
        return;
      } else {
        resizePairForWindow = host.tree.nextVisible(focusNodeWindow, direction!);
        if (!resizePairForWindow) {
          // Edge case: window at the edge has no sibling in the resize direction
          // (e.g. resizing the right edge of the rightmost window).
          // Try the opposite direction to find the resize pair.
          if (direction !== undefined) {
            const oppositeDir = Utils.oppositeDirectionOf(direction) as Meta.MotionDirection;
            resizePairForWindow = host.tree.nextVisible(focusNodeWindow, oppositeDir);
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
          if (host.tree.getTiledChildren(parentNodeForFocus.childNodes).length <= 1) {
            return;
          }

          firstRect = focusNodeWindow.initRect;
          if (resizePairForWindow) {
            if (
              !host.floatingWindow(resizePairForWindow) &&
              !host.minimizedWindow(resizePairForWindow)
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
          const { firstPercent, secondPercent } = percentsFromSizeDelta({
            firstSize: firstRect!.width,
            secondSize: secondRect!.width,
            parentSize: parentRect.width,
            changePx,
          });
          focusNodeWindow.percent = firstPercent;
          resizePairForWindow!.percent = secondPercent;
        } else {
          // use the parent pairs (con to another con or window)
          if (resizePairForWindow && resizePairForWindow.parentNode) {
            if (host.tree.getTiledChildren(resizePairForWindow.parentNode.childNodes).length <= 1) {
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
            const { firstPercent, secondPercent } = percentsFromSizeDelta({
              firstSize: firstRect.width,
              secondSize: secondRect.width,
              parentSize: parentRect.width,
              changePx,
            });
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
          if (host.tree.getTiledChildren(parentNodeForFocus.childNodes).length <= 1) {
            return;
          }
          firstRect = focusNodeWindow.initRect;
          if (resizePairForWindow) {
            if (
              !host.floatingWindow(resizePairForWindow) &&
              !host.minimizedWindow(resizePairForWindow)
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
          const { firstPercent, secondPercent } = percentsFromSizeDelta({
            firstSize: firstRect!.height,
            secondSize: secondRect!.height,
            parentSize: parentRect.height,
            changePx,
          });
          focusNodeWindow.percent = firstPercent;
          resizePairForWindow!.percent = secondPercent;
          Logger.debug(
            `_handleResizing VERTICAL sameParent: changePx=${changePx} firstPercent=${firstPercent} secondPercent=${secondPercent} parentH=${parentRect.height}`
          );
        } else {
          // use the parent pairs (con to another con or window)
          if (resizePairForWindow && resizePairForWindow.parentNode) {
            if (host.tree.getTiledChildren(resizePairForWindow.parentNode.childNodes).length <= 1) {
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
            const { firstPercent, secondPercent } = percentsFromSizeDelta({
              firstSize: firstRect.height,
              secondSize: secondRect.height,
              parentSize: parentRect.height,
              changePx,
            });
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

  handleMoving(focusNodeWindow: Node<any> | null) {
    const host = this._host;
    if (!focusNodeWindow || focusNodeWindow.mode !== WINDOW_MODES.GRAB_TILE) return;

    const [pointerX, pointerY] = global.get_pointer() as unknown as [number, number];
    const dragDropAllowed = host.allowDragDropTile();
    host.observeGrabMoveUpdate(
      focusNodeWindow.nodeValue as Meta.Window,
      [pointerX, pointerY],
      dragDropAllowed
    );

    const nodeWinAtPointer = host.findNodeWindowAtPointer(focusNodeWindow);
    host.nodeWinAtPointer = nodeWinAtPointer ?? null;

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

      if (dragDropAllowed) {
        host.moveWindowToPointer(focusNodeWindow, true);
      } else {
        hidePreview();
      }
    } else {
      hidePreview();
    }
  }

  _startLiveResizeLoop(focusNodeWindow: Node<any>) {
    const host = this._host;
    this._stopLiveResizeLoop();
    if (!host.settings.get_boolean("tiling-mode-enabled")) return;

    // Cache gaps once — they don't change during a resize
    const gaps = host.calculateGaps(focusNodeWindow);
    let lastWidth = focusNodeWindow.initRect?.width;
    let lastHeight = focusNodeWindow.initRect?.height;

    this._liveResizeSrcId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16, () => {
      if (!host.settings.get_boolean("tiling-mode-enabled")) {
        this._liveResizeSrcId = 0;
        return GLib.SOURCE_REMOVE;
      }
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

      this.handleResizing(focusNodeWindow);

      // Update initRect so next tick delta is relative to current frame,
      // not the grab start (prevents percent accumulation)
      this._setNodeGrab(focusNodeWindow, { initRect: currentRect });

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

  _repositionDuringResize(focusNodeWindow: Node<any> | null) {
    const host = this._host;
    if (!focusNodeWindow || !focusNodeWindow.initRect) {
      Logger.debug(`_repositionDuringResize: skip — no focusNodeWindow or no initRect`);
      return;
    }

    const metaWindow = focusNodeWindow.nodeValue as Meta.Window;
    if (!metaWindow) return;

    const frameRect = metaWindow.get_frame_rect();
    const initRect = focusNodeWindow.initRect;
    const gaps = host.calculateGaps(focusNodeWindow);

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

  _liveResizeNeighbors(draggingNodeWindow: Node<any>) {
    const host = this._host;
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
      host.processNode(parentNode);
    }

    // Move all tiled windows except the one being dragged
    const tiledWindows = host.tree.getNodeByType(NODE_TYPES.WINDOW);
    tiledWindows.forEach((nodeWin) => {
      if (nodeWin.nodeValue === draggingMetaWin) return; // GNOME owns this
      if (nodeWin.isFloat()) return;
      if (!nodeWin.renderRect) return;
      const r = nodeWin.renderRect;
      if (r.width > 0 && r.height > 0) {
        // Call move_resize_frame directly — host.move() bails out because
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
}
