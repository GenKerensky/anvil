/*
 * WindowManager batch float/unfloat tests
 *
 * Tests for floatAllWindows, unfloatAllWindows, and TilingModeToggle.
 * Ported from jcrussell/forge
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import Meta from "gi://Meta";
import { NODE_TYPES } from "../../../src/lib/extension/tree.js";
import { WINDOW_MODES } from "../../../src/lib/extension/window.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";

describe("WindowManager - Batch Float", () => {
  let ctx;

  beforeEach(() => {
    ctx = createWindowManagerFixture();
  });

  const wm = () => ctx.windowManager;

  function createTiledWindow() {
    const metaWindow = createMockWindow({
      wm_class: "App1",
      title: "Win",
      workspace: ctx.workspaces[0],
      monitor: 0,
    });
    const { monitor } = getWorkspaceAndMonitor(ctx);
    const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
    return { metaWindow, node };
  }

  function createFloatingWindow() {
    const { metaWindow, node } = createTiledWindow();
    node.mode = WINDOW_MODES.FLOAT;
    return { metaWindow, node };
  }

  describe("floatAllWindows", () => {
    it("should set all windows to float mode", () => {
      const { node: n1 } = createTiledWindow();
      const { node: n2 } = createTiledWindow();

      wm().floatAllWindows();

      expect(n1.mode).toBe(WINDOW_MODES.FLOAT);
      expect(n2.mode).toBe(WINDOW_MODES.FLOAT);
    });

    it("should set prevFloat on already-floating windows", () => {
      const { node: floatNode } = createFloatingWindow();
      const { node: tiledNode } = createTiledWindow();
      floatNode.prevFloat = false;

      wm().floatAllWindows();

      expect(floatNode.prevFloat).toBe(true);
    });

    it("should not set prevFloat on previously-tiled windows", () => {
      const { node } = createTiledWindow();

      wm().floatAllWindows();

      expect(node.prevFloat).toBeUndefined();
    });

    it("should handle empty window list", () => {
      expect(() => wm().floatAllWindows()).not.toThrow();
    });

    it("should handle single window", () => {
      const { node } = createTiledWindow();

      wm().floatAllWindows();

      expect(node.mode).toBe(WINDOW_MODES.FLOAT);
    });

    it("should keep already-floating windows as float", () => {
      const { node } = createFloatingWindow();

      wm().floatAllWindows();

      expect(node.mode).toBe(WINDOW_MODES.FLOAT);
    });
  });

  describe("unfloatAllWindows", () => {
    it("should set tiled windows without prevFloat to tile mode", () => {
      const { node } = createTiledWindow();

      wm().floatAllWindows();
      wm().unfloatAllWindows();

      expect(node.mode).toBe(WINDOW_MODES.TILE);
    });

    it("should keep prevFloat windows as float", () => {
      const { node } = createFloatingWindow();

      wm().floatAllWindows();
      wm().unfloatAllWindows();

      expect(node.mode).toBe(WINDOW_MODES.FLOAT);
    });

    it("should clear prevFloat after restoring", () => {
      const { node } = createFloatingWindow();
      node.prevFloat = true;

      wm().unfloatAllWindows();

      expect(node.prevFloat).toBe(false);
    });

    it("should not affect windows without prevFloat after float-then-unfloat", () => {
      const { node } = createTiledWindow();

      wm().floatAllWindows();
      wm().unfloatAllWindows();

      expect(node.prevFloat).toBeUndefined();
    });

    it("should handle empty window list", () => {
      expect(() => wm().unfloatAllWindows()).not.toThrow();
    });

    it("should handle single window without prevFloat", () => {
      const { node } = createTiledWindow();

      wm().floatAllWindows();
      wm().unfloatAllWindows();

      expect(node.mode).toBe(WINDOW_MODES.TILE);
    });
  });

  describe("TilingModeToggle command", () => {
    it("should call floatAllWindows when tiling mode is on", () => {
      ctx.settings.set_boolean("tiling-mode-enabled", true);
      const spy = vi.spyOn(ctx.windowManager, "floatAllWindows");

      wm().command({ name: "TilingModeToggle" });

      expect(spy).toHaveBeenCalled();
    });

    it("should call unfloatAllWindows when tiling mode is off", () => {
      ctx.settings.set_boolean("tiling-mode-enabled", false);
      const spy = vi.spyOn(ctx.windowManager, "unfloatAllWindows");

      wm().command({ name: "TilingModeToggle" });

      expect(spy).toHaveBeenCalled();
    });

    it("should toggle tiling-mode-enabled setting", () => {
      ctx.settings.set_boolean("tiling-mode-enabled", true);

      wm().command({ name: "TilingModeToggle" });

      expect(ctx.settings.get_boolean("tiling-mode-enabled")).toBe(false);
    });

    it("should toggle from off to on", () => {
      ctx.settings.set_boolean("tiling-mode-enabled", false);

      wm().command({ name: "TilingModeToggle" });

      expect(ctx.settings.get_boolean("tiling-mode-enabled")).toBe(true);
    });
  });

  describe("full float/unfloat cycle", () => {
    it("should float all and restore previously tiled windows", () => {
      const { node: tiled1 } = createTiledWindow();
      const { node: tiled2 } = createTiledWindow();

      wm().floatAllWindows();
      expect(tiled1.mode).toBe(WINDOW_MODES.FLOAT);
      expect(tiled2.mode).toBe(WINDOW_MODES.FLOAT);

      wm().unfloatAllWindows();
      expect(tiled1.mode).toBe(WINDOW_MODES.TILE);
      expect(tiled2.mode).toBe(WINDOW_MODES.TILE);
    });

    it("should preserve originally floating windows after cycle", () => {
      const { node: floatNode } = createFloatingWindow();
      const { node: tiledNode } = createTiledWindow();

      wm().floatAllWindows();
      wm().unfloatAllWindows();

      expect(floatNode.mode).toBe(WINDOW_MODES.FLOAT);
      expect(tiledNode.mode).toBe(WINDOW_MODES.TILE);
    });

    it("should persist prevFloat across render calls", () => {
      const { node: floatNode } = createFloatingWindow();

      wm().floatAllWindows();
      expect(floatNode.prevFloat).toBe(true);

      wm().unfloatAllWindows();
      expect(floatNode.prevFloat).toBe(false);
    });

    it("should handle tiling mode toggle cycle", () => {
      ctx.settings.set_boolean("tiling-mode-enabled", true);
      const { node } = createTiledWindow();

      wm().command({ name: "TilingModeToggle" });
      expect(node.mode).toBe(WINDOW_MODES.FLOAT);

      wm().command({ name: "TilingModeToggle" });
      expect(node.mode).toBe(WINDOW_MODES.TILE);
    });

    it("should maintain prevFloat across tiling mode toggle", () => {
      ctx.settings.set_boolean("tiling-mode-enabled", true);
      const { node: floatNode } = createFloatingWindow();

      wm().command({ name: "TilingModeToggle" });
      expect(floatNode.prevFloat).toBe(true);

      wm().command({ name: "TilingModeToggle" });
      expect(floatNode.prevFloat).toBe(false);
      // After unfloatAllWindows, prevFloat windows keep FLOAT mode during the
      // unfloat operation. Then renderTree -> processFloats runs and
      // overrides the mode: non-exempt windows on tiled workspaces become TILE.
      // Only exemption- or skip-list-based floats survive processFloats.
      expect(floatNode.mode).toBe(WINDOW_MODES.TILE);
    });

    it("should float windows on multiple monitors", () => {
      const { node: n1 } = createTiledWindow();
      const win2 = createMockWindow({ wm_class: "App2", title: "Win2" });
      const wsNode2 = ctx.tree.findNode("ws0");
      const monNode = wsNode2.getNodeByType(NODE_TYPES.MONITOR)[0];
      const n2 = ctx.tree.createNode(monNode.nodeValue, NODE_TYPES.WINDOW, win2);

      wm().floatAllWindows();

      expect(n1.mode).toBe(WINDOW_MODES.FLOAT);
      expect(n2.mode).toBe(WINDOW_MODES.FLOAT);
    });
  });

  describe("TilingModeToggle with specific state", () => {
    it("should set mode to FLOAT on toggle off", () => {
      ctx.settings.set_boolean("tiling-mode-enabled", true);
      const { node } = createTiledWindow();

      wm().command({ name: "TilingModeToggle" });

      expect(node.mode).toBe(WINDOW_MODES.FLOAT);
    });

    it("should set mode to TILE on toggle on", () => {
      const { node } = createTiledWindow();
      node.mode = WINDOW_MODES.FLOAT;
      ctx.settings.set_boolean("tiling-mode-enabled", false);

      wm().command({ name: "TilingModeToggle" });

      expect(node.mode).toBe(WINDOW_MODES.TILE);
    });
  });

  describe("exempt windows", () => {
    function createExemptWindow() {
      const { metaWindow, node } = createTiledWindow();
      node.mode = WINDOW_MODES.FLOAT;
      // DIALOG type windows are exempt from tiling
      metaWindow._window_type = Meta.WindowType.DIALOG;
      return { metaWindow, node };
    }

    it("should keep exempt windows float after full toggle cycle", () => {
      ctx.settings.set_boolean("tiling-mode-enabled", true);
      const { node } = createExemptWindow();

      wm().command({ name: "TilingModeToggle" });
      expect(node.mode).toBe(WINDOW_MODES.FLOAT);

      wm().command({ name: "TilingModeToggle" });
      // processFloats keeps exempt windows as float
      expect(node.mode).toBe(WINDOW_MODES.FLOAT);
    });

    it("should keep exempt windows float after multiple toggle cycles", () => {
      ctx.settings.set_boolean("tiling-mode-enabled", true);
      const { node } = createExemptWindow();

      wm().command({ name: "TilingModeToggle" });
      wm().command({ name: "TilingModeToggle" });
      wm().command({ name: "TilingModeToggle" });
      wm().command({ name: "TilingModeToggle" });

      expect(node.mode).toBe(WINDOW_MODES.FLOAT);
    });
  });

  describe("skip-tile workspace interaction", () => {
    it("should keep windows on skip-tile workspace as float after toggle on", () => {
      ctx.settings.set_string("workspace-skip-tile", "0");
      ctx.settings.set_boolean("tiling-mode-enabled", false);
      const { node } = createTiledWindow();

      // Tiling mode already off, windows are float
      wm().command({ name: "TilingModeToggle" });

      // Workspace 0 is skip-tile, so processFloats keeps it as float
      expect(node.mode).toBe(WINDOW_MODES.FLOAT);
    });

    it("should handle mix of skip-tile and tiled workspaces", () => {
      // Re-create fixture with 2 workspaces for this test
      ctx = createWindowManagerFixture({
        globals: { workspaceManager: { workspaceCount: 2 } },
      });
      ctx.settings.set_string("workspace-skip-tile", "0");
      ctx.settings.set_boolean("tiling-mode-enabled", true);
      const { node: n1 } = createTiledWindow();

      // Create a window on workspace 1 (tiled)
      const win2 = createMockWindow({ wm_class: "App2", title: "Win2" });
      win2._workspace = ctx.workspaces[1];
      win2._monitor = 0;
      const ws1 = ctx.tree.findNode("ws1");
      ctx.tree.createNode(
        ws1.getNodeByType(NODE_TYPES.MONITOR)[0].nodeValue,
        NODE_TYPES.WINDOW,
        win2
      );
      const mon1 = ws1.getNodeByType(NODE_TYPES.MONITOR)[0];
      const n2 = mon1.getNodeByType(NODE_TYPES.WINDOW)[0];
      n2.mode = WINDOW_MODES.TILE;

      // Toggle off then on
      wm().command({ name: "TilingModeToggle" });
      wm().command({ name: "TilingModeToggle" });

      // Skip-tile workspace window stays float
      expect(n1.mode).toBe(WINDOW_MODES.FLOAT);
      // Tiled workspace window is tiled
      expect(n2.mode).toBe(WINDOW_MODES.TILE);
    });
  });

  describe("user float override interplay", () => {
    it("should keep user-float-override windows as float after processFloats", () => {
      const { metaWindow, node } = createTiledWindow();
      // Add a float override for this window class
      ctx.configMgr.windowProps.overrides = [{ wmClass: "App1", mode: "float" }];
      node.mode = WINDOW_MODES.FLOAT;

      // processFloats runs during renderTree; with override it should stay float
      ctx.settings.set_boolean("tiling-mode-enabled", true);

      wm().command({ name: "TilingModeToggle" });
      expect(node.mode).toBe(WINDOW_MODES.FLOAT);

      wm().command({ name: "TilingModeToggle" });
      // Override keeps it FLOAT via processFloats
      expect(node.mode).toBe(WINDOW_MODES.FLOAT);
    });
  });
});
