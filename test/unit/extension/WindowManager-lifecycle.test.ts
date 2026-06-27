/*
 * WindowManager lifecycle tests
 *
 * Tests for trackWindow, _validWindow, windowDestroy, minimizedWindow,
 * and postProcessWindow
 * Ported from jcrussell/forge
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import GLib from "gi://GLib";
import Meta from "gi://Meta";
import { WINDOW_MODES } from "../../../src/lib/extension/window.js";
import { NODE_TYPES } from "../../../src/lib/extension/tree.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";

describe("WindowManager - Lifecycle", () => {
  let ctx: any;

  beforeEach(() => {
    ctx = createWindowManagerFixture();
  });

  const wm = () => ctx.windowManager;
  const configMgr = () => ctx.configMgr;

  describe("_validWindow", () => {
    it("should accept NORMAL windows", () => {
      const window = createMockWindow({ window_type: Meta.WindowType.NORMAL });
      expect(wm()._validWindow(window)).toBe(true);
    });

    it("should accept DIALOG windows", () => {
      const window = createMockWindow({ window_type: Meta.WindowType.DIALOG });
      expect(wm()._validWindow(window)).toBe(true);
    });

    it("should accept MODAL_DIALOG windows", () => {
      const window = createMockWindow({ window_type: Meta.WindowType.MODAL_DIALOG });
      expect(wm()._validWindow(window)).toBe(true);
    });

    it("should reject UTILITY windows", () => {
      const window = createMockWindow({ window_type: Meta.WindowType.UTILITY });
      expect(wm()._validWindow(window)).toBe(false);
    });

    it("should reject POPUP_MENU windows", () => {
      const window = createMockWindow({ window_type: Meta.WindowType.POPUP_MENU });
      expect(wm()._validWindow(window)).toBe(false);
    });

    it("should reject DROPDOWN_MENU windows", () => {
      const window = createMockWindow({ window_type: Meta.WindowType.DROPDOWN_MENU });
      expect(wm()._validWindow(window)).toBe(false);
    });

    it("should reject TOOLTIP windows", () => {
      const window = createMockWindow({ window_type: Meta.WindowType.TOOLTIP });
      expect(wm()._validWindow(window)).toBe(false);
    });

    it("should reject XWayland Video Bridge windows", () => {
      const window = createMockWindow({
        wm_class: "xwaylandvideobridge",
        title: "Video Bridge",
      });
      expect(wm()._validWindow(window)).toBe(false);
    });

    it("should reject ddterm windows", () => {
      const window = createMockWindow({
        wm_class: "ddterm",
        title: "ddterm",
      });
      expect(wm()._validWindow(window)).toBe(false);
    });

    it("should reject XWayland Video Bridge case-insensitively", () => {
      const window = createMockWindow({
        wm_class: "XWaylandVideoBridge",
        title: "Video Bridge",
      });
      expect(wm()._validWindow(window)).toBe(false);
    });
  });

  describe("minimizedWindow", () => {
    it("should return true for minimized window", () => {
      const metaWindow = createMockWindow({ minimized: true });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const nodeWindow = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);

      expect(wm().minimizedWindow(nodeWindow)).toBe(true);
    });

    it("should return false for non-minimized window", () => {
      const metaWindow = createMockWindow({ minimized: false });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const nodeWindow = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);

      expect(wm().minimizedWindow(nodeWindow)).toBe(false);
    });

    it("should return false for null node", () => {
      expect(wm().minimizedWindow(null)).toBe(false);
    });

    it("should return false for non-window nodes", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);

      expect(wm().minimizedWindow(monitor)).toBe(false);
    });
  });

  describe("postProcessWindow", () => {
    it("should do nothing for null node", () => {
      expect(() => wm().postProcessWindow(null)).not.toThrow();
    });

    it("should move pointer to window node", () => {
      const pointerSpy = vi.spyOn(wm(), "notifyFocusChanged").mockImplementation(() => {});
      const metaWindow = createMockWindow({
        wm_class: "TestApp",
        title: "Test Window",
      });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const nodeWindow = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);

      wm().postProcessWindow(nodeWindow);

      expect(pointerSpy).toHaveBeenCalledWith(nodeWindow, "window-create");
    });
  });

  describe("windowDestroy", () => {
    it("should clean up border and remove node from tree", () => {
      const metaWindow = createMockWindow({ wm_class: "TestApp", title: "Test" });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const nodeWindow = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);

      expect(ctx.tree.findNode(metaWindow)).not.toBeNull();

      const actor = metaWindow.get_compositor_private();
      wm().windowDestroy(actor);

      expect(ctx.tree.findNode(metaWindow)).toBeNull();
    });

    it("should remove float override on destroy", () => {
      const metaWindow = createMockWindow({ wm_class: "TestApp", title: "Test" });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);

      configMgr().windowProps.overrides = [{ wmClass: "TestApp", mode: "float" }];
      const removeSpy = vi.spyOn(wm(), "removeFloatOverride");

      const actor = metaWindow.get_compositor_private();
      wm().windowDestroy(actor);

      expect(removeSpy).toHaveBeenCalledWith(metaWindow, true);
    });

    it("should restore focus if destroyed window had focus", () => {
      const metaWindow1 = createMockWindow({
        id: 1,
        wm_class: "App1",
        title: "Window 1",
      });
      const metaWindow2 = createMockWindow({
        id: 2,
        wm_class: "App2",
        title: "Window 2",
      });

      const { monitor } = getWorkspaceAndMonitor(ctx);
      ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow1);
      ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow2);

      ctx.display.get_focus_window.mockReturnValue(metaWindow1);

      const actor = metaWindow1.get_compositor_private();
      wm().windowDestroy(actor);

      expect(ctx.tree.findNode(metaWindow1)).toBeNull();
    });

    it("should not renderTree when destroying an ephemeral helper window", () => {
      const metaWindow = createMockWindow({
        wm_class: "wl-clipboard",
        title: "wl-clipboard",
        rect: { x: 640, y: 416, width: 1, height: 1 },
      });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);

      const renderSpy = vi.spyOn(wm(), "renderTree").mockImplementation(() => {});
      wm().windowDestroy(metaWindow.get_compositor_private());

      expect(renderSpy).not.toHaveBeenCalled();
    });

    it("should not throw for missing actor properties", () => {
      const actor = {
        border: null,
        splitBorder: null,
        actorSignals: null,
        connect: vi.fn(),
        disconnect: vi.fn(),
        remove_all_transitions: vi.fn(),
      };

      expect(() => wm().windowDestroy(actor)).not.toThrow();
    });
  });

  describe("trackWindow", () => {
    it("should not add invalid window types to tree", () => {
      const window = createMockWindow({
        window_type: Meta.WindowType.UTILITY,
        wm_class: "Utility",
        title: "Utility",
      });

      const initialWindowCount = ctx.tree.getNodeByType(NODE_TYPES.WINDOW).length;

      wm().trackWindow(ctx.display, window);

      const afterCount = ctx.tree.getNodeByType(NODE_TYPES.WINDOW).length;

      expect(afterCount).toBe(initialWindowCount);
    });

    it("should not track ephemeral clipboard helper windows", () => {
      const window = createMockWindow({
        wm_class: "wl-clipboard",
        title: "wl-clipboard",
        rect: { x: 640, y: 416, width: 1, height: 1 },
      });

      const initialWindowCount = ctx.tree.getNodeByType(NODE_TYPES.WINDOW).length;

      wm().trackWindow(ctx.display, window);

      expect(ctx.tree.getNodeByType(NODE_TYPES.WINDOW).length).toBe(initialWindowCount);
    });

    it("should not track XWayland Video Bridge windows", () => {
      const window = createMockWindow({
        wm_class: "xwaylandvideobridge",
        title: "Video Bridge",
      });

      const initialCount = ctx.tree.getNodeByType(NODE_TYPES.WINDOW).length;

      wm().trackWindow(ctx.display, window);

      const afterCount = ctx.tree.getNodeByType(NODE_TYPES.WINDOW).length;

      expect(afterCount).toBe(initialCount);
    });
  });

  describe("bindWorkspaceSignals", () => {
    it("should track valid windows from delayed workspace window-added callbacks", () => {
      let scheduledCallback: Parameters<typeof GLib.timeout_add>[2] | null = null;
      vi.spyOn(GLib, "timeout_add").mockImplementation((_priority, _interval, callback) => {
        scheduledCallback = callback;
        return 1;
      });

      const workspace = ctx.workspaces[0];
      const window = createMockWindow({
        id: 42,
        wm_class: "org.gnome.TextEditor",
        title: "New Document - Text Editor",
        workspace,
      });

      wm().bindWorkspaceSignals(workspace);
      workspace.emit("window-added", workspace, window);

      expect(ctx.tree.findNode(window)).toBeNull();
      expect(scheduledCallback).not.toBeNull();

      (scheduledCallback as unknown as () => boolean)();

      expect(ctx.tree.findNode(window)).not.toBeNull();
    });
  });
});
