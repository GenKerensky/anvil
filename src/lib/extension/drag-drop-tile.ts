/**
 * DragDropTile — drag-drop tiling preview and placement logic (Stage 0).
 *
 * Moved from WindowManager.moveWindowToPointer / findNodeWindowAtPointer /
 * _findNodeWindowAtPointer / _getDragDropCenterPreviewStyle.
 *
 * This module computes the drop **plan** (region hit-test + resolved container,
 * reference, layouts) and renders the preview hint. It does NOT mutate tree
 * structure, sibling percents, or layouts — the whole placement transaction is
 * delegated to `LayoutEngine.applyDragDrop(plan)`, the sole owner of those
 * writes (architecture rule §2). Extraction rationale: `.agents/memory/decisions.md`.
 */

import Meta from "gi://Meta";
import Gio from "gi://Gio";

import { Logger } from "../shared/logger.js";
import {
  Tree,
  Node,
  LAYOUT_TYPES,
  ORIENTATION_TYPES,
  NODE_TYPES,
  type NodeType,
  type RectLike,
} from "./tree.js";
import * as Utils from "./utils.js";
import type { LayoutEngine, DragDropPlan } from "./layout-engine.js";
import { WINDOW_MODES } from "./window/constants.js";

/** Host surface for DragDropTile — narrow, read-only where possible. */
export interface DragDropTileHost {
  readonly tree: Tree;
  readonly settings: Gio.Settings;
  readonly layoutEngine: LayoutEngine;
  /** Shared with GrabResizeSession; storage owned by WM. Read-only here. */
  readonly nodeWinAtPointer: Node<NodeType> | null;
  /** Read-only view of grab cancel flag (owned by GrabResizeSession). Routed via WM. */
  readonly cancelGrab: boolean;
  sortedWindows: Meta.Window[];
  renderTree(from: string, force?: boolean): void;
  processGap(node: Node<NodeType>): RectLike;
}

type RegionRect = { x: number; y: number; width: number; height: number };
type PreviewParams = { className: string; targetRect: RegionRect | null };

export class DragDropTile {
  constructor(private host: DragDropTileHost) {}

  /**
   * Handle previewing and applying where a drag-drop window is going to be tiled.
   *
   * The plan phase (region hit-test) is pure — it computes a `DragDropPlan`
   * without mutating the tree. The apply phase delegates the whole structural
   * transaction to `LayoutEngine.applyDragDrop`, so this module never writes
   * tree structure, percents, or layouts directly (architecture rule §2).
   */
  moveWindowToPointer(focusNodeWindow: Node<NodeType>, preview: boolean = false) {
    if (this.host.cancelGrab) {
      return;
    }
    if (!focusNodeWindow || focusNodeWindow.mode !== WINDOW_MODES.GRAB_TILE) return;

    const nodeWinAtPointer = this.host.nodeWinAtPointer;

    if (nodeWinAtPointer) {
      const targetRect = (nodeWinAtPointer.nodeValue as Meta.Window).get_frame_rect();
      const parentNodeTarget = nodeWinAtPointer.parentNode;
      const currPointer = global.get_pointer() as unknown as [number, number];
      const horizontal = parentNodeTarget!.isHSplit() || parentNodeTarget!.isTabbed();
      const isMonParent = parentNodeTarget!.nodeType === NODE_TYPES.MONITOR;
      const isConParent = parentNodeTarget!.nodeType === NODE_TYPES.CON;
      const centerLayout = this.host.settings.get_string("dnd-center-layout").toUpperCase();
      const stacked = parentNodeTarget!.isStacked();
      const tabbed = parentNodeTarget!.isTabbed();
      const stackedOrTabbed = stacked || tabbed;

      const updatePreview = (previewTarget: Node<NodeType>, previewParams: PreviewParams) => {
        const previewHint = previewTarget.previewHint;
        const previewHintEnabled = this.host.settings.get_boolean("preview-hint-enabled");
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

      const regions = (rect: RegionRect, regionWidth: number) => {
        leftRegion = {
          x: rect.x,
          y: rect.y,
          width: rect.width * regionWidth,
          height: rect.height,
        };

        rightRegion = {
          x: rect.x + rect.width * (1 - regionWidth),
          y: rect.y,
          width: rect.width * regionWidth,
          height: rect.height,
        };

        topRegion = {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height * regionWidth,
        };

        bottomRegion = {
          x: rect.x,
          y: rect.y + rect.height * (1 - regionWidth),
          width: rect.width,
          height: rect.height * regionWidth,
        };

        centerRegion = {
          x: rect.x + rect.width * regionWidth,
          y: rect.y + rect.height * regionWidth,
          width: rect.width - rect.width * regionWidth * 2,
          height: rect.height - rect.height * regionWidth * 2,
        };

        return {
          left: leftRegion,
          right: rightRegion,
          top: topRegion,
          bottom: bottomRegion,
          center: centerRegion,
        };
      };

      let referenceNode: Node<NodeType> | null = null;
      let containerNode: Node<NodeType> | null = null;
      // Plan flags (pure — no node mutation). The apply transaction read these
      // off `childNode` historically; they now live on the plan.
      let createCon = false;
      let detachWindow = false;
      let previewParams: PreviewParams = { className: "", targetRect: null };
      let leftRegion: RegionRect;
      let rightRegion: RegionRect;
      let topRegion: RegionRect;
      let bottomRegion: RegionRect;
      let centerRegion: RegionRect;
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
              createCon = true;
              containerNode = parentNodeTarget;
              referenceNode = nodeWinAtPointer;
              previewParams = {
                className: "",
                targetRect: targetRect,
              };
            } else {
              containerNode = parentNodeTarget;
              referenceNode = null;
              const parentTargetRect = this.host.processGap(parentNodeTarget!);
              previewParams = {
                className: "",
                targetRect: parentTargetRect as RegionRect,
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
          detachWindow = true;
          if (!isMonParent) {
            referenceNode = parentNodeTarget;
            containerNode = parentNodeTarget!.parentNode;
          }
        } else {
          if (horizontal) {
            containerNode = parentNodeTarget;
            referenceNode = nodeWinAtPointer;
          } else {
            createCon = true;
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
          detachWindow = true;
          if (!isMonParent) {
            referenceNode = parentNodeTarget!.nextSibling;
            containerNode = parentNodeTarget!.parentNode;
          }
        } else {
          if (horizontal) {
            containerNode = parentNodeTarget;
            referenceNode = nodeWinAtPointer.nextSibling;
          } else {
            createCon = true;
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
          if (!isMonParent) {
            containerNode = parentNodeTarget;
            referenceNode = null;
            previewParams = {
              className: stacked ? "window-tilepreview-stacked" : "window-tilepreview-tabbed",
              targetRect: targetRect,
            };
          }
        } else {
          if (horizontal) {
            createCon = true;
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
          if (!isMonParent) {
            containerNode = parentNodeTarget;
            referenceNode = null;
            previewParams = {
              className: stacked ? "window-tilepreview-stacked" : "window-tilepreview-tabbed",
              targetRect: targetRect,
            };
          }
        } else {
          if (horizontal) {
            createCon = true;
            containerNode = parentNodeTarget;
            referenceNode = nodeWinAtPointer.nextSibling;
          } else {
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
        // Resolve the plan (pure), then delegate the single structural
        // transaction to LayoutEngine (architecture rule §2). St actor UI
        // (tab cleanup) is owned here; tree structure/percents/layouts are not.
        const previousParent = focusNodeWindow!.parentNode!;

        if (focusNodeWindow.tab) {
          const decoParent = focusNodeWindow.tab.get_parent();
          if (decoParent) decoParent.remove_child(focusNodeWindow.tab);
        }

        const centerSwap = isCenter && centerLayout == "SWAP";
        const kind = createCon
          ? "createCon"
          : detachWindow
          ? "detachWindow"
          : centerSwap
          ? "centerSwap"
          : "simpleInsert";

        // createCon only: reuse the existing parent as the con when it already
        // holds exactly the single-tile / two-tile special-case shape.
        let reuseExistingAsCon = false;
        if (createCon) {
          const numWin = parentNodeTarget!.childNodes.filter(
            (c) => c.nodeType === NODE_TYPES.WINDOW
          ).length;
          const numChild = parentNodeTarget!.childNodes.length;
          const sameNumChild = numWin === numChild;
          reuseExistingAsCon =
            !isCenter &&
            ((isConParent && numWin === 1 && sameNumChild) ||
              (isMonParent && numWin == 2 && sameNumChild));
        }

        const childLayout: string | null = !createCon
          ? null
          : isLeft || isRight
          ? LAYOUT_TYPES.HSPLIT
          : isTop || isBottom
          ? LAYOUT_TYPES.VSPLIT
          : (LAYOUT_TYPES as Record<string, string>)[centerLayout] ?? null;

        const containerLayout: string | null =
          kind !== "simpleInsert"
            ? null
            : isLeft || isRight
            ? LAYOUT_TYPES.HSPLIT
            : isTop || isBottom
            ? stackedOrTabbed
              ? null
              : LAYOUT_TYPES.VSPLIT
            : isCenter
            ? containerNode && (containerNode.isHSplit() || containerNode.isVSplit())
              ? (LAYOUT_TYPES as Record<string, string>)[centerLayout] ?? null
              : null
            : null;

        const detachOrientation =
          isLeft || isRight ? ORIENTATION_TYPES.HORIZONTAL : ORIENTATION_TYPES.VERTICAL;

        const plan: DragDropPlan = {
          focusNodeWindow,
          nodeWinAtPointer,
          parentNodeTarget: parentNodeTarget!,
          containerNode,
          referenceNode,
          previousParent,
          kind,
          isLeft,
          isRight,
          isTop,
          isBottom,
          isCenter,
          reuseExistingAsCon,
          childLayout,
          containerLayout,
          detachOrientation,
        };

        this.host.layoutEngine.applyDragDrop(plan);

        // Only the swap branch renders inline (parity with prior behavior);
        // the other placements rely on the grab-op-end render.
        if (kind === "centerSwap") {
          this.host.renderTree("drag-swap");
        }
      } else {
        updatePreview(focusNodeWindow, previewParams);
      }
    }
  }

  findNodeWindowAtPointer(focusNodeWindow: Node<NodeType>) {
    const pointerCoord = global.get_pointer() as unknown as [number, number];

    const nodeWinAtPointer = this._findNodeWindowAtPointer(
      focusNodeWindow.nodeValue as Meta.Window,
      pointerCoord
    );
    return nodeWinAtPointer;
  }

  _findNodeWindowAtPointer(metaWindow: Meta.Window, pointer: [number, number]) {
    if (!metaWindow) return undefined;

    const sortedWindows = this.host.sortedWindows;

    if (!sortedWindows) {
      Logger.warn("No sorted windows");
      return;
    }

    const w = Utils.metaWindowAtPoint(pointer, sortedWindows);
    if (w) return this.host.tree.getNodeByValue(w);

    return null;
  }

  _getDragDropCenterPreviewStyle() {
    const centerLayout = this.host.settings.get_string("dnd-center-layout");
    return `window-tilepreview-${centerLayout}`;
  }
}
