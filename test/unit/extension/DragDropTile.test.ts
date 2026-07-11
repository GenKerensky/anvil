/*
 * DragDropTile unit tests
 *
 * Tests for the drag-drop tiling logic extracted from WindowManager.
 * Tests use a mock host to isolate DragDropTile from the shell runtime.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import Meta from "gi://Meta";
import { DragDropTile } from "../../../src/lib/extension/drag-drop-tile.js";
import { NODE_TYPES, LAYOUT_TYPES } from "../../../src/lib/extension/tree.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";

describe("DragDropTile", () => {
  let ctx: any;
  let dragDrop: DragDropTile;
  let mockHost: any;

  beforeEach(() => {
    ctx = createWindowManagerFixture({
      settings: {
        "dnd-center-layout": "SWAP",
        "preview-hint-enabled": true,
      },
    });

    const wm = ctx.windowManager;
    mockHost = {
      tree: ctx.tree,
      settings: ctx.windowManager.ext.settings,
      layoutEngine: wm._layout,
      nodeWinAtPointer: null,
      cancelGrab: false,
      sortedWindows: [],
      renderTree: vi.fn(),
      processGap: vi.fn((node: any) => {
        const rect = node.rect;
        return {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        };
      }),
    };

    dragDrop = new DragDropTile(mockHost);
  });

  describe("_getDragDropCenterPreviewStyle", () => {
    it("should return style based on dnd-center-layout setting", () => {
      mockHost.settings.get_string.mockReturnValue("SWAP");
      expect(dragDrop._getDragDropCenterPreviewStyle()).toBe("window-tilepreview-SWAP");
    });

    it("should return lowercase when setting is lowercase", () => {
      mockHost.settings.get_string.mockReturnValue("swap");
      expect(dragDrop._getDragDropCenterPreviewStyle()).toBe("window-tilepreview-swap");
    });
  });

  describe("_findNodeWindowAtPointer", () => {
    it("should return undefined for null metaWindow", () => {
      expect(dragDrop._findNodeWindowAtPointer(null as any, [100, 100])).toBeUndefined();
    });

    it("should return node when window found in sortedWindows", () => {
      const metaWindow = createMockWindow({ rect: { x: 0, y: 0, width: 200, height: 200 } });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const nodeWindow = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
      mockHost.sortedWindows = ctx.tree
        .getNodeByType(NODE_TYPES.WINDOW)
        .map((n: any) => n.nodeValue as Meta.Window);

      const found = dragDrop._findNodeWindowAtPointer(metaWindow, [100, 100]);
      expect(found).toBe(nodeWindow);
    });

    it("should return null when window not found in sortedWindows", () => {
      const metaWindow = createMockWindow({ rect: { x: 0, y: 0, width: 200, height: 200 } });
      mockHost.sortedWindows = [];
      expect(dragDrop._findNodeWindowAtPointer(metaWindow, [100, 100])).toBeNull();
    });
  });

  describe("moveWindowToPointer", () => {
    it("should return early when cancelGrab is true", () => {
      mockHost.cancelGrab = true;
      const node = { mode: "GRAB_TILE" };
      dragDrop.moveWindowToPointer(node as any);
      expect(mockHost.renderTree).not.toHaveBeenCalled();
    });

    it("should return early when focusNodeWindow is null", () => {
      dragDrop.moveWindowToPointer(null as any);
      expect(mockHost.renderTree).not.toHaveBeenCalled();
    });

    it("should return early when mode is not GRAB_TILE", () => {
      const node = { mode: "TILE" };
      dragDrop.moveWindowToPointer(node as any);
      expect(mockHost.renderTree).not.toHaveBeenCalled();
    });

    it("should return early when nodeWinAtPointer is null", () => {
      mockHost.nodeWinAtPointer = null;
      const node = { mode: "GRAB_TILE" };
      dragDrop.moveWindowToPointer(node as any);
      expect(mockHost.renderTree).not.toHaveBeenCalled();
    });
  });

  // S7: exercise the placement/mutation path through the owner interfaces
  // (LayoutEngine.swapPairs), not underscore helpers.
  describe("moveWindowToPointer placement (center SWAP)", () => {
    it("swaps the focus window with the target via LayoutEngine.swapPairs", () => {
      const wm = ctx.windowManager;
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const target = createMockWindow({
        id: 1,
        wm_class: "Target",
        title: "Target",
        rect: { x: 0, y: 0, width: 200, height: 200 },
      });
      const focus = createMockWindow({
        id: 2,
        wm_class: "Focus",
        title: "Focus",
        rect: { x: 0, y: 0, width: 200, height: 200 },
      });
      const targetNode = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, target);
      const focusNode = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, focus);
      focusNode.mode = "GRAB_TILE";

      // Center of the 200x200 target → SWAP path (dnd-center-layout is SWAP).
      (global as any).get_pointer = vi.fn(() => [100, 100, 0]);
      // Pointer-over hit test uses sortedWindows + metaWindowAtPoint:
      wm.sortedWindows = [target, focus];
      wm.nodeWinAtPointer = targetNode;
      target.get_frame_rect = () => ({ x: 0, y: 0, width: 200, height: 200 });

      const swapSpy = vi.spyOn(wm._layout, "swapPairs");
      const renderSpy = vi.spyOn(wm, "renderTree").mockImplementation(() => {});

      wm._dragDrop.moveWindowToPointer(focusNode, false);

      expect(swapSpy).toHaveBeenCalledWith(targetNode, focusNode);
      expect(renderSpy).toHaveBeenCalledWith("drag-swap", undefined);
    });
  });
});
