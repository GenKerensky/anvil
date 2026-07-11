/*
 * WindowManager gap calculation tests
 *
 * Tests for calculateGaps and window-gap-size behavior.
 * Ported from jcrussell/forge
 */

import { describe, it, expect, beforeEach } from "vitest";
import { NODE_TYPES } from "../../../src/lib/extension/tree.js";
import { WINDOW_MODES } from "../../../src/lib/extension/window.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";

describe("WindowManager - Gaps", () => {
  let ctx: any;

  beforeEach(() => {
    ctx = createWindowManagerFixture();
  });

  const wm = () => ctx.windowManager;

  describe("calculateGaps", () => {
    it("should return 0 for null node", () => {
      expect(wm().tilingRender.calculateGaps(null)).toBe(0);
    });

    it("should return 0 when gap size is 0", () => {
      ctx.settings.set_uint("window-gap-size", 0);
      ctx.settings.set_uint("window-gap-size-increment", 1);
      const metaWindow = createMockWindow({ wm_class: "TestApp", title: "Test" });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);

      expect(wm().tilingRender.calculateGaps(node)).toBe(0);
    });

    it("should calculate gap as size * increment", () => {
      ctx.settings.set_uint("window-gap-size", 5);
      ctx.settings.set_uint("window-gap-size-increment", 3);
      const metaWindow = createMockWindow({ wm_class: "TestApp", title: "Test" });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);

      expect(wm().tilingRender.calculateGaps(node)).toBe(15);
    });

    it("should return 0 when gap-increment is 0", () => {
      ctx.settings.set_uint("window-gap-size", 5);
      ctx.settings.set_uint("window-gap-size-increment", 0);
      const metaWindow = createMockWindow({ wm_class: "TestApp", title: "Test" });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);

      expect(wm().tilingRender.calculateGaps(node)).toBe(0);
    });

    it("should use gap size 5 with increment 1 as default gap 5", () => {
      const metaWindow = createMockWindow({ wm_class: "TestApp", title: "Test" });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);

      expect(wm().tilingRender.calculateGaps(node)).toBe(0);
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

      expect(wm().tilingRender.calculateGaps(node)).toBe(0);
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

      expect(wm().tilingRender.calculateGaps(node1)).toBe(10);
    });

    it("should show gap when setting is disabled even with single window", () => {
      ctx.settings.set_uint("window-gap-size", 5);
      ctx.settings.set_uint("window-gap-size-increment", 2);
      ctx.settings.set_boolean("window-gap-hidden-on-single", false);
      const metaWindow = createMockWindow({ wm_class: "TestApp", title: "Test" });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);

      expect(wm().tilingRender.calculateGaps(node)).toBe(10);
    });

    it("should still show gap when single tiled but floated windows exist", () => {
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

      expect(wm().tilingRender.calculateGaps(tiledNode)).toBe(0);
    });

    it("should still show gap when single tiled but minimized windows exist", () => {
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

      expect(wm().tilingRender.calculateGaps(tiledNode)).toBe(0);
    });

    it("should apply to root node without monitor parent check", () => {
      ctx.settings.set_uint("window-gap-size", 5);
      ctx.settings.set_uint("window-gap-size-increment", 3);
      ctx.settings.set_boolean("window-gap-hidden-on-single", true);

      expect(wm().tilingRender.calculateGaps(ctx.tree)).toBe(15);
    });
  });

  describe("calculateGaps - increment commands", () => {
    it("should increase gap via GapSize command", () => {
      ctx.settings.set_uint("window-gap-size-increment", 2);

      wm().command({ name: "GapSize", amount: 1 });

      expect(ctx.settings.get_uint("window-gap-size-increment")).toBe(3);
    });

    it("should decrease gap via GapSize command", () => {
      ctx.settings.set_uint("window-gap-size-increment", 5);

      wm().command({ name: "GapSize", amount: -2 });

      expect(ctx.settings.get_uint("window-gap-size-increment")).toBe(3);
    });

    it("should clamp gap to minimum 0", () => {
      ctx.settings.set_uint("window-gap-size-increment", 1);

      wm().command({ name: "GapSize", amount: -5 });

      expect(ctx.settings.get_uint("window-gap-size-increment")).toBe(0);
    });

    it("should clamp gap to maximum 8", () => {
      ctx.settings.set_uint("window-gap-size-increment", 5);

      wm().command({ name: "GapSize", amount: 10 });

      expect(ctx.settings.get_uint("window-gap-size-increment")).toBe(8);
    });

    it("should not change base gap size when increment changes", () => {
      ctx.settings.set_uint("window-gap-size", 5);
      ctx.settings.set_uint("window-gap-size-increment", 2);

      wm().command({ name: "GapSize", amount: 3 });

      expect(ctx.settings.get_uint("window-gap-size")).toBe(5);
      expect(ctx.settings.get_uint("window-gap-size-increment")).toBe(5);
    });
  });
});
