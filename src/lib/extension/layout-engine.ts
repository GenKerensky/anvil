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
  isUnsetPercent,
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
   * Set container layout mode (B6-2). Resets sibling percents when leaving STACKED/TABBED
   * back to a split layout. Caller handles raise/activate and render.
   */
  setLayout(node: Node<any> | null, layout: string): void {
    if (!node) return;
    const prev = node.layout;
    node.layout = layout;
    if (
      (prev === LAYOUT_TYPES.STACKED || prev === LAYOUT_TYPES.TABBED) &&
      (layout === LAYOUT_TYPES.HSPLIT || layout === LAYOUT_TYPES.VSPLIT)
    ) {
      this.resetSiblingPercent(node);
    }
    if (layout !== LAYOUT_TYPES.TABBED) {
      node.lastTabFocus = null;
    }
  }

  /**
   * Toggle a split container between HSPLIT and VSPLIT (architecture rule §2:
   * LayoutEngine is the sole owner of layout writes). Sets `tree.attachNode` to
   * the toggled parent so the next render attaches there. Caller renders.
   */
  toggleSplitLayout(parentNode: Node<any>): void {
    const currentLayout = parentNode.layout;
    if (currentLayout === LAYOUT_TYPES.HSPLIT) {
      parentNode.layout = LAYOUT_TYPES.VSPLIT;
    } else if (currentLayout === LAYOUT_TYPES.VSPLIT) {
      parentNode.layout = LAYOUT_TYPES.HSPLIT;
    }
    this._host.tree.attachNode = parentNode;
  }

  /**
   * Set the tree's attach node (architecture rule §2: commands express intent
   * through LayoutEngine rather than mutating tree structure directly).
   */
  setAttachNode(node: Node<any>): void {
    this._host.tree.attachNode = node;
  }

  /**
   * Reset percent state for a focus window's parent after a float toggle
   * (architecture rule §2: LayoutEngine is the sole owner of sibling percents).
   * If the parent now has at most one tiled child, clear its percent and reset
   * the grandparent's siblings, then reset the parent's siblings.
   */
  resetPercentForFloatToggle(parentNode: Node<any>, tree: Tree): void {
    if (tree.getTiledChildren(parentNode.childNodes).length <= 1) {
      parentNode.percent = undefined;
      this.resetSiblingPercent(parentNode.parentNode!);
    }
    this.resetSiblingPercent(parentNode);
  }

  /**
   * Raise a window to the end of its stacked parent's child list (architecture
   * rule §2: tree-structure mutations for tiling ops go through LayoutEngine).
   * Used by the move command's stacked-queue follow-up to bring the moved window
   * to the top of the stack. Caller renders.
   */
  raiseInStacked(node: Node<any>): void {
    const parent = node.parentNode;
    if (!parent) return;
    parent.appendChild(node);
  }

  /**
   * Reparent `node` under `newParent` and redistribute the old parent's
   * remaining siblings so their percents still sum to ~1 (architecture rule
   * §2: LayoutEngine owns sibling percents and tree-structure mutations for
   * tiling ops). Used when a window crosses monitor/workspace nodes.
   */
  reparentToNode(node: Node<any>, newParent: Node<any>): void {
    const oldParent = node.parentNode;
    newParent.appendChild(node);
    if (oldParent) {
      this.redistributeSiblingPercent(oldParent);
    }
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

    // Skip minimized windows with an explicit loop + visited set (B5-4).
    const visited = new Set<Node<any>>();
    let from: Node<any> | null = node;
    while (from) {
      const step = tree.next(from, direction);
      if (!step) return null;
      const candidate = this._resolveFocusTarget(step, direction);
      if (!candidate) return null;
      if (visited.has(candidate)) return null;
      visited.add(candidate);

      const metaWindow = candidate.nodeValue as Meta.Window;
      if (!metaWindow) return null;
      if (metaWindow.minimized) {
        from = candidate;
        continue;
      }

      safeRaise(metaWindow);
      safeFocus(metaWindow, global.display.get_current_time());
      safeActivate(metaWindow, global.display.get_current_time());
      host.notifyFocusChanged(candidate, "keyboard");
      tree.debugParentNodes(candidate);
      return candidate;
    }
    return null;
  }

  /** Resolve CON/MONITOR focus targets to a window node (shared with focus loop). */
  private _resolveFocusTarget(
    next: Node<any> | null,
    direction: Meta.MotionDirection
  ): Node<any> | null {
    if (!next) return null;
    const position = Utils.positionFromDirection(direction);
    const previous = position === POSITION.BEFORE;
    const type = next.nodeType;

    switch (type) {
      case NODE_TYPES.WINDOW:
        return next;
      case NODE_TYPES.CON: {
        const tiledConWindows = next
          .getNodeByType(NODE_TYPES.WINDOW)
          .filter((w: Node<any>) => w.isTile());
        if (next.layout === LAYOUT_TYPES.STACKED) {
          return next.lastChild;
        }
        if (tiledConWindows.length > 1) {
          return previous ? tiledConWindows[tiledConWindows.length - 1] : tiledConWindows[0];
        }
        return tiledConWindows[0] ?? null;
      }
      case NODE_TYPES.MONITOR: {
        let monNext: Node<any> | null;
        if (next.layout === LAYOUT_TYPES.STACKED) {
          monNext = next.lastChild;
        } else {
          monNext = previous ? next.lastChild : next.firstChild;
        }
        if (monNext && monNext.nodeType === NODE_TYPES.CON) {
          return this._resolveFocusTarget(monNext, direction);
        }
        return monNext;
      }
      default:
        return next;
    }
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
      // B5-3: undefined (or legacy 0) means equal share
      const percent =
        !grabTiled && !isUnsetPercent(childNode.percent)
          ? (childNode.percent as number)
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
    parentNode.childNodes.forEach((n: Node<any>) => {
      n.percent = undefined;
    });
  }

  redistributeSiblingPercent(parentNode: Node<any> | null) {
    if (!parentNode) return;
    const children = parentNode.childNodes;
    if (children.length === 0) return;

    // Calculate sum of remaining children's percents
    let totalPercent = 0;
    children.forEach((n: Node<any>) => {
      if (!isUnsetPercent(n.percent)) totalPercent += n.percent as number;
    });

    if (totalPercent > 0) {
      // Scale remaining children proportionally to sum to 1.0
      const scale = 1.0 / totalPercent;
      children.forEach((n: Node<any>) => {
        n.percent = isUnsetPercent(n.percent) ? 0 : (n.percent as number) * scale;
      });
    } else {
      // Fallback: if no percents were set, use equal distribution
      children.forEach((n: Node<any>) => {
        n.percent = 1.0 / children.length;
      });
    }
  }
}
