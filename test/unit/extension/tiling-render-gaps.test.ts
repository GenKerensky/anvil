/*
 * TilingRender gap calculation tests
 *
 * Tests for calculateGaps and window-gap-size behavior.
 * Ported from jcrussell/forge
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NODE_TYPES } from "../../../src/lib/extension/tree.js";
import { WINDOW_MODES } from "../../../src/lib/extension/window/constants.js";
import { TilingRender, type TilingRenderDeps } from "../../../src/lib/extension/tiling-render.js";
import {
  createMockWindow,
  createTreeFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";

describe("TilingRender - Gaps", () => {
  let ctx: any;
  let render: TilingRender;

  beforeEach(() => {
    ctx = createTreeFixture({ fullExtWm: true });
    const deps: TilingRenderDeps = {
      settings: ctx.settings,
      getTree: () => ctx.tree,
      moveWindow: vi.fn(),
      getAllNodeWindows: () => ctx.tree.getNodeByType(NODE_TYPES.WINDOW),
      isFloatingExempt: () => false,
      isActiveWindowWorkspaceTiled: () => true,
      getTiledChildren: (children) => ctx.tree.getTiledChildren(children),
      getResizeCount: () => 0,
      findParent: (node, type) => ctx.tree.findParent(node, type) ?? null,
      computeSizes: (node, children) => ctx.layoutEngine.computeSizes(node, children),
      presentation: ctx.runtime.presentation,
    };
    render = new TilingRender(deps);
  });

  afterEach(() => {
    ctx.cleanup();
  });

  describe("calculateGaps", () => {
    it("should return 0 for null node", () => {
      expect(render.calculateGaps(null as any)).toBe(0);
    });

    it("should return 0 when gap size is 0", () => {
      ctx.settings.set_uint("window-gap-size", 0);
      ctx.settings.set_uint("window-gap-size-increment", 1);
      const metaWindow = createMockWindow({ wm_class: "TestApp", title: "Test" });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);

      expect(render.calculateGaps(node)).toBe(0);
    });

    it("should calculate gap as size * increment", () => {
      ctx.settings.set_uint("window-gap-size", 5);
      ctx.settings.set_uint("window-gap-size-increment", 3);
      const metaWindow = createMockWindow({ wm_class: "TestApp", title: "Test" });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);

      expect(render.calculateGaps(node)).toBe(15);
    });

    it("should return 0 when gap-increment is 0", () => {
      ctx.settings.set_uint("window-gap-size", 5);
      ctx.settings.set_uint("window-gap-size-increment", 0);
      const metaWindow = createMockWindow({ wm_class: "TestApp", title: "Test" });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);

      expect(render.calculateGaps(node)).toBe(0);
    });

    it("uses the default zero base gap", () => {
      const metaWindow = createMockWindow({ wm_class: "TestApp", title: "Test" });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);

      expect(render.calculateGaps(node)).toBe(0);
    });
  });

  describe("calculateGaps - single window hide", () => {
    it("should hide gap when only one tiled window on monitor and setting enabled", () => {
      ctx.settings.set_uint("window-gap-size", 5);
      ctx.settings.set_uint("window-gap-size-increment", 2);
      ctx.settings.set_boolean("window-gap-hidden-on-single", true);
      const metaWindow = createMockWindow({ wm_class: "TestApp", title: "Test" });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);

      expect(render.calculateGaps(node)).toBe(0);
    });

    it("should show gap when multiple tiled windows on monitor", () => {
      ctx.settings.set_uint("window-gap-size", 5);
      ctx.settings.set_uint("window-gap-size-increment", 2);
      ctx.settings.set_boolean("window-gap-hidden-on-single", true);
      const win1 = createMockWindow({ wm_class: "App1", title: "Win1" });
      const win2 = createMockWindow({ wm_class: "App2", title: "Win2" });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const node1 = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, win1);
      ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, win2);

      expect(render.calculateGaps(node1)).toBe(10);
    });

    it("should show gap when setting is disabled even with single window", () => {
      ctx.settings.set_uint("window-gap-size", 5);
      ctx.settings.set_uint("window-gap-size-increment", 2);
      ctx.settings.set_boolean("window-gap-hidden-on-single", false);
      const metaWindow = createMockWindow({ wm_class: "TestApp", title: "Test" });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);

      expect(render.calculateGaps(node)).toBe(10);
    });

    it("should hide the gap when floated windows leave only one tiled window", () => {
      ctx.settings.set_uint("window-gap-size", 5);
      ctx.settings.set_uint("window-gap-size-increment", 2);
      ctx.settings.set_boolean("window-gap-hidden-on-single", true);
      const tiledWin = createMockWindow({ wm_class: "App1", title: "Tiled" });
      const floatWin = createMockWindow({ wm_class: "App2", title: "Float" });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const tiledNode = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, tiledWin);
      const floatNode = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, floatWin);
      floatNode.mode = WINDOW_MODES.FLOAT;
      floatNode.tile = false;

      expect(render.calculateGaps(tiledNode)).toBe(0);
    });

    it("should hide the gap when minimized windows leave only one visible tiled window", () => {
      ctx.settings.set_uint("window-gap-size", 5);
      ctx.settings.set_uint("window-gap-size-increment", 2);
      ctx.settings.set_boolean("window-gap-hidden-on-single", true);
      const tiledWin = createMockWindow({ wm_class: "App1", title: "Tiled" });
      const minimizedWin = createMockWindow({
        wm_class: "App2",
        title: "Minimized",
        minimized: true,
      });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const tiledNode = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, tiledWin);
      ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, minimizedWin);

      expect(render.calculateGaps(tiledNode)).toBe(0);
    });

    it("should apply to root node without monitor parent check", () => {
      ctx.settings.set_uint("window-gap-size", 5);
      ctx.settings.set_uint("window-gap-size-increment", 3);
      ctx.settings.set_boolean("window-gap-hidden-on-single", true);

      expect(render.calculateGaps(ctx.tree)).toBe(15);
    });
  });
});
