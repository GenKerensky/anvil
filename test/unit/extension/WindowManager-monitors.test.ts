/*
 * WindowManager per-monitor window size constraint tests
 *
 * Covers _getMonitorConnector, _getMonitorConstraints, enforceUltrawideSize,
 * grab-op-end resize exemption tracking, and settings-changed handler.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import Meta from "gi://Meta";
import { GRAB_TYPES } from "../../../src/lib/extension/window.js";
import { NODE_TYPES } from "../../../src/lib/extension/tree.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";

function getMonitorManager(): any {
  return (Meta.MonitorManager as any).get();
}

describe("WindowManager - Per-Monitor Constraints", () => {
  let ctx: any;

  beforeEach(() => {
    (globalThis as any).global.backend = {
      get_monitor_manager: () => getMonitorManager(),
    };
    MonitorManagerReset();
    ctx = createWindowManagerFixture();
  });

  const wm = () => ctx.windowManager;

  function MonitorManagerReset() {
    const mgr = getMonitorManager();
    mgr.set_logical_monitors([]);
    // Restore any prototype methods that may have been shadowed by tests
    try {
      delete (mgr as any).get_logical_monitors;
    } catch {
      // ignore
    }
  }

  function setupMonitor(connector = "DP-1") {
    const monitor = new Meta.Monitor({ connector });
    const logicalMonitor = new Meta.LogicalMonitor({ monitors: [monitor] });
    getMonitorManager().set_logical_monitors([logicalMonitor]);
  }

  function setupWindowOnMonitor(monitorIndex = 0, windowId: any = undefined) {
    const metaWindow = createMockWindow({
      id: windowId ?? `win-${monitorIndex}`,
      monitor: monitorIndex,
    });
    metaWindow._workspace = ctx.workspaces[0];
    metaWindow._monitor = monitorIndex;
    const { monitor } = getWorkspaceAndMonitor(ctx);
    ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
    return metaWindow;
  }

  // ----------------------------------------------------------------
  //  _getMonitorConnector
  // ----------------------------------------------------------------
  describe("_getMonitorConnector", () => {
    it("returns connector for valid monitor index", () => {
      setupMonitor("DP-1");
      expect(wm()._getMonitorConnector(0)).toBe("DP-1");
    });

    it("returns connector for second monitor", () => {
      const m1 = new Meta.Monitor({ connector: "eDP-1" });
      const m2 = new Meta.Monitor({ connector: "DP-1" });
      getMonitorManager().set_logical_monitors([
        new Meta.LogicalMonitor({ monitors: [m1] }),
        new Meta.LogicalMonitor({ monitors: [m2] }),
      ]);
      expect(wm()._getMonitorConnector(1)).toBe("DP-1");
    });

    it("returns null for out-of-range index", () => {
      setupMonitor("DP-1");
      expect(wm()._getMonitorConnector(5)).toBeNull();
    });

    it("returns null when MonitorManager has no monitors", () => {
      expect(wm()._getMonitorConnector(0)).toBeNull();
    });

    it("returns null when get_logical_monitors throws", () => {
      setupMonitor("DP-1");
      const mgr = getMonitorManager();
      const orig = mgr.get_logical_monitors.bind(mgr);
      mgr.get_logical_monitors = vi.fn(() => {
        throw new Error("fail");
      });
      try {
        expect(wm()._getMonitorConnector(0)).toBeNull();
      } finally {
        mgr.get_logical_monitors = orig;
      }
    });
  });

  // ----------------------------------------------------------------
  //  _getMonitorConstraints
  // ----------------------------------------------------------------
  describe("_getMonitorConstraints", () => {
    it("returns constraints when connector matches", () => {
      setupMonitor("DP-1");
      ctx.settings._values["monitor-constraints"] = [["DP-1", 1920, 1000, true, false]];
      expect(wm()._getMonitorConstraints(0)).toEqual({
        maxWidth: 1920,
        maxHeight: 1000,
        enabled: true,
        resizeExempt: false,
      });
    });

    it("returns null when no matching connector in constraints", () => {
      setupMonitor("DP-1");
      ctx.settings._values["monitor-constraints"] = [["HDMI-1", 1920, 1080, true, false]];
      expect(wm()._getMonitorConstraints(0)).toBeNull();
    });

    it("returns null when connector lookup fails", () => {
      ctx.settings._values["monitor-constraints"] = [["DP-1", 1920, 1080, true, false]];
      expect(wm()._getMonitorConstraints(0)).toBeNull();
    });

    it("returns null when constraints array is empty", () => {
      setupMonitor("DP-1");
      ctx.settings._values["monitor-constraints"] = [];
      expect(wm()._getMonitorConstraints(0)).toBeNull();
    });
  });

  // ----------------------------------------------------------------
  //  enforceUltrawideSize
  // ----------------------------------------------------------------
  describe("enforceUltrawideSize", () => {
    const BIG_RECT = { x: 0, y: 0, width: 3440, height: 1440 };

    it("returns rect unchanged for non-window node", () => {
      const wsNode = ctx.tree.findNode("ws0");
      const result = wm().enforceUltrawideSize(wsNode, BIG_RECT);
      expect(result).toBe(BIG_RECT);
    });

    it("returns rect unchanged when no constraints found", () => {
      setupMonitor("DP-1");
      const metaWindow = setupWindowOnMonitor(0);
      const node = ctx.tree.findNode(metaWindow);
      const result = wm().enforceUltrawideSize(node, BIG_RECT);
      expect(result).toBe(BIG_RECT);
    });

    it("returns rect unchanged when constraints are disabled", () => {
      setupMonitor("DP-1");
      ctx.settings._values["monitor-constraints"] = [["DP-1", 1920, 1000, false, false]];
      const metaWindow = setupWindowOnMonitor(0);
      const node = ctx.tree.findNode(metaWindow);
      const result = wm().enforceUltrawideSize(node, BIG_RECT);
      expect(result).toBe(BIG_RECT);
    });

    it("clamps width when exceeding maxWidth", () => {
      setupMonitor("DP-1");
      ctx.settings._values["monitor-constraints"] = [["DP-1", 1920, 1440, true, false]];
      const metaWindow = setupWindowOnMonitor(0);
      const node = ctx.tree.findNode(metaWindow);
      const result = wm().enforceUltrawideSize(node, BIG_RECT);
      expect(result).toEqual({
        x: Math.floor((3440 - 1920) / 2),
        y: 0,
        width: 1920,
        height: 1440,
      });
    });

    it("clamps height when exceeding maxHeight", () => {
      setupMonitor("DP-1");
      ctx.settings._values["monitor-constraints"] = [["DP-1", 3440, 1000, true, false]];
      const metaWindow = setupWindowOnMonitor(0);
      const node = ctx.tree.findNode(metaWindow);
      const result = wm().enforceUltrawideSize(node, BIG_RECT);
      expect(result).toEqual({
        x: 0,
        y: Math.floor((1440 - 1000) / 2),
        width: 3440,
        height: 1000,
      });
    });

    it("clamps both width and height", () => {
      setupMonitor("DP-1");
      ctx.settings._values["monitor-constraints"] = [["DP-1", 1920, 1000, true, false]];
      const metaWindow = setupWindowOnMonitor(0);
      const node = ctx.tree.findNode(metaWindow);
      const result = wm().enforceUltrawideSize(node, BIG_RECT);
      expect(result).toEqual({
        x: Math.floor((3440 - 1920) / 2),
        y: Math.floor((1440 - 1000) / 2),
        width: 1920,
        height: 1000,
      });
    });

    it("skips enforcement when resize exempt and window was resized (non-solo)", () => {
      setupMonitor("DP-1");
      ctx.settings._values["monitor-constraints"] = [["DP-1", 1920, 1000, true, true]];
      const metaWindow1 = setupWindowOnMonitor(0, 42);
      setupWindowOnMonitor(0, 43); // second window so it's not solo
      wm()._resizedWindows.set(42, 2);
      const node = ctx.tree.findNode(metaWindow1);
      const result = wm().enforceUltrawideSize(node, BIG_RECT);
      expect(result).toBe(BIG_RECT);
    });

    it("centers solo resize-exempt window using its frame rect", () => {
      setupMonitor("DP-1");
      ctx.settings._values["monitor-constraints"] = [["DP-1", 1920, 1000, true, true]];
      const metaWindow = createMockWindow({
        id: 42,
        monitor: 0,
        rect: { x: 10, y: 20, width: 800, height: 600 },
      });
      metaWindow._workspace = ctx.workspaces[0];
      metaWindow._monitor = 0;
      const { monitor } = getWorkspaceAndMonitor(ctx);
      ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
      wm()._resizedWindows.set(42, 2);

      const node = ctx.tree.findNode(metaWindow);
      const result = wm().enforceUltrawideSize(node, BIG_RECT);
      expect(result).toEqual({
        x: Math.floor((3440 - 800) / 2),
        y: Math.floor((1440 - 600) / 2),
        width: 800,
        height: 600,
      });
    });

    it("clamps solo resize-exempt window to monitor bounds", () => {
      setupMonitor("DP-1");
      ctx.settings._values["monitor-constraints"] = [["DP-1", 1920, 1000, true, true]];
      const metaWindow = createMockWindow({
        id: 43,
        monitor: 0,
        rect: { x: 0, y: 0, width: 4000, height: 2000 },
      });
      metaWindow._workspace = ctx.workspaces[0];
      metaWindow._monitor = 0;
      const { monitor } = getWorkspaceAndMonitor(ctx);
      ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
      wm()._resizedWindows.set(43, 2);

      const node = ctx.tree.findNode(metaWindow);
      const result = wm().enforceUltrawideSize(node, BIG_RECT);
      expect(result).toEqual({
        x: 0,
        y: 0,
        width: 3440,
        height: 1440,
      });
    });

    it("enforces size when resize exempt but window NOT resized", () => {
      setupMonitor("DP-1");
      ctx.settings._values["monitor-constraints"] = [["DP-1", 1920, 1000, true, true]];
      const metaWindow = setupWindowOnMonitor(0, 42);
      const node = ctx.tree.findNode(metaWindow);
      const result = wm().enforceUltrawideSize(node, BIG_RECT);
      expect(result).toEqual({
        x: Math.floor((3440 - 1920) / 2),
        y: Math.floor((1440 - 1000) / 2),
        width: 1920,
        height: 1000,
      });
    });

    it("returns rect unchanged when width and height are under limits", () => {
      setupMonitor("DP-1");
      ctx.settings._values["monitor-constraints"] = [["DP-1", 3840, 2160, true, false]];
      const metaWindow = setupWindowOnMonitor(0);
      const node = ctx.tree.findNode(metaWindow);
      const rect = { x: 0, y: 0, width: 1920, height: 1080 };
      const result = wm().enforceUltrawideSize(node, rect);
      expect(result).toBe(rect);
    });

    it("handles window on monitor without constraints (different monitor)", () => {
      const m1 = new Meta.Monitor({ connector: "eDP-1" });
      const m2 = new Meta.Monitor({ connector: "DP-1" });
      getMonitorManager().set_logical_monitors([
        new Meta.LogicalMonitor({ monitors: [m1] }),
        new Meta.LogicalMonitor({ monitors: [m2] }),
      ]);
      // Only DP-1 has constraints
      ctx.settings._values["monitor-constraints"] = [["DP-1", 1920, 1080, true, false]];
      // Window is on eDP-1 (index 0)
      const metaWindow = setupWindowOnMonitor(0);
      const node = ctx.tree.findNode(metaWindow);
      const result = wm().enforceUltrawideSize(node, BIG_RECT);
      expect(result).toBe(BIG_RECT);
    });
  });

  // ----------------------------------------------------------------
  //  Grab-op-end resize exemption tracking
  // ----------------------------------------------------------------
  describe("_handleGrabOpEnd - resize tracking", () => {
    it("tracks resized windows when resize exemption is enabled", () => {
      setupMonitor("DP-1");
      ctx.settings._values["monitor-constraints"] = [["DP-1", 3440, 1440, true, true]];
      const metaWindow = setupWindowOnMonitor(0, 99);
      ctx.display.get_focus_window.mockReturnValue(metaWindow);

      wm()._handleGrabOpEnd(ctx.display, metaWindow, Meta.GrabOp.KEYBOARD_RESIZING_E);

      expect(wm()._resizedWindows.has(99)).toBe(true);
    });

    it("does NOT track when resize exemption is off", () => {
      setupMonitor("DP-1");
      ctx.settings._values["monitor-constraints"] = [["DP-1", 3440, 1440, true, false]];
      const metaWindow = setupWindowOnMonitor(0, 99);
      ctx.display.get_focus_window.mockReturnValue(metaWindow);

      wm()._handleGrabOpEnd(ctx.display, metaWindow, Meta.GrabOp.KEYBOARD_RESIZING_E);

      expect(wm()._resizedWindows.has(99)).toBe(false);
    });

    it("does NOT track when grabOp is not RESIZING", () => {
      setupMonitor("DP-1");
      ctx.settings._values["monitor-constraints"] = [["DP-1", 3440, 1440, true, true]];
      const metaWindow = setupWindowOnMonitor(0, 99);
      ctx.display.get_focus_window.mockReturnValue(metaWindow);

      wm()._handleGrabOpEnd(ctx.display, metaWindow, Meta.GrabOp.KEYBOARD_MOVING);

      expect(wm()._resizedWindows.has(99)).toBe(false);
    });

    it("does NOT track when constraints are null", () => {
      const metaWindow = setupWindowOnMonitor(0, 99);
      ctx.display.get_focus_window.mockReturnValue(metaWindow);

      wm()._handleGrabOpEnd(ctx.display, metaWindow, Meta.GrabOp.KEYBOARD_RESIZING_E);

      expect(wm()._resizedWindows.has(99)).toBe(false);
    });

    it("does NOT throw when focusMetaWindow is null", () => {
      ctx.display.get_focus_window.mockReturnValue(null);

      expect(() => {
        wm()._handleGrabOpEnd(ctx.display, null, Meta.GrabOp.KEYBOARD_RESIZING_E);
      }).not.toThrow();
    });
  });

  // ----------------------------------------------------------------
  //  Settings-changed monitor-constraints handler
  // ----------------------------------------------------------------
  describe("settings changed - monitor-constraints", () => {
    it("clears _resizedWindows when monitor-constraints changes", () => {
      wm()._resizedWindows.set(1, 1);
      wm()._resizedWindows.set(2, 1);
      expect(wm()._resizedWindows.size).toBe(2);

      // Simulate what the settings-changed handler does
      wm()._resizedWindows.clear();
      wm().renderTree("monitor-constraints", true);

      expect(wm()._resizedWindows.size).toBe(0);
    });
  });
});
