/*
 * DragDropTile unit tests
 *
 * Tests for the drag-drop tiling logic extracted from WindowManager.
 * Tests use a mock host to isolate DragDropTile from the shell runtime.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import St from "gi://St";
import Meta from "gi://Meta";
import { DragDropTile } from "../../../src/lib/extension/drag-drop-tile.js";
import { WINDOW_MODES } from "../../../src/lib/extension/window.js";
import { Node, NODE_TYPES, LAYOUT_TYPES } from "../../../src/lib/extension/tree.js";
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

  // S7: exercise the placement/mutation path through the module interface
  // (the `dragDrop` test subject + `mockHost`), NOT the private `wm._dragDrop`
  // composition seam. The structural transaction is delegated to LayoutEngine
  // (S1), so these cases verify owner behavior via `mockHost.layoutEngine`.
  describe("moveWindowToPointer placement (via module interface, S7)", () => {
    function makeWindow(
      id: number,
      title: string,
      rect: { x: number; y: number; width: number; height: number }
    ) {
      const w = createMockWindow({
        id,
        wm_class: title,
        title,
        rect,
      });
      w.get_frame_rect = () => ({ ...rect });
      return w;
    }

    function grabWindow(node: any) {
      node.mode = WINDOW_MODES.GRAB_TILE;
      return node;
    }

    it("center SWAP swaps the focus window with the target via LayoutEngine.swapPairs", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const target = makeWindow(1, "Target", { x: 0, y: 0, width: 200, height: 200 });
      const focus = makeWindow(2, "Focus", { x: 0, y: 0, width: 200, height: 200 });
      const targetNode = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, target);
      const focusNode = grabWindow(
        ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, focus)
      );

      (global as any).get_pointer = vi.fn(() => [100, 100, 0]); // center
      mockHost.sortedWindows = [target, focus];
      mockHost.nodeWinAtPointer = targetNode;

      const swapSpy = vi.spyOn(mockHost.layoutEngine, "swapPairs");

      dragDrop.moveWindowToPointer(focusNode, false);

      expect(swapSpy).toHaveBeenCalledWith(targetNode, focusNode);
      // Only the swap branch renders inline.
      expect(mockHost.renderTree).toHaveBeenCalledWith("drag-swap");
    });

    it("createCon drop-left creates a new container holding the target + focus, owned by LayoutEngine", () => {
      // Target sits under a VSPLIT MONITOR (non-horizontal) so a left drop on
      // a single target window routes through the createCon branch — and the
      // count special-case does NOT reuse the parent (numWin != 2), so a fresh
      // CON is created. Focus lives under a different monitor sibling so it is
      // not counted in the target's parent.
      const { monitor } = getWorkspaceAndMonitor(ctx);
      monitor.layout = LAYOUT_TYPES.VSPLIT; // non-horizontal → createCon

      const target = makeWindow(1, "Target", { x: 0, y: 0, width: 200, height: 200 });
      const targetNode = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, target);

      // Focus window under a sibling monitor on another workspace so it is not
      // counted in the target parent's child counts.
      const focus = makeWindow(2, "Focus", { x: 0, y: 0, width: 200, height: 200 });
      const focusNode = grabWindow(new Node(NODE_TYPES.WINDOW, focus));
      focusNode.mode = WINDOW_MODES.GRAB_TILE;
      // Give focus a throwaway parent so `previousParent` is defined.
      const dummyCon = new Node(NODE_TYPES.CON, new St.Bin());
      dummyCon.appendChild(focusNode);

      (global as any).get_pointer = vi.fn(() => [50, 100, 0]); // left region
      mockHost.sortedWindows = [target, focus];
      mockHost.nodeWinAtPointer = targetNode;

      const setLayoutSpy = vi.spyOn(mockHost.layoutEngine, "setLayout");

      dragDrop.moveWindowToPointer(focusNode, false);

      // A new CON now contains both target and focus (target moved in, focus
      // inserted before it because left drop).
      const newCon = targetNode.parentNode;
      expect(newCon?.nodeType).toBe(NODE_TYPES.CON);
      expect(newCon?.childNodes).toContain(targetNode);
      expect(newCon?.childNodes).toContain(focusNode);
      // Left drop → HSPLIT on the new con.
      expect(setLayoutSpy).toHaveBeenCalledWith(newCon, LAYOUT_TYPES.HSPLIT);
    });

    it("detachWindow drop-left on a tabbed container calls LayoutEngine.split", () => {
      // Target's parent is a TABBED CON (stackedOrTabbed, non-monitor): left drop
      // sets the detachWindow plan and splits the focus window.
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const tabbedCon = new Node(NODE_TYPES.CON, new St.Bin());
      tabbedCon.layout = LAYOUT_TYPES.TABBED;
      tabbedCon.settings = ctx.windowManager.ext.settings;
      monitor.childNodes[0] = tabbedCon;
      tabbedCon.parentNode = monitor;

      const target = makeWindow(1, "Target", { x: 0, y: 0, width: 200, height: 200 });
      const targetNode = ctx.tree.createNode(tabbedCon.nodeValue, NODE_TYPES.WINDOW, target);

      const focus = makeWindow(2, "Focus", { x: 0, y: 0, width: 200, height: 200 });
      const focusNode = grabWindow(new Node(NODE_TYPES.WINDOW, focus));
      const dummyCon = new Node(NODE_TYPES.CON, new St.Bin());
      dummyCon.appendChild(focusNode);

      (global as any).get_pointer = vi.fn(() => [50, 100, 0]); // left region
      mockHost.sortedWindows = [target, focus];
      mockHost.nodeWinAtPointer = targetNode;

      const splitSpy = vi.spyOn(mockHost.layoutEngine, "split");

      dragDrop.moveWindowToPointer(focusNode, false);

      expect(splitSpy).toHaveBeenCalled();
    });

    it("simpleInsert drop-center (non-SWAP layout) appends the focus window to the container", () => {
      // dnd-center-layout is SWAP by default; switch it to HSPLIT so a center
      // drop on a non-stacked/tabbed container routes to simpleInsert.
      mockHost.settings.get_string.mockReturnValue("HSPLIT");

      const { monitor } = getWorkspaceAndMonitor(ctx);
      const con = new Node(NODE_TYPES.CON, new St.Bin());
      con.layout = LAYOUT_TYPES.HSPLIT;
      con.settings = ctx.windowManager.ext.settings;
      monitor.childNodes[0] = con;
      con.parentNode = monitor;

      const target = makeWindow(1, "Target", { x: 0, y: 0, width: 200, height: 200 });
      const targetNode = ctx.tree.createNode(con.nodeValue, NODE_TYPES.WINDOW, target);

      const focus = makeWindow(2, "Focus", { x: 0, y: 0, width: 200, height: 200 });
      const focusNode = grabWindow(new Node(NODE_TYPES.WINDOW, focus));
      const dummyCon = new Node(NODE_TYPES.CON, new St.Bin());
      dummyCon.appendChild(focusNode);

      (global as any).get_pointer = vi.fn(() => [100, 100, 0]); // center
      mockHost.sortedWindows = [target, focus];
      mockHost.nodeWinAtPointer = targetNode;
      mockHost.processGap = vi.fn(() => ({ x: 0, y: 0, width: 200, height: 200 }));

      dragDrop.moveWindowToPointer(focusNode, false);

      // simpleInsert: focus appended into the container (its parent is now `con`).
      expect(focusNode.parentNode).toBe(con);
      expect(con.childNodes).toContain(focusNode);
    });
  });
});
