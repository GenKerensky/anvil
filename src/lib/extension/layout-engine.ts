/*
 * LayoutEngine — tree layout algebra + percent math.
 *
 * Sole owner of: split / move / swap / focus, computeSizes, sibling percent
 * reset/redistribute, determineSplitLayout, autoSplitFromFocus.
 *
 * Tree retains structure (Node, createNode, removeNode, next, …) and thin
 * delegates to WindowManager.layoutEngine for the ops above (Stage 5 bridge).
 * Frame apply and focus activation go through LayoutHost (not TilingRender).
 *
 * @see codebase-review.md F5 Stage 5, architecture rule 2
 */

import Gio from "gi://Gio";
import Meta from "gi://Meta";
import St from "gi://St";

import * as Utils from "./utils.js";
import { safeRaise, safeFocus, safeActivate } from "./mutter-safe.js";
import {
  LAYOUT_TYPES,
  NODE_TYPES,
  Node,
  ORIENTATION_TYPES,
  POSITION,
  type RectLike,
  type Tree,
} from "./tree.js";
import { WINDOW_MODES } from "./window/constants.js";
import type { PointerFocusSource } from "./pointer-policy.js";

export interface LayoutHost {
  readonly tree: Tree;
  readonly settings: Gio.Settings;
  readonly focusMetaWindow: Meta.Window | null;
  readonly currentMonWsNode: Node<any> | null;

  notifyFocusChanged(node: Node<any> | null, source: PointerFocusSource): void;
  moveWindow(metaWindow: Meta.Window, rect: RectLike): void;
  rectForMonitor(node: Node<any>, monitorIndex: number): RectLike | null;
  sameParentMonitor(a: Node<any>, b: Node<any>): boolean;
  floatingWindow(node: Node<any>): boolean;
}

export class LayoutEngine {
  private _host: LayoutHost;

  constructor(host: LayoutHost) {
    this._host = host;
  }

  /**
   * Portrait monitors prefer VSPLIT; landscape HSPLIT.
   * Pass monitorRect in tests to avoid global.display.
   */
  determineSplitLayout(monitorRect?: { width: number; height: number }): string {
    const rect =
      monitorRect ?? global.display.get_monitor_geometry(global.display.get_current_monitor());
    if (rect.width < rect.height) {
      return LAYOUT_TYPES.VSPLIT;
    }
    return LAYOUT_TYPES.HSPLIT;
  }

  /**
   * Auto-split the focused window's container before admitting a new tiled window.
   * Returns true if a split was performed.
   */
  autoSplitFromFocus(): boolean {
    const host = this._host;
    if (!host.settings?.get_boolean("auto-split-enabled")) return false;
    const focusMetaWindow = host.focusMetaWindow;
    if (!focusMetaWindow) return false;
    const currentFocusNode = host.tree.findNode(focusMetaWindow);
    if (!currentFocusNode) return false;
    const currentParentFocusNode = currentFocusNode.parentNode!;
    const layout = currentParentFocusNode.layout;
    if (layout !== LAYOUT_TYPES.HSPLIT && layout !== LAYOUT_TYPES.VSPLIT) return false;
    const frameRect = focusMetaWindow.get_frame_rect();
    const splitHorizontal = frameRect.width > frameRect.height;
    // Parity with prior WindowTracker admit path (lowercase strings).
    const orientation = splitHorizontal ? "horizontal" : "vertical";
    this.split(currentFocusNode, orientation);
    return true;
  }

  focus(node: Node<any> | null, direction: Meta.MotionDirection): Node<any> | null {
    const host = this._host;
    const tree = host.tree;
    if (!node) return null;
    let next = tree.next(node, direction);

    if (!next) return null;

    const type = next.nodeType;
    const position = Utils.positionFromDirection(direction);
    const previous = position === POSITION.BEFORE;

    switch (type) {
      case NODE_TYPES.WINDOW:
        break;
      case NODE_TYPES.CON: {
        const tiledConWindows = next
          .getNodeByType(NODE_TYPES.WINDOW)
          .filter((w: Node<any>) => w.isTile());
        if (next.layout === LAYOUT_TYPES.STACKED) {
          next = next.lastChild;
        } else {
          if (tiledConWindows.length > 1) {
            if (previous) {
              next = tiledConWindows[tiledConWindows.length - 1];
            } else {
              next = tiledConWindows[0];
            }
          } else {
            next = tiledConWindows[0];
          }
        }
        break;
      }
      case NODE_TYPES.MONITOR:
        if (next.layout === LAYOUT_TYPES.STACKED) {
          next = next.lastChild;
        } else {
          if (previous) {
            next = next.lastChild;
          } else {
            next = next.firstChild;
          }
        }

        if (next && next.nodeType === NODE_TYPES.CON) {
          const tiledConWindows = next
            .getNodeByType(NODE_TYPES.WINDOW)
            .filter((w: Node<any>) => w.isTile());
          if (next.layout === LAYOUT_TYPES.STACKED) {
            next = next.lastChild;
          } else {
            if (tiledConWindows.length > 1) {
              if (previous) {
                next = tiledConWindows[tiledConWindows.length - 1];
              } else {
                next = tiledConWindows[0];
              }
            } else {
              next = tiledConWindows[0];
            }
          }
        }
        break;
    }

    if (!next) return null;

    const metaWindow = next.nodeValue as Meta.Window;
    if (!metaWindow) return null;
    if (metaWindow.minimized) {
      next = this.focus(next, direction);
    } else {
      safeRaise(metaWindow);
      safeFocus(metaWindow, global.display.get_current_time());
      safeActivate(metaWindow, global.display.get_current_time());

      host.notifyFocusChanged(next, "keyboard");
      tree.debugParentNodes(next);
    }
    return next;
  }

  move(node: Node<any>, direction: Meta.MotionDirection) {
    const host = this._host;
    const tree = host.tree;
    const next = tree.next(node, direction);
    const position = Utils.positionFromDirection(direction);

    if (!next) {
      // No adjacent node on the same monitor — append or prepend
      const currMonWsNode = host.currentMonWsNode;
      if (currMonWsNode) {
        if (position === POSITION.AFTER) {
          currMonWsNode.appendChild(node);
        } else {
          currMonWsNode.insertBefore(node, currMonWsNode.firstChild);
        }
        return true;
      }
      return false;
    }

    const parentNode = node.parentNode;
    let parentTarget;

    switch (next.nodeType) {
      case NODE_TYPES.WINDOW:
        // If same parent, swap
        if (next === node.previousSibling || next === node.nextSibling) {
          this.swapPairs(node, next);
          host.notifyFocusChanged(node, "move");
          tree.debugParentNodes(node);
          // do not reset percent when swapped
          return true;
        } else {
          parentTarget = next.parentNode;
          if (parentTarget) {
            if (position === POSITION.AFTER) {
              parentTarget.insertBefore(node, next);
            } else {
              parentTarget.insertBefore(node, next.nextSibling);
            }
          }
        }
        break;
      case NODE_TYPES.CON:
        parentTarget = next;

        if (next.isStacked()) {
          next.appendChild(node);
        } else {
          if (position === POSITION.AFTER) {
            next.insertBefore(node, next.firstChild);
          } else {
            next.appendChild(node);
          }
        }
        break;
      case NODE_TYPES.MONITOR: {
        parentTarget = next;
        const currMonWsNode = host.currentMonWsNode;
        if (!currMonWsNode) return false;

        if (
          !next.contains(node) &&
          (node === currMonWsNode.firstChild || node === currMonWsNode.lastChild)
        ) {
          const targetMonRect = host.rectForMonitor(
            node,
            Utils.monitorIndex(next.nodeValue as string)
          );
          if (!targetMonRect) return false;
          if (position === POSITION.AFTER) {
            next.insertBefore(node, next.firstChild);
          } else {
            next.appendChild(node);
          }
          const rect = targetMonRect;
          host.moveWindow(node.nodeValue as Meta.Window, rect);
          host.notifyFocusChanged(node, "move");
          tree.debugParentNodes(node);
        } else {
          if (position === POSITION.AFTER) {
            currMonWsNode.appendChild(node);
          } else {
            currMonWsNode.insertBefore(node, currMonWsNode.firstChild);
          }
        }
        break;
      }
      default:
        break;
    }
    this.resetSiblingPercent(parentNode!);
    this.resetSiblingPercent(parentTarget!);
    parentNode!.resetLayoutSingleChild();
    return true;
  }

  split(node: Node<any>, orientation: string, forceSplit: boolean = false) {
    const host = this._host;
    const tree = host.tree;
    if (!node) return;
    const type = node.nodeType;

    if (type === NODE_TYPES.WINDOW && node.mode === WINDOW_MODES.FLOAT) {
      return;
    }

    if (!(type === NODE_TYPES.MONITOR || type === NODE_TYPES.CON || type === NODE_TYPES.WINDOW)) {
      return;
    }

    const parentNode = node.parentNode;
    if (!parentNode) return;
    const numChildren = parentNode.childNodes.length;

    // toggle the split
    if (
      !forceSplit &&
      numChildren === 1 &&
      (parentNode.layout === LAYOUT_TYPES.HSPLIT || parentNode.layout === LAYOUT_TYPES.VSPLIT)
    ) {
      parentNode.layout =
        orientation === ORIENTATION_TYPES.HORIZONTAL ? LAYOUT_TYPES.HSPLIT : LAYOUT_TYPES.VSPLIT;
      tree.attachNode = parentNode;
      return;
    }

    // Push down the Meta.Window into a new Container
    const currentIndex = node.index;
    const container = new St.Bin();
    const newConNode = new Node(NODE_TYPES.CON, container);
    newConNode.settings = host.settings;

    // Take the direction of the parent
    newConNode.layout =
      orientation === ORIENTATION_TYPES.HORIZONTAL ? LAYOUT_TYPES.HSPLIT : LAYOUT_TYPES.VSPLIT;
    newConNode.rect = node.rect;
    newConNode.percent = node.percent;
    newConNode.parentNode = parentNode;
    parentNode.childNodes[currentIndex!] = newConNode;
    tree.createNode(container, node.nodeType, node.nodeValue);
    node.parentNode = newConNode;
    tree.attachNode = newConNode;
  }

  swap(node: Node<any>, direction: Meta.MotionDirection) {
    const host = this._host;
    const tree = host.tree;
    let nextSwapNode = tree.next(node, direction);
    if (!nextSwapNode) {
      return;
    }
    const nodeSwapType = nextSwapNode.nodeType;

    switch (nodeSwapType) {
      case NODE_TYPES.WINDOW:
        break;
      case NODE_TYPES.CON:
      case NODE_TYPES.MONITOR: {
        const childWindowNodes = nextSwapNode
          .getNodeByMode(WINDOW_MODES.TILE)
          .filter((t: Node<any>) => t.nodeType === NODE_TYPES.WINDOW);
        if (nextSwapNode.layout === LAYOUT_TYPES.STACKED) {
          nextSwapNode = childWindowNodes[childWindowNodes.length - 1];
        } else {
          nextSwapNode = childWindowNodes[0];
        }
        break;
      }
    }

    const isNextNodeWin =
      nextSwapNode && nextSwapNode.nodeValue && nextSwapNode.nodeType === NODE_TYPES.WINDOW;
    if (isNextNodeWin) {
      if (!host.sameParentMonitor(node, nextSwapNode)) {
        // TODO, there is a freeze bug if there are not in same monitor.
        return;
      }
      this.swapPairs(node, nextSwapNode);
    }
    return nextSwapNode;
  }

  swapPairs(fromNode: Node<any>, toNode: Node<any>, focus: boolean = true) {
    const host = this._host;
    if (!(this._swappable(fromNode) && this._swappable(toNode))) return;
    // Swap the items in the array
    const parentForFrom = fromNode ? fromNode.parentNode : undefined;
    const parentForTo = toNode.parentNode;
    if (parentForTo && parentForFrom) {
      const nextIndex = toNode.index;
      const focusIndex = fromNode.index;

      const transferMode = fromNode.mode;
      fromNode.mode = toNode.mode;
      toNode.mode = transferMode;

      const transferRect = (fromNode.nodeValue as Meta.Window).get_frame_rect();
      const transferToRect = (toNode.nodeValue as Meta.Window).get_frame_rect();
      const transferPercent = fromNode.percent;

      fromNode.percent = toNode.percent;
      toNode.percent = transferPercent;

      parentForTo.childNodes[nextIndex!] = fromNode;
      fromNode.parentNode = parentForTo;
      parentForFrom.childNodes[focusIndex!] = toNode;
      toNode.parentNode = parentForFrom;

      host.moveWindow(fromNode.nodeValue as Meta.Window, transferToRect);
      host.moveWindow(toNode.nodeValue as Meta.Window, transferRect);

      if (focus) {
        // The fromNode is now on the parent-target
        safeRaise(fromNode.nodeValue as Meta.Window);
        safeFocus(fromNode.nodeValue as Meta.Window, global.get_current_time());
      }
    }
  }

  private _swappable(node: Node<any> | null) {
    if (!node) return false;
    if (node.nodeType === NODE_TYPES.WINDOW && !(node.nodeValue as Meta.Window).minimized) {
      return true;
    }
    return false;
  }

  computeSizes(node: Node<any>, childItems: Node<any>[]) {
    const sizes: number[] = [];
    const orientation = Utils.orientationFromLayout(node.layout!);
    const rect = node.rect!;
    const totalSize = orientation === ORIENTATION_TYPES.HORIZONTAL ? rect.width : rect.height;
    const grabTiled = node.getNodeByMode(WINDOW_MODES.GRAB_TILE).length > 0;
    childItems.forEach((childNode: Node<any>, index: number) => {
      const percent =
        childNode.percent && childNode.percent > 0.0 && !grabTiled
          ? childNode.percent
          : 1.0 / childItems.length;
      sizes[index] = Math.floor(percent * totalSize);
    });
    // Bug #330 fix: Ensure total allocated size equals parent size
    // Ported from jcrussell/forge
    const totalAllocated = sizes.reduce((a: number, b: number) => a + b, 0);
    if (totalAllocated !== totalSize) {
      sizes[sizes.length - 1] += totalSize - totalAllocated;
    }
    return sizes;
  }

  resetSiblingPercent(parentNode: Node<any> | null) {
    if (!parentNode) return;
    const children = parentNode.childNodes;
    children.forEach((n: Node<any>) => {
      n.percent = 0.0;
    });
  }

  redistributeSiblingPercent(parentNode: Node<any> | null) {
    if (!parentNode) return;
    const children = parentNode.childNodes;
    if (children.length === 0) return;

    // Calculate sum of remaining children's percents
    let totalPercent = 0;
    children.forEach((n: Node<any>) => {
      totalPercent += n.percent || 0;
    });

    if (totalPercent > 0) {
      // Scale remaining children proportionally to sum to 1.0
      const scale = 1.0 / totalPercent;
      children.forEach((n: Node<any>) => {
        n.percent = (n.percent || 0) * scale;
      });
    } else {
      // Fallback: if no percents were set, use equal distribution
      children.forEach((n: Node<any>) => {
        n.percent = 1.0 / children.length;
      });
    }
  }
}
