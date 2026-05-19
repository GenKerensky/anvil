/*
 * WindowManager focus/pointer tests
 *
 * Tests for focus management, pointer warping, and focus restoration.
 * Ported from jcrussell/forge
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import Meta from "gi://Meta";
import Clutter from "gi://Clutter";
import { WINDOW_MODES } from "../../../src/lib/extension/window.js";
import { NODE_TYPES, LAYOUT_TYPES } from "../../../src/lib/extension/tree.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

describe("WindowManager - Focus", () => {
  let ctx: any;

  beforeEach(() => {
    ctx = createWindowManagerFixture({ settings: { "focus-on-hover-enabled": true } });
  });

  const wm = () => ctx.windowManager;

  describe("_focusWindowUnderPointer", () => {
    it("should return false when shouldFocusOnHover is false", () => {
      wm().shouldFocusOnHover = false;
      expect(wm()._focusWindowUnderPointer()).toBe(false);
    });

    it("should return false when disabled", () => {
      wm().disabled = true;
      expect(wm()._focusWindowUnderPointer()).toBe(false);
    });

    it("should return true when overview is visible", () => {
      Main.overview.visible = true;
      expect(wm()._focusWindowUnderPointer()).toBe(true);
      Main.overview.visible = false;
    });

    it("should return true during workspace change", () => {
      wm()._workspaceChanging = true;
      expect(wm()._focusWindowUnderPointer()).toBe(true);
    });

    it("should return true when focused window is modal dialog", () => {
      const dialog = createMockWindow({ window_type: Meta.WindowType.MODAL_DIALOG });
      ctx.display.get_focus_window.mockReturnValue(dialog);
      expect(wm()._focusWindowUnderPointer()).toBe(true);
    });

    it("should not skip focus for normal window types", () => {
      const normal = createMockWindow({ window_type: Meta.WindowType.NORMAL });
      ctx.display.get_focus_window.mockReturnValue(normal);
      (global as any).get_window_actors.mockReturnValue([]);
      expect(wm()._focusWindowUnderPointer()).toBe(true);
    });
  });

  describe("_getMetaWindowAtPointer", () => {
    it("should return null when no window actors exist", () => {
      (global as any).get_window_actors.mockReturnValue([]);
      expect(wm()._getMetaWindowAtPointer([100, 100])).toBeNull();
    });

    it("should return metaWindow when pointer is inside window", () => {
      const window = createMockWindow({ rect: { x: 0, y: 0, width: 200, height: 200 } });
      (global as any).get_window_actors.mockReturnValue([{ meta_window: window }]);
      expect(wm()._getMetaWindowAtPointer([100, 100])).toBe(window);
    });

    it("should return null when pointer is outside all windows", () => {
      const window = createMockWindow({ rect: { x: 0, y: 0, width: 100, height: 100 } });
      (global as any).get_window_actors.mockReturnValue([{ meta_window: window }]);
      expect(wm()._getMetaWindowAtPointer([500, 500])).toBeNull();
    });

    it("should return topmost window when multiple windows overlap", () => {
      const bottom = createMockWindow({ rect: { x: 0, y: 0, width: 400, height: 400 }, id: 1 });
      const top = createMockWindow({ rect: { x: 0, y: 0, width: 400, height: 400 }, id: 2 });
      (global as any).get_window_actors.mockReturnValue([
        { meta_window: bottom },
        { meta_window: top },
      ]);
      expect(wm()._getMetaWindowAtPointer([100, 100])).toBe(top);
    });
  });

  describe("_findNodeWindowAtPointer", () => {
    it("should return undefined for null metaWindow", () => {
      expect(wm()._findNodeWindowAtPointer(null, [100, 100])).toBeUndefined();
    });

    it("should return node when window found in sortedWindows", () => {
      const metaWindow = createMockWindow({ rect: { x: 0, y: 0, width: 200, height: 200 } });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const nodeWindow = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
      wm().sortedWindows = ctx.tree
        .getNodeByType(NODE_TYPES.WINDOW)
        .map((n: any) => n.nodeValue as Meta.Window);

      const found = wm()._findNodeWindowAtPointer(metaWindow, [100, 100]);
      expect(found).toBe(nodeWindow);
    });

    it("should return null when window not in sortedWindows", () => {
      const metaWindow = createMockWindow({ rect: { x: 0, y: 0, width: 200, height: 200 } });
      wm().sortedWindows = [];
      expect(wm()._findNodeWindowAtPointer(metaWindow, [100, 100])).toBeNull();
    });
  });

  describe("updateStackedFocus", () => {
    it("should return early when focusNodeWindow is null", () => {
      expect(() => wm().updateStackedFocus(null)).not.toThrow();
    });

    it("should append child and queue render when layout is stacked", () => {
      const metaWindow = createMockWindow({ wm_class: "TestApp", title: "Test" });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
      node.parentNode.layout = LAYOUT_TYPES.STACKED;
      const appendSpy = vi.spyOn(node.parentNode, "appendChild");
      const queueSpy = vi.spyOn(wm(), "queueEvent");

      wm().updateStackedFocus(node);

      expect(appendSpy).toHaveBeenCalledWith(node);
      expect(queueSpy).toHaveBeenCalled();
    });

    it("should do nothing when layout is not stacked", () => {
      const metaWindow = createMockWindow({ wm_class: "TestApp", title: "Test" });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
      const appendSpy = vi.spyOn(node.parentNode, "appendChild");

      wm().updateStackedFocus(node);

      expect(appendSpy).not.toHaveBeenCalled();
    });

    it("should do nothing when render is frozen", () => {
      const metaWindow = createMockWindow({ wm_class: "TestApp", title: "Test" });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
      node.parentNode.layout = LAYOUT_TYPES.STACKED;
      wm()._freezeRender = true;
      const appendSpy = vi.spyOn(node.parentNode, "appendChild");

      wm().updateStackedFocus(node);

      expect(appendSpy).not.toHaveBeenCalled();
    });
  });

  describe("updateTabbedFocus", () => {
    it("should return early when focusNodeWindow is null", () => {
      expect(() => wm().updateTabbedFocus(null)).not.toThrow();
    });

    it("should call safeRaise when layout is tabbed", () => {
      const metaWindow = createMockWindow({ wm_class: "TestApp", title: "Test" });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
      node.parentNode.layout = LAYOUT_TYPES.TABBED;

      const raiseSpy = vi.spyOn(metaWindow, "raise");

      wm().updateTabbedFocus(node);

      expect(raiseSpy).toHaveBeenCalled();
    });

    it("should do nothing when layout is not tabbed", () => {
      const metaWindow = createMockWindow({ wm_class: "TestApp", title: "Test" });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
      const raiseSpy = vi.spyOn(metaWindow, "raise");

      wm().updateTabbedFocus(node);

      expect(raiseSpy).not.toHaveBeenCalled();
    });
  });

  describe("_restoreFocusAfterWindowClosed", () => {
    it("should return early when closedNodeWindow is null", () => {
      expect(() => wm()._restoreFocusAfterWindowClosed(null)).not.toThrow();
    });

    it("should focus sibling window when available", () => {
      const metaWindow1 = createMockWindow({ id: 1, wm_class: "App1", title: "Win1" });
      const metaWindow2 = createMockWindow({ id: 2, wm_class: "App2", title: "Win2" });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const node1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow1);
      ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow2);

      const raiseSpy = vi.spyOn(metaWindow2, "raise");
      const focusSpy = vi.spyOn(metaWindow2, "focus");

      wm()._restoreFocusAfterWindowClosed(node1);

      expect(raiseSpy).toHaveBeenCalled();
      expect(focusSpy).toHaveBeenCalled();
    });

    it("should fall back to workspace windows when no siblings", () => {
      const metaWindow = createMockWindow({ wm_class: "TestApp", title: "Test" });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);

      const metaWindowWs = createMockWindow({ id: 99, wm_class: "Other", title: "Other" });
      ctx.workspaces[0]._windows = [metaWindowWs];

      const raiseSpy = vi.spyOn(metaWindowWs, "raise");
      wm()._restoreFocusAfterWindowClosed(node);
      expect(raiseSpy).toHaveBeenCalled();
    });

    it("should do nothing when there are no windows on workspace", () => {
      const metaWindow = createMockWindow({ wm_class: "TestApp", title: "Test" });
      ctx.workspaces[0]._windows = [];

      const node = ctx.tree.createNode(ctx.tree.rootNode, NODE_TYPES.WINDOW, metaWindow);

      expect(() => wm()._restoreFocusAfterWindowClosed(node)).not.toThrow();
    });
  });

  describe("movePointerWith", () => {
    it("should return early when nodeWindow is null", () => {
      expect(() => wm().movePointerWith(null)).not.toThrow();
    });

    it("should update lastFocusedWindow fields", () => {
      const metaWindow = createMockWindow({ wm_class: "TestApp", title: "Test" });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);

      wm().movePointerWith(node);

      expect(wm().lastFocusedWindow).toBe(node);
      expect(typeof wm().lastFocusedWindowMonitor).toBe("number");
      expect(typeof wm().lastFocusedWindowWorkspace).toBe("number");
    });

    it("should warp pointer when setting is enabled", () => {
      ctx.settings.set_boolean("move-pointer-focus-enabled", true);
      const metaWindow = createMockWindow({ rect: { x: 0, y: 0, width: 200, height: 200 } });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
      // Place pointer outside the window so canMovePointerInsideNodeWindow returns true
      (global as any).get_pointer.mockReturnValue([500, 500, 0]);

      const warpSpy = vi.spyOn(wm(), "warpPointerToNodeWindow");

      wm().movePointerWith(node);

      expect(warpSpy).toHaveBeenCalledWith(node);
    });

    it("should not warp pointer when setting is disabled", () => {
      ctx.settings.set_boolean("move-pointer-focus-enabled", false);
      const metaWindow = createMockWindow({ wm_class: "TestApp", title: "Test" });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);

      const warpSpy = vi.spyOn(wm(), "warpPointerToNodeWindow");

      wm().movePointerWith(node);

      expect(warpSpy).not.toHaveBeenCalled();
    });

    it("should warp with force flag regardless of setting", () => {
      ctx.settings.set_boolean("move-pointer-focus-enabled", false);
      const metaWindow = createMockWindow({ rect: { x: 0, y: 0, width: 200, height: 200 } });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
      // Place pointer outside the window so canMovePointerInsideNodeWindow returns true
      (global as any).get_pointer.mockReturnValue([500, 500, 0]);

      const warpSpy = vi.spyOn(wm(), "warpPointerToNodeWindow");

      wm().movePointerWith(node, { force: true });

      expect(warpSpy).toHaveBeenCalledWith(node);
    });
  });

  describe("canMovePointerInsideNodeWindow", () => {
    it("should return false for null node", () => {
      expect(wm().canMovePointerInsideNodeWindow(null)).toBe(false);
    });

    it("should return false for very small windows", () => {
      const metaWindow = createMockWindow({ rect: { x: 0, y: 0, width: 4, height: 4 } });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);

      expect(wm().canMovePointerInsideNodeWindow(node)).toBe(false);
    });

    it("should return false when pointer is inside the window", () => {
      const metaWindow = createMockWindow({ rect: { x: 0, y: 0, width: 200, height: 200 } });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
      (global as any).get_pointer.mockReturnValue([100, 100, 0]);

      expect(wm().canMovePointerInsideNodeWindow(node)).toBe(false);
    });

    it("should return false for minimized windows", () => {
      const metaWindow = createMockWindow({
        rect: { x: 0, y: 0, width: 200, height: 200 },
        minimized: true,
      });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
      (global as any).get_pointer.mockReturnValue([500, 500, 0]);

      expect(wm().canMovePointerInsideNodeWindow(node)).toBe(false);
    });

    it("should return false when overview is visible", () => {
      const metaWindow = createMockWindow({ rect: { x: 0, y: 0, width: 200, height: 200 } });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
      (global as any).get_pointer.mockReturnValue([500, 500, 0]);
      Main.overview.visible = true;

      expect(wm().canMovePointerInsideNodeWindow(node)).toBe(false);
      Main.overview.visible = false;
    });
  });

  describe("storePointerLastPosition", () => {
    it("should store position when pointer is inside window", () => {
      const metaWindow = createMockWindow({ rect: { x: 0, y: 0, width: 200, height: 200 } });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
      (global as any).get_pointer.mockReturnValue([50, 60, 0]);

      wm().storePointerLastPosition(node);

      expect(node.pointer).toEqual({ x: 50, y: 60 });
    });

    it("should not store position when pointer is outside window", () => {
      const metaWindow = createMockWindow({ rect: { x: 0, y: 0, width: 100, height: 100 } });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
      (global as any).get_pointer.mockReturnValue([500, 500, 0]);

      wm().storePointerLastPosition(node);

      expect(node.pointer).toBeNull();
    });
  });

  describe("getPointerPositionInside", () => {
    it("should return null for null node", () => {
      expect(wm().getPointerPositionInside(null)).toBeNull();
    });

    it("should use stored pointer position when available", () => {
      const metaWindow = createMockWindow({ rect: { x: 0, y: 0, width: 200, height: 200 } });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
      node.pointer = { x: 30, y: 40 };

      const result = wm().getPointerPositionInside(node);

      expect(result).toEqual({ x: 30, y: 40 });
    });

    it("should default to center/8 when no stored pointer", () => {
      const metaWindow = createMockWindow({ rect: { x: 0, y: 0, width: 200, height: 200 } });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);

      const result = wm().getPointerPositionInside(node);

      expect(result.x).toBe(100);
      expect(result.y).toBe(8);
    });
  });

  describe("refocusPointerMonitor", () => {
    it("should return early when lastFocusedWindow is null", () => {
      wm().lastFocusedWindow = null;
      expect(() => wm().refocusPointerMonitor()).not.toThrow();
    });

    it("should not warp when monitors already match", () => {
      const metaWindow = createMockWindow({ wm_class: "TestApp", title: "Test" });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
      wm().lastFocusedWindow = node;
      wm().lastFocusedWindowMonitor = 0;
      ctx.display.get_current_monitor.mockReturnValue(0);

      // Reset warp_pointer calls accumulated from other tests
      const seat = Clutter.get_default_backend().get_default_seat();
      (seat as any).warp_pointer.mockClear();

      wm().refocusPointerMonitor();

      expect(seat.warp_pointer).not.toHaveBeenCalled();
    });
  });
});
