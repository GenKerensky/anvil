/*
 * PointerPolicy tests
 *
 * Tests for pointer warping, hover-focus polling, and position storage.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import Meta from "gi://Meta";
import Clutter from "gi://Clutter";
import GLib from "gi://GLib";
import { NODE_TYPES } from "../../../src/lib/extension/tree.js";
import { PointerPolicy } from "../../../src/lib/extension/pointer-policy.js";
import {
  createAnvilRuntimeFixture,
  createMockWindow,
  createTreeFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

describe("PointerPolicy", () => {
  let ctx: any;
  let policy: PointerPolicy;
  let disabled = false;
  let workspaceChanging = false;

  function createPolicy(settings: Record<string, unknown> = {}) {
    ctx = createTreeFixture({ settings, fullExtWm: true });
    policy = new PointerPolicy({
      settings: ctx.settings,
      isWorkspaceChanging: () => workspaceChanging,
      isDisabled: () => disabled,
    });
  }

  function startHoverPoll(): () => boolean {
    let poll: (() => boolean) | null = null;
    vi.mocked(GLib.timeout_add).mockImplementationOnce((_priority, _interval, callback) => {
      poll = callback as () => boolean;
      return 71;
    });
    policy.setHoverFocusEnabled(true);
    if (!poll) throw new Error("PointerPolicy did not schedule its hover poll");
    return poll;
  }

  beforeEach(() => {
    disabled = false;
    workspaceChanging = false;
    createPolicy({ "focus-on-hover-enabled": true });
  });

  describe("always-on construction (B9-2)", () => {
    it("wires PointerPolicy into the runtime graph even when pointer prefs are disabled", () => {
      policy.disable();
      const runtime = createAnvilRuntimeFixture();

      expect(runtime.anvilRuntime._pointerPolicy).toBeInstanceOf(PointerPolicy);
    });

    it("enables hover focus by scheduling the owner poll", () => {
      const timeoutAdd = vi.mocked(GLib.timeout_add);

      policy.setHoverFocusEnabled(true);

      expect(timeoutAdd).toHaveBeenCalledWith(GLib.PRIORITY_DEFAULT, 16, expect.any(Function));
    });

    it("disables hover focus by removing the scheduled owner poll", () => {
      vi.mocked(GLib.timeout_add).mockReturnValueOnce(73);
      policy.setHoverFocusEnabled(true);

      policy.setHoverFocusEnabled(false);

      expect(GLib.Source.remove).toHaveBeenCalledWith(73);
    });
  });

  describe("hover focus poll", () => {
    it("should return false when hover focus is disabled", () => {
      const poll = startHoverPoll();
      policy.setHoverFocusEnabled(false);
      expect(poll()).toBe(false);
    });

    it("should return false when disabled", () => {
      const poll = startHoverPoll();
      disabled = true;
      expect(poll()).toBe(false);
    });

    it("should return true when overview is visible", () => {
      const poll = startHoverPoll();
      Main.overview.visible = true;
      expect(poll()).toBe(true);
      Main.overview.visible = false;
    });

    it("should return true during workspace change", () => {
      const poll = startHoverPoll();
      workspaceChanging = true;
      expect(poll()).toBe(true);
    });

    it("should return true when focused window is modal dialog", () => {
      const poll = startHoverPoll();
      const dialog = createMockWindow({ window_type: Meta.WindowType.MODAL_DIALOG });
      ctx.display.get_focus_window.mockReturnValue(dialog);
      expect(poll()).toBe(true);
    });

    it("should not skip focus for normal window types", () => {
      const poll = startHoverPoll();
      const normal = createMockWindow({ window_type: Meta.WindowType.NORMAL });
      ctx.display.get_focus_window.mockReturnValue(normal);
      (global as any).get_window_actors.mockReturnValue([]);
      expect(poll()).toBe(true);
    });
  });

  describe("onFocusChanged", () => {
    it("should return early when nodeWindow is null", () => {
      expect(() => policy.onFocusChanged({ node: null, source: "command" })).not.toThrow();
    });

    it("should update lastFocusedWindow fields", () => {
      const metaWindow = createMockWindow({ wm_class: "TestApp", title: "Test" });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);

      policy.onFocusChanged({ node, source: "command" });

      expect(policy.lastFocusedWindow).toBe(node);
      expect(typeof policy.lastFocusedWindowMonitor).toBe("number");
      expect(typeof policy.lastFocusedWindowWorkspace).toBe("number");
    });

    it("should warp pointer when setting is enabled", () => {
      ctx.settings.set_boolean("move-pointer-focus-enabled", true);
      const metaWindow = createMockWindow({ rect: { x: 0, y: 0, width: 200, height: 200 } });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
      (global as any).get_pointer.mockReturnValue([500, 500, 0]);

      const seat = Clutter.get_default_backend().get_default_seat();
      (seat as any).warp_pointer.mockClear();

      policy.onFocusChanged({ node, source: "command" });

      expect(seat.warp_pointer).toHaveBeenCalledWith(100, 8);
    });

    it("should not warp pointer when setting is disabled", () => {
      ctx.settings.set_boolean("move-pointer-focus-enabled", false);
      const metaWindow = createMockWindow({ wm_class: "TestApp", title: "Test" });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);

      const seat = Clutter.get_default_backend().get_default_seat();
      (seat as any).warp_pointer.mockClear();

      policy.onFocusChanged({ node, source: "command" });

      expect(seat.warp_pointer).not.toHaveBeenCalled();
    });

    it("should use a stored pointer position when focusing a window", () => {
      ctx.settings.set_boolean("move-pointer-focus-enabled", true);
      const metaWindow = createMockWindow({ rect: { x: 0, y: 0, width: 200, height: 200 } });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
      node.pointer = { x: 30, y: 40 };
      (global as any).get_pointer.mockReturnValue([500, 500, 0]);
      const seat = Clutter.get_default_backend().get_default_seat();
      (seat as any).warp_pointer.mockClear();

      policy.onFocusChanged({ node, source: "command" });

      expect(seat.warp_pointer).toHaveBeenCalledWith(30, 40);
    });

    it("should store the previous window's pointer position during a focus change", () => {
      ctx.settings.set_boolean("move-pointer-focus-enabled", true);
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const previous = ctx.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        createMockWindow({ rect: { x: 0, y: 0, width: 200, height: 200 } })
      );
      const next = ctx.tree.createNode(
        monitor.nodeValue,
        NODE_TYPES.WINDOW,
        createMockWindow({ rect: { x: 300, y: 0, width: 200, height: 200 } })
      );
      policy.lastFocusedWindow = previous;
      (global as any).get_pointer.mockReturnValue([50, 60, 0]);

      policy.onFocusChanged({ node: next, source: "command" });

      expect(previous.pointer).toEqual({ x: 50, y: 60 });
    });

    it.each([
      {
        name: "the window is too small",
        overrides: { rect: { x: 0, y: 0, width: 4, height: 4 } },
        pointer: [500, 500, 0],
        overview: false,
      },
      {
        name: "the pointer is already inside",
        overrides: { rect: { x: 0, y: 0, width: 200, height: 200 } },
        pointer: [100, 100, 0],
        overview: false,
      },
      {
        name: "the window is minimized",
        overrides: { rect: { x: 0, y: 0, width: 200, height: 200 }, minimized: true },
        pointer: [500, 500, 0],
        overview: false,
      },
      {
        name: "the overview is visible",
        overrides: { rect: { x: 0, y: 0, width: 200, height: 200 } },
        pointer: [500, 500, 0],
        overview: true,
      },
    ])("should not warp when $name", ({ overrides, pointer, overview }) => {
      ctx.settings.set_boolean("move-pointer-focus-enabled", true);
      const metaWindow = createMockWindow(overrides);
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
      (global as any).get_pointer.mockReturnValue(pointer);
      Main.overview.visible = overview;
      const seat = Clutter.get_default_backend().get_default_seat();
      (seat as any).warp_pointer.mockClear();

      policy.onFocusChanged({ node, source: "command" });

      expect(seat.warp_pointer).not.toHaveBeenCalled();
      Main.overview.visible = false;
    });
  });

  describe("onWorkspaceSettled", () => {
    it("should return early when lastFocusedWindow is null", () => {
      policy.lastFocusedWindow = null;
      expect(() => policy.onWorkspaceSettled()).not.toThrow();
    });

    it("should not warp when monitors already match", () => {
      const metaWindow = createMockWindow({ wm_class: "TestApp", title: "Test" });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
      policy.lastFocusedWindow = node;
      policy.lastFocusedWindowMonitor = 0;
      ctx.display.get_current_monitor.mockReturnValue(0);

      const seat = Clutter.get_default_backend().get_default_seat();
      (seat as any).warp_pointer.mockClear();

      policy.onWorkspaceSettled();

      expect(seat.warp_pointer).not.toHaveBeenCalled();
    });

    it("should not warp when move-pointer-focus-enabled is disabled", () => {
      ctx.settings.set_boolean("move-pointer-focus-enabled", false);
      const metaWindow = createMockWindow({ wm_class: "TestApp", title: "Test" });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
      policy.lastFocusedWindow = node;
      policy.lastFocusedWindowMonitor = 1;
      ctx.display.get_current_monitor.mockReturnValue(0);

      const seat = Clutter.get_default_backend().get_default_seat();
      (seat as any).warp_pointer.mockClear();

      policy.onWorkspaceSettled();

      expect(seat.warp_pointer).not.toHaveBeenCalled();
    });
  });
});
