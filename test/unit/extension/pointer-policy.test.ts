/*
 * PointerPolicy tests
 *
 * Tests for pointer warping, hover-focus polling, and position storage.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import Meta from "gi://Meta";
import Clutter from "gi://Clutter";
import { NODE_TYPES } from "../../../src/lib/extension/tree.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

describe("PointerPolicy", () => {
  let ctx: any;

  beforeEach(() => {
    ctx = createWindowManagerFixture({ settings: { "focus-on-hover-enabled": true } });
  });

  const wm = () => ctx.windowManager;
  const pointerPolicy = () => wm().pointerPolicy!;

  describe("always-on construction (B9-2)", () => {
    it("constructs PointerPolicy even when pointer prefs are disabled", () => {
      ctx = createWindowManagerFixture();
      expect(wm().pointerPolicy).not.toBeNull();
      expect(wm().shouldFocusOnHover).toBe(false);
    });

    it("enables hover focus via shouldFocusOnHover without recreating", () => {
      ctx = createWindowManagerFixture();
      const policy = wm().pointerPolicy;
      expect(policy).not.toBeNull();

      wm().shouldFocusOnHover = true;

      expect(wm().pointerPolicy).toBe(policy);
      expect(wm().shouldFocusOnHover).toBe(true);
    });

    it("disables hover focus without destroying PointerPolicy", () => {
      ctx = createWindowManagerFixture({ settings: { "focus-on-hover-enabled": true } });
      expect(wm().pointerPolicy).not.toBeNull();
      const policy = wm().pointerPolicy;

      ctx.settings.set_boolean("focus-on-hover-enabled", false);
      wm().shouldFocusOnHover = false;

      expect(wm().pointerPolicy).toBe(policy);
      expect(wm().shouldFocusOnHover).toBe(false);
    });
  });

  describe("runHoverFocusPoll", () => {
    it("should return false when hover focus is disabled", () => {
      wm().shouldFocusOnHover = false;
      expect(pointerPolicy().runHoverFocusPoll()).toBe(false);
    });

    it("should return false when disabled", () => {
      wm().disabled = true;
      expect(pointerPolicy().runHoverFocusPoll()).toBe(false);
    });

    it("should return true when overview is visible", () => {
      Main.overview.visible = true;
      expect(pointerPolicy().runHoverFocusPoll()).toBe(true);
      Main.overview.visible = false;
    });

    it("should return true during workspace change", () => {
      wm()._workspaceChanging = true;
      expect(pointerPolicy().runHoverFocusPoll()).toBe(true);
    });

    it("should return true when focused window is modal dialog", () => {
      const dialog = createMockWindow({ window_type: Meta.WindowType.MODAL_DIALOG });
      ctx.display.get_focus_window.mockReturnValue(dialog);
      expect(pointerPolicy().runHoverFocusPoll()).toBe(true);
    });

    it("should not skip focus for normal window types", () => {
      const normal = createMockWindow({ window_type: Meta.WindowType.NORMAL });
      ctx.display.get_focus_window.mockReturnValue(normal);
      (global as any).get_window_actors.mockReturnValue([]);
      expect(pointerPolicy().runHoverFocusPoll()).toBe(true);
    });
  });

  describe("onFocusChanged", () => {
    it("should return early when nodeWindow is null", () => {
      expect(() => pointerPolicy().onFocusChanged({ node: null, source: "command" })).not.toThrow();
    });

    it("should update lastFocusedWindow fields", () => {
      const metaWindow = createMockWindow({ wm_class: "TestApp", title: "Test" });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);

      pointerPolicy().onFocusChanged({ node, source: "command" });

      expect(pointerPolicy().lastFocusedWindow).toBe(node);
      expect(typeof pointerPolicy().lastFocusedWindowMonitor).toBe("number");
      expect(typeof pointerPolicy().lastFocusedWindowWorkspace).toBe("number");
    });

    it("should warp pointer when setting is enabled", () => {
      ctx.settings.set_boolean("move-pointer-focus-enabled", true);
      const metaWindow = createMockWindow({ rect: { x: 0, y: 0, width: 200, height: 200 } });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
      (global as any).get_pointer.mockReturnValue([500, 500, 0]);

      const seat = Clutter.get_default_backend().get_default_seat();
      (seat as any).warp_pointer.mockClear();

      pointerPolicy().onFocusChanged({ node, source: "command" });

      expect(seat.warp_pointer).toHaveBeenCalled();
    });

    it("should not warp pointer when setting is disabled", () => {
      ctx.settings.set_boolean("move-pointer-focus-enabled", false);
      const metaWindow = createMockWindow({ wm_class: "TestApp", title: "Test" });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);

      const seat = Clutter.get_default_backend().get_default_seat();
      (seat as any).warp_pointer.mockClear();

      pointerPolicy().onFocusChanged({ node, source: "command" });

      expect(seat.warp_pointer).not.toHaveBeenCalled();
    });
  });

  describe("canWarpToNode", () => {
    it("should return false for null node", () => {
      expect(pointerPolicy().canWarpToNode(null)).toBe(false);
    });

    it("should return false for very small windows", () => {
      const metaWindow = createMockWindow({ rect: { x: 0, y: 0, width: 4, height: 4 } });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);

      expect(pointerPolicy().canWarpToNode(node)).toBe(false);
    });

    it("should return false when pointer is inside the window", () => {
      const metaWindow = createMockWindow({ rect: { x: 0, y: 0, width: 200, height: 200 } });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
      (global as any).get_pointer.mockReturnValue([100, 100, 0]);

      expect(pointerPolicy().canWarpToNode(node)).toBe(false);
    });

    it("should return false for minimized windows", () => {
      const metaWindow = createMockWindow({
        rect: { x: 0, y: 0, width: 200, height: 200 },
        minimized: true,
      });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
      (global as any).get_pointer.mockReturnValue([500, 500, 0]);

      expect(pointerPolicy().canWarpToNode(node)).toBe(false);
    });

    it("should return false when overview is visible", () => {
      const metaWindow = createMockWindow({ rect: { x: 0, y: 0, width: 200, height: 200 } });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
      (global as any).get_pointer.mockReturnValue([500, 500, 0]);
      Main.overview.visible = true;

      expect(pointerPolicy().canWarpToNode(node)).toBe(false);
      Main.overview.visible = false;
    });
  });

  describe("storePointerLastPosition", () => {
    it("should store position when pointer is inside window", () => {
      const metaWindow = createMockWindow({ rect: { x: 0, y: 0, width: 200, height: 200 } });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
      (global as any).get_pointer.mockReturnValue([50, 60, 0]);

      pointerPolicy().storePointerLastPosition(node);

      expect(node.pointer).toEqual({ x: 50, y: 60 });
    });

    it("should not store position when pointer is outside window", () => {
      const metaWindow = createMockWindow({ rect: { x: 0, y: 0, width: 100, height: 100 } });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
      (global as any).get_pointer.mockReturnValue([500, 500, 0]);

      pointerPolicy().storePointerLastPosition(node);

      expect(node.pointer).toBeNull();
    });
  });

  describe("getPointerPositionInside", () => {
    it("should return null for null node", () => {
      expect(pointerPolicy().getPointerPositionInside(null)).toBeNull();
    });

    it("should use stored pointer position when available", () => {
      const metaWindow = createMockWindow({ rect: { x: 0, y: 0, width: 200, height: 200 } });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
      node.pointer = { x: 30, y: 40 };

      const result = pointerPolicy().getPointerPositionInside(node);

      expect(result).toEqual({ x: 30, y: 40 });
    });

    it("should default to center/8 when no stored pointer", () => {
      const metaWindow = createMockWindow({ rect: { x: 0, y: 0, width: 200, height: 200 } });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);

      const result = pointerPolicy().getPointerPositionInside(node);

      expect(result.x).toBe(100);
      expect(result.y).toBe(8);
    });
  });

  describe("onWorkspaceSettled", () => {
    it("should return early when lastFocusedWindow is null", () => {
      pointerPolicy().lastFocusedWindow = null;
      expect(() => pointerPolicy().onWorkspaceSettled()).not.toThrow();
    });

    it("should not warp when monitors already match", () => {
      const metaWindow = createMockWindow({ wm_class: "TestApp", title: "Test" });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
      pointerPolicy().lastFocusedWindow = node;
      pointerPolicy().lastFocusedWindowMonitor = 0;
      ctx.display.get_current_monitor.mockReturnValue(0);

      const seat = Clutter.get_default_backend().get_default_seat();
      (seat as any).warp_pointer.mockClear();

      pointerPolicy().onWorkspaceSettled();

      expect(seat.warp_pointer).not.toHaveBeenCalled();
    });

    it("should not warp when move-pointer-focus-enabled is disabled", () => {
      ctx.settings.set_boolean("move-pointer-focus-enabled", false);
      const metaWindow = createMockWindow({ wm_class: "TestApp", title: "Test" });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
      pointerPolicy().lastFocusedWindow = node;
      pointerPolicy().lastFocusedWindowMonitor = 1;
      ctx.display.get_current_monitor.mockReturnValue(0);

      const seat = Clutter.get_default_backend().get_default_seat();
      (seat as any).warp_pointer.mockClear();

      pointerPolicy().onWorkspaceSettled();

      expect(seat.warp_pointer).not.toHaveBeenCalled();
    });
  });
});
