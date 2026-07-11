/*
 * WindowManager resized counter race condition tests
 *
 * Tests that _handleGrabOpEnd increments the _resizedWindows counter
 * on the correct window (_metaWindow, the window that was actually resized)
 * even when focus has changed to a different window (focusMetaWindow).
 *
 * This prevents a race condition where async resize operations (e.g., size-changed
 * signals from Wayland) could cause focus to shift to a different window before
 * the counter is incremented, causing the wrong window's counter to be updated.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import Meta from "gi://Meta";
import GLib from "gi://GLib";
import { NODE_TYPES } from "../../../src/lib/extension/tree.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";

function getMonitorManager(): any {
  return (Meta.MonitorManager as any).get();
}

function MonitorManagerReset() {
  const mgr = getMonitorManager();
  mgr.set_logical_monitors([]);
  try {
    delete (mgr as any).get_logical_monitors;
  } catch {
    // ignore
  }
}

function setupMonitor(ctx: any, connector = "DP-1") {
  const monitor = new Meta.Monitor({ connector });
  const logicalMonitor = new Meta.LogicalMonitor({ monitors: [monitor] });
  getMonitorManager().set_logical_monitors([logicalMonitor]);
}

function setupWindowOnMonitor(ctx: any, monitorIndex = 0, windowId: any = undefined) {
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

describe("WindowManager - Resized Counter Race Fix", () => {
  let ctx: any;

  beforeEach(() => {
    (globalThis as any).global.backend = {
      get_monitor_manager: () => getMonitorManager(),
    };
    MonitorManagerReset();
    ctx = createWindowManagerFixture();
  });

  const wm = () => ctx.windowManager;

  describe("_handleGrabOpEnd - counter increments on _metaWindow not focusMetaWindow", () => {
    it("should increment counter on _metaWindow when focusMetaWindow is different", () => {
      // Mock renderTree to avoid actor-dependent tree processing
      vi.spyOn(wm(), "renderTree").mockImplementation(() => {});

      // Mock GLib.timeout_add to execute callback immediately
      const timeoutAddSpy = vi
        .spyOn(GLib, "timeout_add")
        .mockImplementation((priority: any, interval: any, callback: any) => {
          callback();
          return Math.random();
        });

      setupMonitor(ctx, "Meta-0");
      ctx.settings._values["monitor-constraints"] = [["Meta-0", 1920, 1080, true, true]];

      // Create two windows on the same monitor
      const metaWin1 = createMockWindow({
        id: 100,
        monitor: 0,
      });
      metaWin1._workspace = ctx.workspaces[0];
      metaWin1._monitor = 0;

      const metaWin2 = createMockWindow({
        id: 200,
        monitor: 0,
      });
      metaWin2._workspace = ctx.workspaces[0];
      metaWin2._monitor = 0;

      // Add both windows to tree
      const { monitor } = getWorkspaceAndMonitor(ctx);
      ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWin1);
      ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWin2);

      // Simulate the race condition:
      // - metaWin1 is the window being resized (_metaWindow parameter)
      // - metaWin2 is now focused (focusMetaWindow)
      ctx.display.get_focus_window.mockReturnValue(metaWin2);

      // Call _handleGrabOpEnd with metaWin1 as the _metaWindow (the window that was
      // actually resized), but metaWin2 is the focusMetaWindow
      wm()._handleGrabOpEnd(ctx.display, metaWin1, Meta.GrabOp.KEYBOARD_RESIZING_E);

      // The counter MUST be set on metaWin1's id (the window that was resized),
      // NOT on metaWin2's id (the window that has focus)
      expect(wm()._grab.hasResizeCount(100)).toBe(true);
      expect(wm()._grab.getResizeCount(100)).toBe(1);

      // metaWin2 should NOT have a counter entry since it wasn't resized
      expect(wm()._grab.hasResizeCount(200)).toBe(false);

      timeoutAddSpy.mockRestore();
    });

    it("should increment counter on _metaWindow when they are the same window", () => {
      vi.spyOn(wm(), "renderTree").mockImplementation(() => {});

      const timeoutAddSpy = vi
        .spyOn(GLib, "timeout_add")
        .mockImplementation((priority: any, interval: any, callback: any) => {
          callback();
          return Math.random();
        });

      setupMonitor(ctx, "Meta-0");
      ctx.settings._values["monitor-constraints"] = [["Meta-0", 1920, 1080, true, true]];

      const metaWin1 = createMockWindow({ id: 100, monitor: 0 });
      metaWin1._workspace = ctx.workspaces[0];
      metaWin1._monitor = 0;

      const { monitor } = getWorkspaceAndMonitor(ctx);
      ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWin1);

      // Focus is on the same window being resized
      ctx.display.get_focus_window.mockReturnValue(metaWin1);

      wm()._handleGrabOpEnd(ctx.display, metaWin1, Meta.GrabOp.KEYBOARD_RESIZING_E);

      expect(wm()._grab.hasResizeCount(100)).toBe(true);
      expect(wm()._grab.getResizeCount(100)).toBe(1);

      timeoutAddSpy.mockRestore();
    });

    it("should not increment counter when _metaWindow is null even if focusMetaWindow exists", () => {
      setupMonitor(ctx, "Meta-0");
      ctx.settings._values["monitor-constraints"] = [["Meta-0", 1920, 1080, true, true]];

      const metaWin1 = createMockWindow({ id: 100, monitor: 0 });
      metaWin1._workspace = ctx.workspaces[0];
      metaWin1._monitor = 0;

      const { monitor } = getWorkspaceAndMonitor(ctx);
      ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWin1);

      ctx.display.get_focus_window.mockReturnValue(metaWin1);

      // Call with null _metaWindow - should not track anything
      wm()._handleGrabOpEnd(ctx.display, null as any, Meta.GrabOp.KEYBOARD_RESIZING_E);

      // No windows should be tracked since _metaWindow was null
      expect(wm()._grab.hasResizeCount(100)).toBe(false);
    });

    it("should not increment counter when grabOp is not a RESIZING operation", () => {
      vi.spyOn(wm(), "renderTree").mockImplementation(() => {});

      const timeoutAddSpy = vi
        .spyOn(GLib, "timeout_add")
        .mockImplementation((priority: any, interval: any, callback: any) => {
          callback();
          return Math.random();
        });

      setupMonitor(ctx, "Meta-0");
      ctx.settings._values["monitor-constraints"] = [["Meta-0", 1920, 1080, true, true]];

      const metaWin1 = createMockWindow({ id: 100, monitor: 0 });
      metaWin1._workspace = ctx.workspaces[0];
      metaWin1._monitor = 0;

      const { monitor } = getWorkspaceAndMonitor(ctx);
      ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWin1);

      ctx.display.get_focus_window.mockReturnValue(metaWin1);

      // Use MOVING operation instead of RESIZING
      wm()._handleGrabOpEnd(ctx.display, metaWin1, Meta.GrabOp.KEYBOARD_MOVING);

      expect(wm()._grab.hasResizeCount(100)).toBe(false);

      timeoutAddSpy.mockRestore();
    });

    it("should not increment counter when resize exemption is disabled", () => {
      vi.spyOn(wm(), "renderTree").mockImplementation(() => {});

      const timeoutAddSpy = vi
        .spyOn(GLib, "timeout_add")
        .mockImplementation((priority: any, interval: any, callback: any) => {
          callback();
          return Math.random();
        });

      setupMonitor(ctx, "Meta-0");
      // Disable resize exemption
      ctx.settings._values["monitor-constraints"] = [["Meta-0", 1920, 1080, true, false]];

      const metaWin1 = createMockWindow({ id: 100, monitor: 0 });
      metaWin1._workspace = ctx.workspaces[0];
      metaWin1._monitor = 0;

      const { monitor } = getWorkspaceAndMonitor(ctx);
      ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWin1);

      ctx.display.get_focus_window.mockReturnValue(metaWin1);

      wm()._handleGrabOpEnd(ctx.display, metaWin1, Meta.GrabOp.KEYBOARD_RESIZING_E);

      expect(wm()._grab.hasResizeCount(100)).toBe(false);

      timeoutAddSpy.mockRestore();
    });

    it("should handle multiple resize operations on the same window", () => {
      vi.spyOn(wm(), "renderTree").mockImplementation(() => {});

      const timeoutAddSpy = vi
        .spyOn(GLib, "timeout_add")
        .mockImplementation((priority: any, interval: any, callback: any) => {
          callback();
          return Math.random();
        });

      setupMonitor(ctx, "Meta-0");
      ctx.settings._values["monitor-constraints"] = [["Meta-0", 1920, 1080, true, true]];

      const metaWin1 = createMockWindow({ id: 100, monitor: 0 });
      metaWin1._workspace = ctx.workspaces[0];
      metaWin1._monitor = 0;

      const { monitor } = getWorkspaceAndMonitor(ctx);
      ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWin1);

      ctx.display.get_focus_window.mockReturnValue(metaWin1);

      // First resize
      wm()._handleGrabOpEnd(ctx.display, metaWin1, Meta.GrabOp.KEYBOARD_RESIZING_E);
      expect(wm()._grab.getResizeCount(100)).toBe(1);

      // Second resize
      wm()._handleGrabOpEnd(ctx.display, metaWin1, Meta.GrabOp.KEYBOARD_RESIZING_W);
      expect(wm()._grab.getResizeCount(100)).toBe(2);

      timeoutAddSpy.mockRestore();
    });
  });
});
