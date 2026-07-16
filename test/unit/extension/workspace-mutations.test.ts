/*
 * WorkspaceMutations owner tests
 *
 * Tests for workspace-related operations, workspace-skip-tile,
 * and per-workspace float/tile state.
 * Ported from jcrussell/forge
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import Meta from "gi://Meta";
import { NODE_TYPES } from "../../../src/lib/extension/tree.js";
import {
  WorkspaceMutations,
  type WorkspaceMutationsHost,
} from "../../../src/lib/extension/workspace-mutations.js";
import {
  createMockWindow,
  createTreeFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";

describe("WorkspaceMutations", () => {
  let ctx: any;
  let host: WorkspaceMutationsHost;
  let mutations: WorkspaceMutations;

  beforeEach(() => {
    ctx = createTreeFixture({
      globals: { workspaceManager: { workspaceCount: 3, activeWorkspaceIndex: 0 } },
      fullExtWm: true,
    });
    host = {
      tree: ctx.tree,
      settings: ctx.settings,
      layoutEngine: ctx.layoutEngine,
      focusMetaWindow: null,
      grabOp: Meta.GrabOp.NONE,
      sortedWindows: [],
      findNodeWindow: (window) => ctx.tree.findNode(window),
      renderTree: vi.fn(),
      updateBorderLayout: vi.fn(),
      updateDecorationLayout: vi.fn(),
      updateStackedFocus: vi.fn(),
      updateTabbedFocus: vi.fn(),
      floatingWindow: (node) => Boolean(node?.isFloat()),
      validWindow: () => true,
      handleResizing: vi.fn(),
      handleMoving: vi.fn(),
      grabModeFor: () => null,
    };
    mutations = new WorkspaceMutations(host);
  });

  describe("getWindowsOnWorkspace", () => {
    it("should return empty array for non-existent workspace", () => {
      const windows = mutations.getWindowsOnWorkspace(99);
      expect(windows).toEqual([]);
    });

    it("should return windows on the given workspace", () => {
      const metaWindow = createMockWindow({ wm_class: "TestApp", title: "Test" });
      const { monitor } = getWorkspaceAndMonitor(ctx, 0);
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);

      const windows = mutations.getWindowsOnWorkspace(0);
      expect(windows).toContain(node);
    });

    it("should not return windows from other workspaces", () => {
      const metaWindow = createMockWindow({ wm_class: "TestApp", title: "Test" });
      const { monitor } = getWorkspaceAndMonitor(ctx, 0);
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);

      const windows = mutations.getWindowsOnWorkspace(1);
      expect(windows).not.toContain(node);
    });
  });

  describe("floatWorkspace / unfloatWorkspace", () => {
    it("should float all windows on a workspace", () => {
      const win1 = createMockWindow({ id: 1, wm_class: "App1", title: "Win1" });
      const win2 = createMockWindow({ id: 2, wm_class: "App2", title: "Win2" });
      const { monitor } = getWorkspaceAndMonitor(ctx, 0);
      const node1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, win1);
      const node2 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, win2);

      mutations.floatWorkspace(0);

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
      mutations.unfloatWorkspace(0);

      expect(node1.float).toBe(false);
      expect(node2.float).toBe(false);
    });
  });

  describe("isActiveWindowWorkspaceTiled", () => {
    it("should return true when workspace-skip-tile is empty", () => {
      ctx.settings.set_string("workspace-skip-tile", "");
      const metaWindow = createMockWindow({ wm_class: "TestApp", title: "Test" });
      metaWindow._workspace = ctx.workspaces[0];

      expect(mutations.isActiveWindowWorkspaceTiled(metaWindow)).toBe(true);
    });

    it("should return false when workspace is in skip list", () => {
      ctx.settings.set_string("workspace-skip-tile", "0");
      const metaWindow = createMockWindow({ wm_class: "TestApp", title: "Test" });
      metaWindow._workspace = ctx.workspaces[0];

      expect(mutations.isActiveWindowWorkspaceTiled(metaWindow)).toBe(false);
    });

    it("should return true when workspace is not in skip list", () => {
      ctx.settings.set_string("workspace-skip-tile", "1,2");
      const metaWindow = createMockWindow({ wm_class: "TestApp", title: "Test" });
      metaWindow._workspace = ctx.workspaces[0];

      expect(mutations.isActiveWindowWorkspaceTiled(metaWindow)).toBe(true);
    });

    it("should return true for null metaWindow", () => {
      expect(mutations.isActiveWindowWorkspaceTiled(null as any)).toBe(true);
    });
  });

  describe("updateMetaWorkspaceMonitor", () => {
    it("returns before rendering for an invalid window", () => {
      const metaWindow = createMockWindow({ window_type: Meta.WindowType.UTILITY });
      host.validWindow = vi.fn(() => false);

      mutations.updateMetaWorkspaceMonitor("test", 0, metaWindow);

      expect(host.renderTree).not.toHaveBeenCalled();
    });

    it("returns before rendering when the window has no workspace", () => {
      const metaWindow = createMockWindow({ wm_class: "TestApp", title: "Test" });
      metaWindow._workspace = null;

      mutations.updateMetaWorkspaceMonitor("test", null, metaWindow);

      expect(host.renderTree).not.toHaveBeenCalled();
    });

    it("leaves a window in its current surface and renders once", () => {
      const metaWindow = createMockWindow({ wm_class: "TestApp", title: "Test" });
      metaWindow._workspace = ctx.workspaces[0];
      const { monitor } = getWorkspaceAndMonitor(ctx, 0);
      ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
      const reparent = vi.spyOn(ctx.layoutEngine, "reparentToNode");

      mutations.updateMetaWorkspaceMonitor("test", 0, metaWindow);

      expect(reparent).not.toHaveBeenCalled();
      expect(host.renderTree).toHaveBeenCalledExactlyOnceWith("test");
    });
  });
});
