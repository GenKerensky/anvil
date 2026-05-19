/*
 * WindowManager workspace management tests
 *
 * Tests for workspace-related operations, workspace-skip-tile,
 * and per-workspace float/tile state.
 * Ported from jcrussell/forge
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import Meta from "gi://Meta";
import { NODE_TYPES, LAYOUT_TYPES } from "../../../src/lib/extension/tree.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";

describe("WindowManager - Workspace", () => {
  let ctx: any;

  beforeEach(() => {
    ctx = createWindowManagerFixture({
      globals: { workspaceManager: { workspaceCount: 3, activeWorkspaceIndex: 0 } },
    });
  });

  const wm = () => ctx.windowManager;

  describe("getWindowsOnWorkspace", () => {
    it("should return empty array for non-existent workspace", () => {
      const windows = wm().getWindowsOnWorkspace(99);
      expect(windows).toEqual([]);
    });

    it("should return windows on the given workspace", () => {
      const metaWindow = createMockWindow({ wm_class: "TestApp", title: "Test" });
      const { monitor } = getWorkspaceAndMonitor(ctx, 0);
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);

      const windows = wm().getWindowsOnWorkspace(0);
      expect(windows).toContain(node);
    });

    it("should not return windows from other workspaces", () => {
      const metaWindow = createMockWindow({ wm_class: "TestApp", title: "Test" });
      const { monitor } = getWorkspaceAndMonitor(ctx, 0);
      ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);

      const windows = wm().getWindowsOnWorkspace(1);
      expect(windows).not.toContain(metaWindow);
    });
  });

  describe("floatWorkspace / unfloatWorkspace", () => {
    it("should float all windows on a workspace", () => {
      const win1 = createMockWindow({ id: 1, wm_class: "App1", title: "Win1" });
      const win2 = createMockWindow({ id: 2, wm_class: "App2", title: "Win2" });
      const { monitor } = getWorkspaceAndMonitor(ctx, 0);
      const node1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, win1);
      const node2 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, win2);

      wm().floatWorkspace(0);

      expect(node1.float).toBe(true);
      expect(node2.float).toBe(true);
    });

    it("should unfloat all windows on a workspace", () => {
      const win1 = createMockWindow({ id: 1, wm_class: "App1", title: "Win1" });
      const win2 = createMockWindow({ id: 2, wm_class: "App2", title: "Win2" });
      const { monitor } = getWorkspaceAndMonitor(ctx, 0);
      const node1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, win1);
      const node2 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, win2);

      node1.float = true;
      node2.float = true;
      wm().unfloatWorkspace(0);

      expect(node1.float).toBe(false);
      expect(node2.float).toBe(false);
    });
  });

  describe("isActiveWindowWorkspaceTiled", () => {
    it("should return true when workspace-skip-tile is empty", () => {
      ctx.settings.set_string("workspace-skip-tile", "");
      const metaWindow = createMockWindow({ wm_class: "TestApp", title: "Test" });
      metaWindow._workspace = ctx.workspaces[0];

      expect(wm().isActiveWindowWorkspaceTiled(metaWindow)).toBe(true);
    });

    it("should return false when workspace is in skip list", () => {
      ctx.settings.set_string("workspace-skip-tile", "0");
      const metaWindow = createMockWindow({ wm_class: "TestApp", title: "Test" });
      metaWindow._workspace = ctx.workspaces[0];

      expect(wm().isActiveWindowWorkspaceTiled(metaWindow)).toBe(false);
    });

    it("should return true when workspace is not in skip list", () => {
      ctx.settings.set_string("workspace-skip-tile", "1,2");
      const metaWindow = createMockWindow({ wm_class: "TestApp", title: "Test" });
      metaWindow._workspace = ctx.workspaces[0];

      expect(wm().isActiveWindowWorkspaceTiled(metaWindow)).toBe(true);
    });

    it("should return true for null metaWindow", () => {
      expect(wm().isActiveWindowWorkspaceTiled(null as any)).toBe(true);
    });
  });

  describe("isCurrentWorkspaceTiled", () => {
    it("should return true when default workspace is tiled", () => {
      ctx.settings.set_string("workspace-skip-tile", "");
      ctx.workspaceManager.get_active_workspace_index.mockReturnValue(0);

      expect(wm().isCurrentWorkspaceTiled()).toBe(true);
    });

    it("should return false when current workspace is skipped", () => {
      ctx.settings.set_string("workspace-skip-tile", "0");
      ctx.workspaceManager.get_active_workspace_index.mockReturnValue(0);

      expect(wm().isCurrentWorkspaceTiled()).toBe(false);
    });

    it("should return true when a different workspace is skipped", () => {
      ctx.settings.set_string("workspace-skip-tile", "1");
      ctx.workspaceManager.get_active_workspace_index.mockReturnValue(0);

      expect(wm().isCurrentWorkspaceTiled()).toBe(true);
    });
  });

  describe("WorkspaceActiveTileToggle", () => {
    it("should add current workspace to skip list when toggling off", () => {
      ctx.settings.set_string("workspace-skip-tile", "");
      ctx.workspaceManager.get_active_workspace_index.mockReturnValue(0);

      wm().command({ name: "WorkspaceActiveTileToggle" });

      const skipList = ctx.settings.get_string("workspace-skip-tile");
      expect(skipList).toContain("0");
    });

    it("should remove current workspace from skip list when toggling on", () => {
      ctx.settings.set_string("workspace-skip-tile", "0,1,2");
      ctx.workspaceManager.get_active_workspace_index.mockReturnValue(1);

      wm().command({ name: "WorkspaceActiveTileToggle" });

      const skipList = ctx.settings.get_string("workspace-skip-tile");
      expect(skipList).not.toContain("1");
    });

    it("should float windows when workspace is added to skip list", () => {
      ctx.settings.set_string("workspace-skip-tile", "");
      ctx.workspaceManager.get_active_workspace_index.mockReturnValue(0);
      const metaWindow = createMockWindow({
        wm_class: "TestApp",
        title: "Test",
        workspace: ctx.workspaces[0],
      });
      const { monitor } = getWorkspaceAndMonitor(ctx, 0);
      ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);

      wm().command({ name: "WorkspaceActiveTileToggle" });

      const nodeWindow = ctx.tree.findNode(metaWindow);
      expect(nodeWindow.float).toBe(true);
    });

    it("should unfloat windows when workspace is removed from skip list", () => {
      ctx.settings.set_string("workspace-skip-tile", "0");
      ctx.workspaceManager.get_active_workspace_index.mockReturnValue(0);
      const metaWindow = createMockWindow({ wm_class: "TestApp", title: "Test" });
      const { monitor } = getWorkspaceAndMonitor(ctx, 0);
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
      node.float = true;

      wm().command({ name: "WorkspaceActiveTileToggle" });

      expect(ctx.settings.get_string("workspace-skip-tile")).not.toContain("0");
    });
  });

  describe("updateMetaWorkspaceMonitor", () => {
    it("should return early for invalid windows", () => {
      const badWindow = createMockWindow({
        window_type: Meta.WindowType.UTILITY,
        wm_class: "Utility",
      });

      expect(() => wm().updateMetaWorkspaceMonitor("test", 0, badWindow)).not.toThrow();
    });

    it("should do nothing when window has no workspace", () => {
      const metaWindow = createMockWindow({ wm_class: "TestApp", title: "Test" });
      metaWindow._workspace = null;

      expect(() => wm().updateMetaWorkspaceMonitor("test", null, metaWindow)).not.toThrow();
    });

    it("should handle window already in correct monitor/workspace node", () => {
      const metaWindow = createMockWindow({ wm_class: "TestApp", title: "Test" });
      metaWindow._workspace = ctx.workspaces[0];
      const { monitor } = getWorkspaceAndMonitor(ctx, 0);
      ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);

      expect(() => wm().updateMetaWorkspaceMonitor("test", 0, metaWindow)).not.toThrow();
    });
  });

  describe("trackCurrentWindows", () => {
    it("should track all windows across workspaces", () => {
      const win1 = createMockWindow({ id: 1, wm_class: "App1", title: "Win1" });
      ctx.workspaces[0]._windows = [win1];
      ctx.display.get_tab_list.mockReturnValue([win1]);

      expect(() => wm().trackCurrentWindows()).not.toThrow();
    });

    it("should handle empty window lists", () => {
      ctx.display.get_tab_list.mockReturnValue([]);

      expect(() => wm().trackCurrentWindows()).not.toThrow();
    });
  });

  describe("determineSplitLayout", () => {
    it("should return HSPLIT for wide monitors", () => {
      ctx.display.get_monitor_geometry.mockReturnValue({
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
      });

      expect(wm().determineSplitLayout()).toBe(LAYOUT_TYPES.HSPLIT);
    });

    it("should return VSPLIT for tall monitors", () => {
      ctx.display.get_monitor_geometry.mockReturnValue({
        x: 0,
        y: 0,
        width: 1080,
        height: 1920,
      });

      expect(wm().determineSplitLayout()).toBe(LAYOUT_TYPES.VSPLIT);
    });
  });
});
