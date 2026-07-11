/**
 * DragDropTile — drag-drop tiling preview and placement logic (Stage 0).
 *
 * Moved from WindowManager.moveWindowToPointer / findNodeWindowAtPointer /
 * _findNodeWindowAtPointer / _getDragDropCenterPreviewStyle.
 *
 * Reads tree state, calls LayoutEngine.split/swapPairs + renderTree,
 * all via host callbacks. No new host interface needed beyond reusing
 * existing shapes.
 *
 * Ownership rules: `.agents/rules/architecture.md` (§2 tree structure +
 * LayoutEngine as the owner of percent/layout writes). Extraction rationale:
 * `.agents/memory/decisions.md`.
 */

import St from "gi://St";
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
import type { LayoutEngine } from "./layout-engine.js";
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

export class DragDropTile {
  constructor(private host: DragDropTileHost) {}

  /**
   * Handle previewing and applying where a drag-drop window is going to be tiled.
   */
  moveWindowToPointer(focusNodeWindow: Node<any>, preview: boolean = false) {
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
      const updatePreview = (
        focusNodeWindow: Node<any>,
        previewParams: { className: string; targetRect: any }
      ) => {
        const previewHint = focusNodeWindow.previewHint;
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
              const parentTargetRect = this.host.processGap(parentNodeTarget!);
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
          childNode.detachWindow = true;
          if (!isMonParent) {
            referenceNode = parentNodeTarget;
            containerNode = parentNodeTarget!.parentNode;
          }
        } else {
          if (horizontal) {
            containerNode = parentNodeTarget;
            referenceNode = nodeWinAtPointer;
          } else {
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
          childNode.detachWindow = true;
          if (!isMonParent) {
            referenceNode = parentNodeTarget!.nextSibling;
            containerNode = parentNodeTarget!.parentNode;
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
        this.host.layoutEngine.resetSiblingPercent(containerNode);
        this.host.layoutEngine.resetSiblingPercent(previousParent);

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
            this.host.layoutEngine.setLayout(childNode, LAYOUT_TYPES.HSPLIT);
          } else if (isTop || isBottom) {
            this.host.layoutEngine.setLayout(childNode, LAYOUT_TYPES.VSPLIT);
          } else if (isCenter) {
            this.host.layoutEngine.setLayout(
              childNode,
              (LAYOUT_TYPES as Record<string, string>)[centerLayout]
            );
          }
        } else if (childNode.detachWindow) {
          const orientation =
            isLeft || isRight ? ORIENTATION_TYPES.HORIZONTAL : ORIENTATION_TYPES.VERTICAL;
          this.host.layoutEngine.split(childNode as Node<any>, orientation);
          containerNode!.insertBefore(childNode!.parentNode!, referenceNode);
        } else if (isCenter && centerLayout == "SWAP") {
          this.host.layoutEngine.swapPairs(referenceNode!, focusNodeWindow);
          this.host.renderTree("drag-swap");
        } else {
          containerNode!.insertBefore(childNode, referenceNode);
          if (isLeft || isRight) {
            this.host.layoutEngine.setLayout(containerNode!, LAYOUT_TYPES.HSPLIT);
          } else if (isTop || isBottom) {
            if (!stackedOrTabbed)
              this.host.layoutEngine.setLayout(containerNode!, LAYOUT_TYPES.VSPLIT);
          } else if (isCenter) {
            if (containerNode!.isHSplit() || containerNode!.isVSplit()) {
              this.host.layoutEngine.setLayout(
                containerNode!,
                (LAYOUT_TYPES as Record<string, string>)[centerLayout]
              );
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
