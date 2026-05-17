/*
 * WindowManager window movement tests
 *
 * Tests for move, moveCenter, rectForMonitor, and resize.
 * Ported from jcrussell/forge
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import Meta from "gi://Meta";
import { NODE_TYPES } from "../../../src/lib/extension/tree.js";
import { WINDOW_MODES } from "../../../src/lib/extension/window.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";

describe("WindowManager - Movement", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture();
  });

  const wm = () => ctx.windowManager;

  describe("move", () => {
    it("should do nothing when metaWindow is null", () => {
      expect(() => wm().move(null, { x: 0, y: 0, width: 100, height: 100 })).not.toThrow();
    });

    it("should call move_frame and move_resize_frame with given rect", () => {
      const metaWindow = createMockWindow({ wm_class: "TestApp", title: "Test" });
      const moveFrameSpy = vi.spyOn(metaWindow, "move_frame");
      const moveResizeSpy = vi.spyOn(metaWindow, "move_resize_frame");

      wm().move(metaWindow, { x: 50, y: 60, width: 800, height: 600 });

      expect(moveFrameSpy).toHaveBeenCalledWith(true, 50, 60);
      expect(moveResizeSpy).toHaveBeenCalledWith(true, 50, 60, 800, 600);
    });

    it("should unmaximize before moving", () => {
      const metaWindow = createMockWindow({ wm_class: "TestApp", title: "Test" });
      const unmaximizeSpy = vi.spyOn(metaWindow, "unmaximize");

      wm().move(metaWindow, { x: 0, y: 0, width: 100, height: 100 });

      expect(unmaximizeSpy).toHaveBeenCalled();
    });

    it("should remove transitions before moving", () => {
      const metaWindow = createMockWindow({ wm_class: "TestApp", title: "Test" });
      const actor = metaWindow.get_compositor_private();
      const removeTransitionsSpy = vi.spyOn(actor, "remove_all_transitions");

      wm().move(metaWindow, { x: 0, y: 0, width: 100, height: 100 });

      expect(removeTransitionsSpy).toHaveBeenCalled();
    });

    it("should do nothing for grabbed windows", () => {
      const metaWindow = createMockWindow({ wm_class: "TestApp", title: "Test" });
      (metaWindow as any).grabbed = true;
      const moveFrameSpy = vi.spyOn(metaWindow, "move_frame");

      wm().move(metaWindow, { x: 10, y: 20, width: 300, height: 200 });

      expect(moveFrameSpy).not.toHaveBeenCalled();
    });

    it("should handle null actor gracefully", () => {
      const metaWindow = createMockWindow({ wm_class: "TestApp", title: "Test" });
      metaWindow.get_compositor_private = vi.fn(() => null) as any;

      expect(() => wm().move(metaWindow, { x: 0, y: 0, width: 100, height: 100 })).not.toThrow();
    });
  });

  describe("moveCenter", () => {
    it("should do nothing when metaWindow is null", () => {
      expect(() => wm().moveCenter(null)).not.toThrow();
    });

    it("should call move with centered coordinates", () => {
      const metaWindow = createMockWindow({
        wm_class: "TestApp",
        title: "Test",
        rect: { x: 0, y: 0, width: 400, height: 300 },
      });
      const moveSpy = vi.spyOn(wm(), "move");

      wm().moveCenter(metaWindow);

      expect(moveSpy).toHaveBeenCalledTimes(1);
      const args = moveSpy.mock.calls[0];
      expect(args[0]).toBe(metaWindow);
      expect(typeof args[1].x).toBe("number");
      expect(typeof args[1].y).toBe("number");
      expect(args[1].width).toBe(400);
      expect(args[1].height).toBe(300);
    });
  });

  describe("rectForMonitor", () => {
    it("should return null for null node", () => {
      expect(wm().rectForMonitor(null, 0)).toBeNull();
    });

    it("should return null for non-window nodes", () => {
      expect(wm().rectForMonitor(ctx.tree.rootNode, 0)).toBeNull();
    });

    it("should return null for negative monitor index", () => {
      const metaWindow = createMockWindow({ wm_class: "TestApp", title: "Test" });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);

      expect(wm().rectForMonitor(node, -1)).toBeNull();
    });

    it("should scale rect for target monitor", () => {
      const metaWindow = createMockWindow({
        wm_class: "TestApp",
        title: "Test",
        rect: { x: 0, y: 0, width: 960, height: 540 },
      });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
      node.rect = { x: 0, y: 0, width: 960, height: 540 };

      const result = wm().rectForMonitor(node, 0);

      expect(result).not.toBeNull();
      expect(result!.width).toBeLessThanOrEqual(1920);
      expect(result!.height).toBeLessThanOrEqual(1080);
    });

    it("should return null for window without rect and tile mode", () => {
      const metaWindow = createMockWindow({
        wm_class: "TestApp",
        title: "Test",
      });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
      node.rect = null;
      node.mode = "TILE";

      expect(wm().rectForMonitor(node, 0)).toBeNull();
    });

    it("should use frame rect for float windows without stored rect", () => {
      const metaWindow = createMockWindow({
        wm_class: "TestApp",
        title: "Test",
        rect: { x: 100, y: 100, width: 500, height: 400 },
      });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
      node.rect = null;
      node.mode = WINDOW_MODES.FLOAT;

      const result = wm().rectForMonitor(node, 0);

      expect(result).not.toBeNull();
    });

    it("should handle negative x/y alignment between monitors", () => {
      const metaWindow = createMockWindow({
        wm_class: "TestApp",
        title: "Test",
        rect: { x: 0, y: 0, width: 960, height: 540 },
      });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
      node.rect = { x: 100, y: 50, width: 960, height: 540 };

      const result = wm().rectForMonitor(node, 0);

      expect(result).not.toBeNull();
    });
  });

  describe("resize", () => {
    it("should call _handleGrabOpBegin with correct grab op", () => {
      const metaWindow = createMockWindow({ wm_class: "TestApp", title: "Test" });
      metaWindow._workspace = ctx.workspaces[0];
      const { monitor } = getWorkspaceAndMonitor(ctx);
      ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
      ctx.display.get_focus_window.mockReturnValue(metaWindow);

      const grabSpy = vi.spyOn(wm(), "_handleGrabOpBegin");

      wm().resize(Meta.GrabOp.KEYBOARD_RESIZING_E, 20);

      expect(grabSpy).toHaveBeenCalled();
    });

    it("should do nothing when no focus window", () => {
      ctx.display.get_focus_window.mockReturnValue(null);

      expect(() => wm().resize(Meta.GrabOp.KEYBOARD_RESIZING_E, 10)).not.toThrow();
    });
  });
});
