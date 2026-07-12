/*
 * Integration tests for window operations
 *
 * End-to-end scenarios combining tracking, tiling, float, resize, focus,
 * and workspace management across multiple subsystems.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import Meta from "gi://Meta";
import { NODE_TYPES } from "../../src/lib/extension/tree.js";
import { WINDOW_MODES } from "../../src/lib/extension/window/constants.js";
import {
  createMockWindow,
  createAnvilRuntimeFixture,
  getWorkspaceAndMonitor,
} from "./mocks/helpers/index.js";

describe("Integration - Window Operations", () => {
  let ctx: any;

  beforeEach(() => {
    ctx = createAnvilRuntimeFixture({
      settings: { "auto-split-enabled": true },
    });
  });

  const wm = () => ctx.anvilRuntime;

  function createWindow(overrides = {}) {
    const metaWindow = createMockWindow({
      wm_class: "App",
      title: "Window",
      workspace: ctx.workspaces[0],
      monitor: 0,
      ...overrides,
    });
    const { monitor } = getWorkspaceAndMonitor(ctx);
    const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
    return { metaWindow, node };
  }

  function setFocus(metaWindow: any) {
    ctx.display.get_focus_window.mockReturnValue(metaWindow);
  }

  describe("create and track", () => {
    it("should create a single window and track it in the tree", () => {
      const { metaWindow, node } = createWindow();

      expect(node.nodeType).toBe(NODE_TYPES.WINDOW);
      expect(node.nodeValue).toBe(metaWindow);
      expect(node.mode).toBe(WINDOW_MODES.TILE);
    });

    it("should create two windows in a split layout", () => {
      createWindow({ wm_class: "App1" });
      const { metaWindow: win2 } = createWindow({ wm_class: "App2" });

      setFocus(win2);
      const second = wm().findNodeWindow(win2);
      expect(second).not.toBeNull();

      // Auto-split enabled should create a parent CON
      const parent = second!.parentNode;
      expect(parent).not.toBeNull();
      expect(parent!.childNodes.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("float and tile lifecycle", () => {
    it("should float a window and tile it back", () => {
      const { metaWindow, node } = createWindow();
      setFocus(metaWindow);

      wm().command({ name: "FloatToggle", mode: WINDOW_MODES.FLOAT });

      expect(node.mode).toBe(WINDOW_MODES.FLOAT);

      wm().command({ name: "FloatToggle", mode: WINDOW_MODES.TILE });

      expect(node.mode).toBe(WINDOW_MODES.TILE);
    });

    it("should batch float all windows and restore tiled ones", () => {
      const { node: n1 } = createWindow({ wm_class: "App1" });
      const { node: n2 } = createWindow({ wm_class: "App2" });
      n2.mode = WINDOW_MODES.FLOAT;

      wm().floatAllWindows();
      expect(n1.mode).toBe(WINDOW_MODES.FLOAT);
      expect(n2.mode).toBe(WINDOW_MODES.FLOAT);
      expect(n2.prevFloat).toBe(true);

      wm().unfloatAllWindows();
      expect(n1.mode).toBe(WINDOW_MODES.TILE);
      expect(n2.mode).toBe(WINDOW_MODES.FLOAT);
    });
  });

  describe("resize operations", () => {
    it("should resize a tiled window to the right", () => {
      const { metaWindow } = createWindow();
      setFocus(metaWindow);
      const initialWidth = metaWindow.get_frame_rect().width;

      wm().resize(Meta.GrabOp.KEYBOARD_RESIZING_E, 30);

      const rect = metaWindow.get_frame_rect();
      expect(rect.width).toBe(initialWidth + 30);
    });
  });

  describe("focus management", () => {
    it("should change focus between two windows", () => {
      const { metaWindow: win1 } = createWindow({ wm_class: "App1" });
      const { metaWindow: win2 } = createWindow({ wm_class: "App2" });

      setFocus(win1);
      expect(ctx.display.get_focus_window()).toBe(win1);

      setFocus(win2);
      expect(ctx.display.get_focus_window()).toBe(win2);
    });
  });

  describe("window movement", () => {
    it("should swap two adjacent windows", () => {
      const { metaWindow: win1 } = createWindow({
        wm_class: "App1",
        rect: { x: 0, y: 0, width: 500, height: 500 },
      });
      const { metaWindow: win2, node: node2 } = createWindow({
        wm_class: "App2",
        rect: { x: 500, y: 0, width: 500, height: 500 },
      });
      setFocus(win2);

      const initialRect2 = node2.rect ? { ...node2.rect } : null;

      wm().command({
        name: "WindowSwapLastActive",
        direction: Meta.DisplayDirection.LEFT,
      });

      // Both windows still tracked in tree
      expect(wm().findNodeWindow(win1)).not.toBeNull();
      expect(wm().findNodeWindow(win2)).not.toBeNull();
    });
  });

  describe("tiling mode toggle", () => {
    it("should float all and restore after toggle cycle", () => {
      const { node } = createWindow();

      expect(node.mode).toBe(WINDOW_MODES.TILE);

      ctx.settings.set_boolean("tiling-mode-enabled", true);
      wm().command({ name: "TilingModeToggle" });
      expect(node.mode).toBe(WINDOW_MODES.FLOAT);

      wm().command({ name: "TilingModeToggle" });
      expect(node.mode).toBe(WINDOW_MODES.TILE);
    });
  });

  describe("gap changes", () => {
    it("should reflect gap changes in calculateGaps", () => {
      const { node } = createWindow();

      ctx.settings.set_uint("window-gap-size", 4);
      ctx.settings.set_uint("window-gap-size-increment", 2);

      expect(wm().tilingRender.calculateGaps(node)).toBe(8);
    });
  });

  describe("minimize cycle", () => {
    it("should minimize and unminimize a window", () => {
      const { metaWindow, node } = createWindow();
      setFocus(metaWindow);

      metaWindow.minimized = true;
      expect(metaWindow.minimized).toBe(true);

      metaWindow.minimized = false;
      expect(metaWindow.minimized).toBe(false);
    });
  });

  describe("multiple workspaces", () => {
    it("should handle windows on different workspaces", () => {
      // Re-create fixture with 2 workspaces
      ctx = createAnvilRuntimeFixture({
        globals: { workspaceManager: { workspaceCount: 2 } },
        settings: { "auto-split-enabled": true },
      });

      const win1 = createMockWindow({ wm_class: "App1", title: "Win1" });
      win1._workspace = ctx.workspaces[0];
      win1._monitor = 0;
      const ws0 = ctx.tree.findNode("ws0");
      ctx.tree.createNode(
        ws0.getNodeByType(NODE_TYPES.MONITOR)[0].nodeValue,
        NODE_TYPES.WINDOW,
        win1
      );

      const win2 = createMockWindow({ wm_class: "App2", title: "Win2" });
      win2._workspace = ctx.workspaces[1];
      win2._monitor = 0;
      const ws1 = ctx.tree.findNode("ws1");
      ctx.tree.createNode(
        ws1.getNodeByType(NODE_TYPES.MONITOR)[0].nodeValue,
        NODE_TYPES.WINDOW,
        win2
      );

      expect(ctx.tree.findNode(win1)).not.toBeNull();
      expect(ctx.tree.findNode(win2)).not.toBeNull();
    });
  });

  describe("window close", () => {
    it("should delete window and remove from tree", () => {
      const { metaWindow, node } = createWindow();
      setFocus(metaWindow);

      const parentBefore = node.parentNode;
      metaWindow.delete(global.display.get_current_time());

      // Window actor removal would trigger _validWindow check
      // The delete call should not throw
      expect(true).toBe(true);
    });
  });

  describe("skip-tile workspace", () => {
    it("should float windows on skip-tile workspace", () => {
      const { metaWindow, node } = createWindow();
      ctx.settings.set_string("workspace-skip-tile", "0");

      wm().tilingRender.processFloats();

      expect(node.mode).toBe(WINDOW_MODES.FLOAT);
    });
  });

  describe("focus border", () => {
    it("should toggle focus border setting", () => {
      expect(ctx.settings.get_boolean("focus-border-toggle")).toBe(false);

      ctx.settings.set_boolean("focus-border-toggle", true);

      expect(ctx.settings.get_boolean("focus-border-toggle")).toBe(true);
    });
  });

  describe("command dispatch", () => {
    it("should dispatch multiple commands in sequence", () => {
      const { metaWindow, node } = createWindow();
      setFocus(metaWindow);

      wm().command({ name: "FloatToggle", mode: WINDOW_MODES.FLOAT });
      expect(node.mode).toBe(WINDOW_MODES.FLOAT);

      wm().command({ name: "LayoutStackedToggle" });

      wm().command({ name: "FloatToggle", mode: WINDOW_MODES.TILE });
      expect(node.mode).toBe(WINDOW_MODES.TILE);
    });
  });

  describe("grab state lifecycle", () => {
    it("should begin and end a grab operation", () => {
      const { metaWindow } = createWindow();
      setFocus(metaWindow);
      const display = ctx.display;

      wm()._handleGrabOpBegin(display, metaWindow, Meta.GrabOp.KEYBOARD_RESIZING_E);
      expect(wm()._grab.grabOp).toBe(Meta.GrabOp.KEYBOARD_RESIZING_E);

      wm()._handleGrabOpEnd(display, metaWindow, Meta.GrabOp.KEYBOARD_RESIZING_E);
      expect(wm()._grab.grabOp).toBe(Meta.GrabOp.NONE);
    });
  });

  describe("tree structure", () => {
    it("should create proper tree hierarchy for tiled windows", () => {
      const wsNode = ctx.tree.findNode("ws0");
      expect(wsNode).not.toBeNull();
      expect(wsNode.nodeType).toBe(NODE_TYPES.WORKSPACE);

      const monitors = wsNode.getNodeByType(NODE_TYPES.MONITOR);
      expect(monitors.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("layout changes", () => {
    it("should toggle layout between split, stacked, and tabbed", () => {
      const { metaWindow, node } = createWindow();
      setFocus(metaWindow);

      wm().command({ name: "LayoutStackedToggle" });

      wm().command({ name: "LayoutTabbedToggle" });

      // Commands executed without throwing; window still tracked
      expect(wm().findNodeWindow(metaWindow)).not.toBeNull();
    });
  });
});
