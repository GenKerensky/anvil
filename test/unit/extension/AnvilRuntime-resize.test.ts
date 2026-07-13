/*
 * AnvilRuntime resize operation tests
 *
 * Tests for resize() and WindowResize commands.
 * Ported from jcrussell/forge
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import Meta from "gi://Meta";
import St from "gi://St";
import { NODE_TYPES, LAYOUT_TYPES } from "../../../src/lib/extension/tree.js";
import { WINDOW_MODES } from "../../../src/lib/extension/window/constants.js";
import {
  createMockWindow,
  createAnvilRuntimeFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";

function setupFocusWindow(ctx: any, overrides: any = {}) {
  const metaWindow = createMockWindow({
    wm_class: "TestApp",
    title: "Test",
    ...overrides,
  });
  metaWindow._workspace = ctx.workspaces[0];
  metaWindow._monitor = 0;
  const { monitor } = getWorkspaceAndMonitor(ctx);
  ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
  ctx.display.get_focus_window.mockReturnValue(metaWindow);
  return metaWindow;
}

describe("AnvilRuntime - Resize", () => {
  let ctx: any;

  beforeEach(() => {
    ctx = createAnvilRuntimeFixture();
  });

  const wm = () => ctx.anvilRuntime;

  describe("resize - null guard", () => {
    it("should do nothing when focusMetaWindow is null", () => {
      expect(() => wm().resize(Meta.GrabOp.KEYBOARD_RESIZING_E, 10)).not.toThrow();
    });
  });

  describe("resize - right direction", () => {
    it("should increase width when resizing right", () => {
      const metaWindow = setupFocusWindow(ctx);
      const initialWidth = metaWindow.get_frame_rect().width;

      wm().resize(Meta.GrabOp.KEYBOARD_RESIZING_E, 20);

      const rect = metaWindow.get_frame_rect();
      expect(rect.width).toBe(initialWidth + 20);
    });

    it("should handle negative amount (shrink right)", () => {
      const metaWindow = setupFocusWindow(ctx);
      const initialWidth = metaWindow.get_frame_rect().width;

      wm().resize(Meta.GrabOp.KEYBOARD_RESIZING_E, -10);

      const rect = metaWindow.get_frame_rect();
      expect(rect.width).toBe(initialWidth - 10);
    });
  });

  describe("resize - left direction", () => {
    it("should increase width and shift x when resizing left", () => {
      const metaWindow = setupFocusWindow(ctx);
      const initialRect = metaWindow.get_frame_rect().copy();

      wm().resize(Meta.GrabOp.KEYBOARD_RESIZING_W, 15);

      const rect = metaWindow.get_frame_rect();
      expect(rect.width).toBe(initialRect.width + 15);
      expect(rect.x).toBe(initialRect.x - 15);
    });
  });

  describe("resize - top direction", () => {
    it("should increase height when resizing up", () => {
      const metaWindow = setupFocusWindow(ctx);
      const initialHeight = metaWindow.get_frame_rect().height;

      wm().resize(Meta.GrabOp.KEYBOARD_RESIZING_N, 15);

      const rect = metaWindow.get_frame_rect();
      expect(rect.height).toBe(initialHeight + 15);
    });
  });

  describe("resize - bottom direction", () => {
    it("should increase height and shift y when resizing down", () => {
      const metaWindow = setupFocusWindow(ctx);
      const initialRect = metaWindow.get_frame_rect().copy();

      wm().resize(Meta.GrabOp.KEYBOARD_RESIZING_S, 15);

      const rect = metaWindow.get_frame_rect();
      expect(rect.height).toBe(initialRect.height + 15);
      expect(rect.y).toBe(initialRect.y - 15);
    });
  });

  describe("resize - grab op tracking", () => {
    it("should set grabOp during resize", () => {
      const metaWindow = setupFocusWindow(ctx);

      wm().resize(Meta.GrabOp.KEYBOARD_RESIZING_E, 10);

      expect(ctx.anvilRuntime._grab.grabOp).toBe(Meta.GrabOp.KEYBOARD_RESIZING_E);
    });

    it("mirrors resize lifecycle before the legacy grab writer", () => {
      const metaWindow = setupFocusWindow(ctx);
      const shadowBegin = vi.spyOn(wm()._tilingShadow, "observeGrabBegin");
      const shadowUpdate = vi.spyOn(wm()._tilingShadow, "observeGrabUpdate");
      const shadowEnd = vi.spyOn(wm()._tilingShadow, "observeGrabEnd");
      const legacyBegin = vi.spyOn(wm()._grab, "begin");
      const legacyEnd = vi.spyOn(wm()._grab, "end");

      wm()._handleGrabOpBegin(ctx.display, metaWindow, Meta.GrabOp.RESIZING_E);
      wm()._handleGrabOpEnd(ctx.display, metaWindow, Meta.GrabOp.RESIZING_E);

      expect(shadowBegin).toHaveBeenCalledWith(metaWindow, Meta.GrabOp.RESIZING_E);
      expect(shadowBegin.mock.invocationCallOrder[0]).toBeLessThan(
        legacyBegin.mock.invocationCallOrder[0]
      );
      expect(shadowUpdate).toHaveBeenCalledWith(metaWindow);
      expect(shadowEnd).toHaveBeenCalledWith(metaWindow, false, false);
      expect(shadowEnd.mock.invocationCallOrder[0]).toBeLessThan(
        legacyEnd.mock.invocationCallOrder[0]
      );
    });

    it("mirrors live resize observations from the grab session", () => {
      const metaWindow = setupFocusWindow(ctx);
      const shadowUpdate = vi.spyOn(wm()._tilingShadow, "observeGrabUpdate");
      wm()._handleGrabOpBegin(ctx.display, metaWindow, Meta.GrabOp.RESIZING_E);

      wm()._grab.handleResizing(null);

      expect(shadowUpdate).toHaveBeenCalledWith(metaWindow);
    });

    it("mirrors moving pointer observations and the final sample before legacy commit", () => {
      const metaWindow = setupFocusWindow(ctx);
      const node = wm().findNodeWindow(metaWindow);
      node.mode = WINDOW_MODES.GRAB_TILE;
      (global as unknown as { get_pointer: ReturnType<typeof vi.fn> }).get_pointer.mockReturnValue([
        320, 240, 0,
      ]);
      const shadowMove = vi.spyOn(wm()._tilingShadow, "observeGrabMoveUpdate");
      const shadowEnd = vi.spyOn(wm()._tilingShadow, "observeGrabEnd");
      const legacyEnd = vi.spyOn(wm()._grab, "end");
      vi.spyOn(wm(), "allowDragDropTile").mockReturnValue(true);

      wm()._handleGrabOpBegin(ctx.display, metaWindow, Meta.GrabOp.MOVING);
      wm()._grab.handleMoving(node);
      wm()._handleGrabOpEnd(ctx.display, metaWindow, Meta.GrabOp.MOVING_UNCONSTRAINED);

      expect(shadowMove).toHaveBeenNthCalledWith(1, metaWindow, [320, 240], true);
      expect(shadowMove).toHaveBeenNthCalledWith(2, metaWindow, [320, 240], true);
      expect(shadowEnd).toHaveBeenCalledWith(metaWindow, false, true);
      expect(shadowEnd.mock.invocationCallOrder[0]).toBeLessThan(
        legacyEnd.mock.invocationCallOrder[0]
      );
    });

    it("cancels portable drag placement when the tile modifier is not held", () => {
      const metaWindow = setupFocusWindow(ctx);
      const node = wm().findNodeWindow(metaWindow);
      node.mode = WINDOW_MODES.GRAB_TILE;
      vi.spyOn(wm(), "allowDragDropTile").mockReturnValue(false);
      const shadowMove = vi.spyOn(wm()._tilingShadow, "observeGrabMoveUpdate");
      const shadowEnd = vi.spyOn(wm()._tilingShadow, "observeGrabEnd");

      wm()._handleGrabOpBegin(ctx.display, metaWindow, Meta.GrabOp.MOVING);
      wm()._grab.handleMoving(node);
      wm()._handleGrabOpEnd(ctx.display, metaWindow, Meta.GrabOp.MOVING_UNCONSTRAINED);

      expect(shadowMove).toHaveBeenCalledWith(metaWindow, [0, 0], false);
      expect(shadowEnd).toHaveBeenCalledWith(metaWindow, false, false);
      expect(wm()._tilingShadow.inspect().operations).toEqual([]);
    });
  });

  describe("resize - queued event", () => {
    it("should enqueue a manual-resize event", () => {
      const metaWindow = setupFocusWindow(ctx);
      const enqueue = vi.spyOn(wm()._eventScheduler, "enqueue");

      wm().resize(Meta.GrabOp.KEYBOARD_RESIZING_E, 10);

      expect(enqueue).toHaveBeenCalled();
    });
  });

  describe("WindowResize commands", () => {
    it("should dispatch WindowResizeRight command", () => {
      const grabBegin = vi.spyOn(wm()._grab, "begin");
      const metaWindow = setupFocusWindow(ctx);

      wm().command({ name: "WindowResize", direction: "Right", amount: 10 });

      // Assert through the grab-session owner, not the WM resize facade (S7).
      expect(grabBegin).toHaveBeenCalledWith(
        expect.anything(),
        metaWindow,
        Meta.GrabOp.KEYBOARD_RESIZING_E
      );
    });

    it("should dispatch WindowResizeLeft command", () => {
      const grabBegin = vi.spyOn(wm()._grab, "begin");
      const metaWindow = setupFocusWindow(ctx);

      wm().command({ name: "WindowResize", direction: "Left", amount: -10 });

      expect(grabBegin).toHaveBeenCalledWith(
        expect.anything(),
        metaWindow,
        Meta.GrabOp.KEYBOARD_RESIZING_W
      );
    });

    it("should dispatch WindowResizeTop command", () => {
      const grabBegin = vi.spyOn(wm()._grab, "begin");
      const metaWindow = setupFocusWindow(ctx);

      wm().command({ name: "WindowResize", direction: "Top", amount: 10 });

      expect(grabBegin).toHaveBeenCalledWith(
        expect.anything(),
        metaWindow,
        Meta.GrabOp.KEYBOARD_RESIZING_N
      );
    });

    it("should dispatch WindowResizeBottom command", () => {
      const grabBegin = vi.spyOn(wm()._grab, "begin");
      const metaWindow = setupFocusWindow(ctx);

      wm().command({ name: "WindowResize", direction: "Bottom", amount: -10 });

      expect(grabBegin).toHaveBeenCalledWith(
        expect.anything(),
        metaWindow,
        Meta.GrabOp.KEYBOARD_RESIZING_S
      );
    });

    it("should return early in resize when no focus window", () => {
      const spy = vi.spyOn(ctx.anvilRuntime, "move");

      wm().command({ name: "WindowResize", direction: "Right", amount: 10 });

      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe("resize - _handleResizing triggers", () => {
    it("should call _handleGrabOpBegin during resize", () => {
      const spy = vi.spyOn(ctx.anvilRuntime, "_handleGrabOpBegin");
      const metaWindow = setupFocusWindow(ctx);

      wm().resize(Meta.GrabOp.KEYBOARD_RESIZING_E, 10);

      expect(spy).toHaveBeenCalled();
    });

    it("should enqueue a manual-resize event with callback", () => {
      const metaWindow = setupFocusWindow(ctx);
      const enqueue = vi.spyOn(wm()._eventScheduler, "enqueue");

      wm().resize(Meta.GrabOp.KEYBOARD_RESIZING_E, 10);

      expect(enqueue).toHaveBeenCalledWith(
        expect.objectContaining({ name: expect.any(String), callback: expect.any(Function) }),
        expect.any(Number)
      );
    });
  });

  describe("resize - zero amount", () => {
    it("should not change geometry when amount is 0", () => {
      const metaWindow = setupFocusWindow(ctx);
      const initialRect = metaWindow.get_frame_rect();

      wm().resize(Meta.GrabOp.KEYBOARD_RESIZING_E, 0);

      const rect = metaWindow.get_frame_rect();
      expect(rect.width).toBe(initialRect.width);
      expect(rect.x).toBe(initialRect.x);
    });
  });

  describe("resize - move calls", () => {
    it("should call move with updated rect", () => {
      const spy = vi.spyOn(ctx.anvilRuntime, "move");
      const metaWindow = setupFocusWindow(ctx);

      wm().resize(Meta.GrabOp.KEYBOARD_RESIZING_E, 10);

      expect(spy).toHaveBeenCalled();
    });
  });

  describe("resize - _handleGrabOpBegin node state", () => {
    it("should set initRect and grabMode on the focused node", () => {
      const metaWindow = setupFocusWindow(ctx);
      const initialRect = metaWindow.get_frame_rect();

      wm().resize(Meta.GrabOp.KEYBOARD_RESIZING_E, 20);

      const node = wm().findNodeWindow(metaWindow);
      expect(node).not.toBeNull();
      expect(node!.initRect).not.toBeNull();
      expect(node!.initRect!.width).toBe(initialRect.width);
      expect(node!.initGrabOp).toBe(Meta.GrabOp.KEYBOARD_RESIZING_E);
      expect(node!.grabMode).toBeDefined();
    });
  });

  describe("resize - _handleGrabOpEnd", () => {
    it("should reset grabOp to NONE and clean up node state", () => {
      const metaWindow = setupFocusWindow(ctx);
      const display = ctx.display;

      wm().resize(Meta.GrabOp.KEYBOARD_RESIZING_E, 20);
      expect(wm()._grab.grabOp).toBe(Meta.GrabOp.KEYBOARD_RESIZING_E);

      wm()._handleGrabOpEnd(display, metaWindow, Meta.GrabOp.KEYBOARD_RESIZING_E);

      expect(wm()._grab.grabOp).toBe(Meta.GrabOp.NONE);
      const node = wm().findNodeWindow(metaWindow);
      expect(node!.initRect).toBeNull();
      expect(node!.grabMode).toBeNull();
    });
  });

  describe("resize - _grabCleanup", () => {
    it("should clear initRect, grabMode, and initGrabOp from node", () => {
      const metaWindow = setupFocusWindow(ctx);
      wm().resize(Meta.GrabOp.KEYBOARD_RESIZING_E, 10);

      const node = wm().findNodeWindow(metaWindow);
      expect(node!.initRect).not.toBeNull();

      wm()._grabCleanup(node);

      expect(node!.initRect).toBeNull();
      expect(node!.grabMode).toBeNull();
      expect(node!.initGrabOp).toBeNull();
    });
  });

  describe("resize - calculateGaps", () => {
    it("should return gap based on window-gap-size and window-gap-size-increment", () => {
      const metaWindow = setupFocusWindow(ctx);
      const node = wm().findNodeWindow(metaWindow);

      ctx.settings.set_uint("window-gap-size", 5);
      ctx.settings.set_uint("window-gap-size-increment", 2);

      const gap = wm().tilingRender.calculateGaps(node);
      expect(gap).toBe(10); // 5 * 2
    });
  });

  describe("resize - _startLiveResizeLoop / _stopLiveResizeLoop", () => {
    it("should stop live resize loop without throwing when not started", () => {
      expect(() => wm()._stopLiveResizeLoop()).not.toThrow();
    });
  });

  describe("_handleResizing - percent update", () => {
    function setupTwoWindows(ctx: any, win1Rect?: any, win2Rect?: any) {
      const r1 = win1Rect || { x: 0, y: 0, width: 960, height: 1080 };
      const r2 = win2Rect || { x: 960, y: 0, width: 960, height: 1080 };

      const metaWin1 = createMockWindow({
        id: 1,
        wm_class: "App1",
        title: "Win1",
        rect: r1,
      });
      const metaWin2 = createMockWindow({
        id: 2,
        wm_class: "App2",
        title: "Win2",
        rect: r2,
      });
      metaWin1._workspace = ctx.workspaces[0];
      metaWin1._monitor = 0;
      metaWin2._workspace = ctx.workspaces[0];
      metaWin2._monitor = 0;

      const { monitor } = getWorkspaceAndMonitor(ctx);
      const monRect = { x: 0, y: 0, width: 1920, height: 1080 };
      // Set internal rect via _rect to bypass actor-dependent setter
      monitor._rect = monRect;

      // Create CON node under monitor with HSPLIT layout
      const conNode = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.CON, new St.Bin());
      conNode.layout = LAYOUT_TYPES.HSPLIT;
      conNode.percent = 1.0;
      conNode._rect = monRect;

      const node1 = ctx.tree.createNode(conNode.nodeValue, NODE_TYPES.WINDOW, metaWin1);
      node1.percent = 0.5;
      node1.rect = r1;

      const node2 = ctx.tree.createNode(conNode.nodeValue, NODE_TYPES.WINDOW, metaWin2);
      node2.percent = 0.5;
      node2.rect = r2;

      ctx.display.get_focus_window.mockReturnValue(metaWin1);

      return { metaWin1, metaWin2, node1, node2, conNode };
    }

    it("should update percents after horizontal resize", () => {
      const { metaWin1, node1, node2, conNode } = setupTwoWindows(ctx);

      wm()._handleGrabOpBegin(ctx.display, metaWin1, Meta.GrabOp.RESIZING_E);

      // Resize win1 to the right by 100px using move_resize_frame (creates new rect)
      metaWin1.move_resize_frame(true, 0, 0, 1060, 1080);

      wm()._grab.handleResizing(node1);

      expect(node1.percent).not.toBe(0.5);
      expect(node2.percent).not.toBe(0.5);
      const parentW = conNode._rect.width;
      expect(node1.percent).toBeCloseTo(1060 / parentW, 3);
      expect(node2.percent).toBeCloseTo(860 / parentW, 3);
    });

    it("should persist percent after grab end", () => {
      const { metaWin1, node1, node2 } = setupTwoWindows(ctx);

      // Mock renderTree to avoid actor dependency
      vi.spyOn(wm(), "renderTree").mockImplementation(() => {});

      wm()._handleGrabOpBegin(ctx.display, metaWin1, Meta.GrabOp.RESIZING_E);

      metaWin1.move_resize_frame(true, 0, 0, 1060, 1080);
      wm()._grab.handleResizing(node1);

      const expectedPercent1 = 1060 / 1920;
      const expectedPercent2 = 860 / 1920;

      wm()._handleGrabOpEnd(ctx.display, metaWin1, Meta.GrabOp.RESIZING_E);

      expect(node1.percent).toBeCloseTo(expectedPercent1, 3);
      expect(node2.percent).toBeCloseTo(expectedPercent2, 3);

      expect(node1.initRect).toBeNull();
      expect(node1.grabMode).toBeNull();
      expect(node1.initGrabOp).toBeNull();
    });

    it("should persist percent after grab end with explicit rects check", () => {
      const { metaWin1, node1, node2 } = setupTwoWindows(ctx);

      vi.spyOn(wm(), "renderTree").mockImplementation(() => {});

      wm()._handleGrabOpBegin(ctx.display, metaWin1, Meta.GrabOp.RESIZING_E);

      metaWin1.move_resize_frame(true, 0, 0, 1060, 1080);

      wm()._grab.handleResizing(node1);

      expect(node1.percent).not.toBe(0.5);

      wm()._handleGrabOpEnd(ctx.display, metaWin1, Meta.GrabOp.RESIZING_E);

      expect(node1.percent).not.toBe(0.5);
      expect(node2.percent).not.toBe(0.5);
      expect(node1.initRect).toBeNull();
      expect(node1.grabMode).toBeNull();
    });

    it("should preserve a pointer-resized split through the grab-end render", () => {
      const { metaWin1, node1, node2 } = setupTwoWindows(ctx);
      wm()._handleGrabOpBegin(ctx.display, metaWin1, Meta.GrabOp.RESIZING_E);
      metaWin1.move_resize_frame(true, 0, 0, 1060, 1080);
      wm().updateMetaPositionSize(metaWin1, "size-changed");

      wm()._handleGrabOpEnd(ctx.display, metaWin1, Meta.GrabOp.RESIZING_E);

      expect(node1.percent).toBeCloseTo(1060 / 1920, 3);
      expect(node2.percent).toBeCloseTo(860 / 1920, 3);
      expect(metaWin1.get_frame_rect().width).toBeGreaterThan(960);
    });

    it("should update percents after vertical resize", () => {
      const { metaWin1, node1, node2, conNode } = setupTwoWindows(
        ctx,
        { x: 0, y: 0, width: 1920, height: 540 },
        { x: 0, y: 540, width: 1920, height: 540 }
      );
      conNode.layout = LAYOUT_TYPES.VSPLIT;
      conNode._rect = { x: 0, y: 0, width: 1920, height: 1080 };

      wm()._handleGrabOpBegin(ctx.display, metaWin1, Meta.GrabOp.RESIZING_S);

      metaWin1.move_resize_frame(true, 0, 0, 1920, 640);

      wm()._grab.handleResizing(node1);

      expect(node1.percent).not.toBe(0.5);
      expect(node2.percent).not.toBe(0.5);
      expect(node1.percent).toBeCloseTo(640 / 1080, 3);
      expect(node2.percent).toBeCloseTo(440 / 1080, 3);
    });

    it("should not change percent when initGrabOp is KEYBOARD_RESIZING_UNKNOWN", () => {
      const { metaWin1, node1, node2 } = setupTwoWindows(ctx);

      node1.initGrabOp = Meta.GrabOp.KEYBOARD_RESIZING_UNKNOWN;

      wm()._grab.handleResizing(node1);

      expect(node1.percent).toBe(0.5);
      expect(node2.percent).toBe(0.5);
    });

    it("should do nothing for float window", () => {
      const { metaWin1, node1, node2 } = setupTwoWindows(ctx);
      node1.mode = "FLOAT";

      wm()._grab.handleResizing(node1);

      expect(node1.percent).toBe(0.5);
      expect(node2.percent).toBe(0.5);
    });

    it("should find resize pair via opposite direction for edge window", () => {
      const { metaWin1, metaWin2, node1, node2, conNode } = setupTwoWindows(ctx);

      // Focus on the rightmost window (edge — no sibling to the right)
      ctx.display.get_focus_window.mockReturnValue(metaWin2);

      // Start grab on right edge of the rightmost window
      wm()._handleGrabOpBegin(ctx.display, metaWin2, Meta.GrabOp.KEYBOARD_RESIZING_E);

      // Mock nextVisible to return null for RIGHT direction, simulating an edge window
      // where the resize direction has no sibling. This forces the fallback to try the
      // opposite direction (LEFT), which should find Win1.
      const origNextVisible = wm().tree.nextVisible;
      vi.spyOn(wm().tree, "nextVisible").mockImplementation((node, direction) => {
        if (direction === Meta.MotionDirection.RIGHT) return null;
        return origNextVisible.call(wm().tree, node, direction);
      });

      // Simulate resize: node2 gets wider by 100px
      metaWin2.move_resize_frame(true, 960, 0, 1060, 1080);

      wm()._grab.handleResizing(node2);

      // Percents should be updated (node2 larger, node1 smaller)
      expect(node2.percent).not.toBe(0.5);
      expect(node1.percent).not.toBe(0.5);
      const parentW = conNode._rect.width;
      expect(node2.percent).toBeCloseTo(1060 / parentW, 3);
      expect(node1.percent).toBeCloseTo(860 / parentW, 3);
    });
  });
});
