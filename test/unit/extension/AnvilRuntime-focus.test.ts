/*
 * AnvilRuntime focus/pointer tests
 *
 * WM-specific integration tests for focus management and focus restoration.
 * Ported from jcrussell/forge
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import Meta from "gi://Meta";
import { LAYOUT_TYPES } from "../../../src/lib/extension/tree.js";
import { NODE_TYPES } from "../../../src/lib/extension/tree.js";
import {
  createMockWindow,
  createAnvilRuntimeFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";

describe("AnvilRuntime - Focus", () => {
  let ctx: any;

  beforeEach(() => {
    ctx = createAnvilRuntimeFixture({ settings: { "focus-on-hover-enabled": true } });
  });

  const wm = () => ctx.anvilRuntime;

  describe("_findNodeWindowAtPointer", () => {
    it("should return undefined for null metaWindow", () => {
      expect(wm()._dragDrop._findNodeWindowAtPointer(null, [100, 100])).toBeUndefined();
    });

    it("should return node when window found in sortedWindows", () => {
      const metaWindow = createMockWindow({ rect: { x: 0, y: 0, width: 200, height: 200 } });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const nodeWindow = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
      wm().sortedWindows = ctx.tree
        .getNodeByType(NODE_TYPES.WINDOW)
        .map((n: any) => n.nodeValue as Meta.Window);

      const found = wm()._dragDrop._findNodeWindowAtPointer(metaWindow, [100, 100]);
      expect(found).toBe(nodeWindow);
    });

    it("should return null when window not in sortedWindows", () => {
      const metaWindow = createMockWindow({ rect: { x: 0, y: 0, width: 200, height: 200 } });
      wm().sortedWindows = [];
      expect(wm()._dragDrop._findNodeWindowAtPointer(metaWindow, [100, 100])).toBeNull();
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
      const queueSpy = vi.spyOn(wm()._eventScheduler, "enqueue");

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
      expect(() => wm()._tracker.restoreFocusAfterWindowClosed(null)).not.toThrow();
    });

    it("should focus sibling window when available", () => {
      const metaWindow1 = createMockWindow({ id: 1, wm_class: "App1", title: "Win1" });
      const metaWindow2 = createMockWindow({ id: 2, wm_class: "App2", title: "Win2" });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const node1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow1);
      ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow2);

      const raiseSpy = vi.spyOn(metaWindow2, "raise");
      const focusSpy = vi.spyOn(metaWindow2, "focus");

      wm()._tracker.restoreFocusAfterWindowClosed(node1);

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
      wm()._tracker.restoreFocusAfterWindowClosed(node);
      expect(raiseSpy).toHaveBeenCalled();
    });

    it("should do nothing when there are no windows on workspace", () => {
      const metaWindow = createMockWindow({ wm_class: "TestApp", title: "Test" });
      ctx.workspaces[0]._windows = [];

      const node = ctx.tree.createNode(ctx.tree.rootNode, NODE_TYPES.WINDOW, metaWindow);

      expect(() => wm()._tracker.restoreFocusAfterWindowClosed(node)).not.toThrow();
    });
  });
});
