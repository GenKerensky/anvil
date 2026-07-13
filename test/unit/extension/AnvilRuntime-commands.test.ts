/*
 * AnvilRuntime command dispatcher tests
 *
 * Tests for the command() method covering all keybinding actions.
 * Ported from jcrussell/forge
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import Meta from "gi://Meta";
import { WINDOW_MODES } from "../../../src/lib/extension/window/constants.js";
import { NODE_TYPES, LAYOUT_TYPES, ORIENTATION_TYPES } from "../../../src/lib/extension/tree.js";
import {
  createMockWindow,
  createAnvilRuntimeFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";

describe("AnvilRuntime - Commands", () => {
  let ctx: any;

  beforeEach(() => {
    ctx = createAnvilRuntimeFixture();
  });

  const wm = () => ctx.anvilRuntime;
  const configMgr = () => ctx.configMgr;

  describe("FloatToggle", () => {
    it("should toggle floating mode and move the window", () => {
      const metaWindow = createMockWindow({ wm_class: "TestApp", title: "Test" });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
      ctx.display.get_focus_window.mockReturnValue(metaWindow);

      const moveSpy = vi.spyOn(wm(), "move");

      wm().command({
        name: "FloatToggle",
        mode: WINDOW_MODES.FLOAT,
        x: 100,
        y: 100,
        width: 400,
        height: 300,
      });

      // Assert the observable behavior (owner = tree node mode), not the
      // WM toggleFloatingMode middle-man facade (review S7).
      expect(ctx.tree.findNode(metaWindow)?.mode).toBe(WINDOW_MODES.FLOAT);
      expect(moveSpy).toHaveBeenCalled();
    });

    it("should handle FloatClassToggle action", () => {
      const metaWindow = createMockWindow({ wm_class: "TestApp", title: "Test" });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
      ctx.display.get_focus_window.mockReturnValue(metaWindow);

      wm().command({ name: "FloatClassToggle", mode: WINDOW_MODES.FLOAT });

      expect(ctx.tree.findNode(metaWindow)?.mode).toBe(WINDOW_MODES.FLOAT);
    });

    it("persists class participation policy in core writer mode", () => {
      const metaWindow = createMockWindow({ wm_class: "TestApp", title: "Test" });
      ctx.display.get_focus_window.mockReturnValue(metaWindow);
      wm()._tilingEngineMode = "core";
      const observePolicy = vi.spyOn(wm()._tilingShadow, "observePolicy");

      wm().command({ name: "FloatClassToggle", mode: WINDOW_MODES.FLOAT });

      expect(wm().isFloatingExempt(metaWindow)).toBe(true);
      expect(configMgr().windowProps.overrides).toContainEqual(
        expect.objectContaining({ wmClass: "TestApp", mode: "float", wmId: undefined })
      );
      expect(observePolicy).toHaveBeenCalledOnce();
    });

    it("should handle FloatNonPersistentToggle action", () => {
      const metaWindow = createMockWindow({ wm_class: "TestApp", title: "Test" });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
      ctx.display.get_focus_window.mockReturnValue(metaWindow);

      wm().command({ name: "FloatNonPersistentToggle", mode: WINDOW_MODES.FLOAT });

      expect(ctx.tree.findNode(metaWindow)?.mode).toBe(WINDOW_MODES.FLOAT);
    });
  });

  describe("Move", () => {
    it("keeps the legacy writer running if shadow dispatch fails", () => {
      const metaWindow = createMockWindow({ wm_class: "TestApp", title: "Test" });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
      ctx.display.get_focus_window.mockReturnValue(metaWindow);
      vi.spyOn(wm()._tilingShadow, "observeCommand").mockImplementation(() => {
        throw new Error("shadow invariant");
      });
      const legacy = vi.spyOn(wm().layoutEngine, "move");

      expect(() => wm().command({ name: "Move", direction: "UP" })).not.toThrow();

      expect(legacy).toHaveBeenCalled();
      expect(JSON.parse(wm().getTestStateJson()).portableTilingShadowFailure).toContain(
        "shadow invariant"
      );
    });

    it("should move window in the given direction", () => {
      const metaWindow = createMockWindow({ wm_class: "TestApp", title: "Test" });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
      ctx.display.get_focus_window.mockReturnValue(metaWindow);

      const unfreezeSpy = vi.spyOn(wm(), "unfreezeRender");
      const treeMoveSpy = vi.spyOn(wm().layoutEngine, "move");
      const portableSpy = vi.spyOn(wm()._tilingShadow, "observeCommand");

      wm().command({ name: "Move", direction: "UP" });

      expect(portableSpy).toHaveBeenCalledWith({ name: "Move", direction: "UP" }, metaWindow);
      expect(portableSpy.mock.invocationCallOrder[0]).toBeLessThan(
        treeMoveSpy.mock.invocationCallOrder[0]
      );
      expect(unfreezeSpy).toHaveBeenCalled();
      expect(treeMoveSpy).toHaveBeenCalled();
    });

    it("should queue event after move for stacked/tabbed handling", () => {
      const metaWindow = createMockWindow({ wm_class: "TestApp", title: "Test" });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
      ctx.display.get_focus_window.mockReturnValue(metaWindow);

      const queueSpy = vi.spyOn(wm()._eventScheduler, "enqueue");

      wm().command({ name: "Move", direction: "LEFT" });

      expect(queueSpy).toHaveBeenCalled();
    });
  });

  describe("Focus", () => {
    it("should call layoutEngine.focus with the resolved direction", () => {
      const metaWindow = createMockWindow({ wm_class: "TestApp", title: "Test" });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
      ctx.display.get_focus_window.mockReturnValue(metaWindow);

      const focusSpy = vi.spyOn(wm().layoutEngine, "focus");

      wm().command({ name: "Focus", direction: "DOWN" });

      expect(focusSpy).toHaveBeenCalled();
    });
  });

  describe("Swap", () => {
    it("should swap window in the given direction", () => {
      const metaWindow = createMockWindow({ wm_class: "TestApp", title: "Test" });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
      ctx.display.get_focus_window.mockReturnValue(metaWindow);

      const swapSpy = vi.spyOn(wm().layoutEngine, "swap");
      const pointerSpy = vi.spyOn(wm(), "notifyFocusChanged");

      wm().command({ name: "Swap", direction: "RIGHT" });

      expect(swapSpy).toHaveBeenCalled();
      expect(pointerSpy).toHaveBeenCalled();
    });

    it("should do nothing if no focus node window", () => {
      const metaWindow = createMockWindow({ wm_class: "TestApp", title: "Test" });
      ctx.display.get_focus_window.mockReturnValue(metaWindow);

      const swapSpy = vi.spyOn(wm().layoutEngine, "swap");

      wm().command({ name: "Swap", direction: "RIGHT" });

      expect(swapSpy).not.toHaveBeenCalled();
    });
  });

  describe("Split", () => {
    it("should split the window container", () => {
      const metaWindow = createMockWindow({ wm_class: "TestApp", title: "Test" });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
      ctx.display.get_focus_window.mockReturnValue(metaWindow);

      const splitSpy = vi.spyOn(wm().layoutEngine, "split");

      wm().command({ name: "Split" });

      expect(splitSpy).toHaveBeenCalled();
    });

    it("should do nothing if no focus node window", () => {
      expect(() => wm().command({ name: "Split" })).not.toThrow();
    });

    it("should do nothing if parent layout is stacked", () => {
      const metaWindow = createMockWindow({ wm_class: "TestApp", title: "Test" });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
      node.parentNode.layout = LAYOUT_TYPES.STACKED;
      ctx.display.get_focus_window.mockReturnValue(metaWindow);

      const splitSpy = vi.spyOn(wm().layoutEngine, "split");

      wm().command({ name: "Split" });

      expect(splitSpy).not.toHaveBeenCalled();
    });

    it("should do nothing if parent layout is tabbed", () => {
      const metaWindow = createMockWindow({ wm_class: "TestApp", title: "Test" });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
      node.parentNode.layout = LAYOUT_TYPES.TABBED;
      ctx.display.get_focus_window.mockReturnValue(metaWindow);

      const splitSpy = vi.spyOn(wm().layoutEngine, "split");

      wm().command({ name: "Split" });

      expect(splitSpy).not.toHaveBeenCalled();
    });
  });

  describe("LayoutToggle", () => {
    it("should toggle between HSPLIT and VSPLIT", () => {
      const metaWindow = createMockWindow({ wm_class: "TestApp", title: "Test" });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
      ctx.display.get_focus_window.mockReturnValue(metaWindow);

      const initialLayout = node.parentNode.layout;

      wm().command({ name: "LayoutToggle" });

      expect(node.parentNode.layout).not.toBe(initialLayout);
    });

    it("should do nothing if no focus node window", () => {
      expect(() => wm().command({ name: "LayoutToggle" })).not.toThrow();
    });
  });

  describe("FocusBorderToggle", () => {
    it("should toggle the focus-border-toggle setting", () => {
      ctx.settings.set_boolean("focus-border-toggle", true);

      wm().command({ name: "FocusBorderToggle" });

      expect(ctx.settings.get_boolean("focus-border-toggle")).toBe(false);
    });

    it("should enable border when currently disabled", () => {
      ctx.settings.set_boolean("focus-border-toggle", false);

      wm().command({ name: "FocusBorderToggle" });

      expect(ctx.settings.get_boolean("focus-border-toggle")).toBe(true);
    });
  });

  describe("TilingModeToggle", () => {
    it("should toggle tiling mode off and float all windows", () => {
      ctx.settings.set_boolean("tiling-mode-enabled", true);
      const floatAllSpy = vi.spyOn(wm(), "floatAllWindows");

      wm().command({ name: "TilingModeToggle" });

      expect(ctx.settings.get_boolean("tiling-mode-enabled")).toBe(false);
      expect(floatAllSpy).toHaveBeenCalled();
    });

    it("should toggle tiling mode on and unfloat all windows", () => {
      ctx.settings.set_boolean("tiling-mode-enabled", false);
      const unfloatAllSpy = vi.spyOn(wm(), "unfloatAllWindows");

      wm().command({ name: "TilingModeToggle" });

      expect(ctx.settings.get_boolean("tiling-mode-enabled")).toBe(true);
      expect(unfloatAllSpy).toHaveBeenCalled();
    });
  });

  describe("GapSize", () => {
    it("should increase gap by the given amount", () => {
      ctx.settings.set_uint("window-gap-size-increment", 2);

      wm().command({ name: "GapSize", amount: 1 });

      expect(ctx.settings.get_uint("window-gap-size-increment")).toBe(3);
    });

    it("should decrease gap by the given amount", () => {
      ctx.settings.set_uint("window-gap-size-increment", 5);

      wm().command({ name: "GapSize", amount: -2 });

      expect(ctx.settings.get_uint("window-gap-size-increment")).toBe(3);
    });

    it("should clamp gap to minimum of 0", () => {
      ctx.settings.set_uint("window-gap-size-increment", 1);

      wm().command({ name: "GapSize", amount: -5 });

      expect(ctx.settings.get_uint("window-gap-size-increment")).toBe(0);
    });

    it("should clamp gap to maximum of 8", () => {
      ctx.settings.set_uint("window-gap-size-increment", 5);

      wm().command({ name: "GapSize", amount: 10 });

      expect(ctx.settings.get_uint("window-gap-size-increment")).toBe(8);
    });
  });

  describe("WorkspaceActiveTileToggle", () => {
    it("should add workspace to skip-tile list when not skipped", () => {
      ctx.settings.set_string("workspace-skip-tile", "");
      ctx.workspaceManager.get_active_workspace_index.mockReturnValue(1);

      wm().command({ name: "WorkspaceActiveTileToggle" });

      const skipList = ctx.settings.get_string("workspace-skip-tile");
      expect(skipList).toContain("1");
    });

    it("should remove workspace from skip-tile list when already skipped", () => {
      ctx.settings.set_string("workspace-skip-tile", "0,1,2");
      ctx.workspaceManager.get_active_workspace_index.mockReturnValue(1);

      wm().command({ name: "WorkspaceActiveTileToggle" });

      const skipList = ctx.settings.get_string("workspace-skip-tile");
      expect(skipList).not.toContain("1");
    });
  });

  describe("LayoutStackedToggle", () => {
    it("should toggle layout to stacked", () => {
      const metaWindow = createMockWindow({ wm_class: "TestApp", title: "Test" });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
      ctx.display.get_focus_window.mockReturnValue(metaWindow);

      wm().command({ name: "LayoutStackedToggle" });

      expect(node.parentNode.layout).toBe(LAYOUT_TYPES.STACKED);
    });

    it("should do nothing if stacked mode disabled", () => {
      ctx.settings.set_boolean("stacked-tiling-mode-enabled", false);
      const metaWindow = createMockWindow({ wm_class: "TestApp", title: "Test" });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
      ctx.display.get_focus_window.mockReturnValue(metaWindow);

      const beforeLayout = node.parentNode.layout;

      wm().command({ name: "LayoutStackedToggle" });

      expect(node.parentNode.layout).toBe(beforeLayout);
    });

    it("should do nothing if no focus node window", () => {
      expect(() => wm().command({ name: "LayoutStackedToggle" })).not.toThrow();
    });
  });

  describe("LayoutTabbedToggle", () => {
    it("should toggle layout to tabbed", () => {
      const metaWindow = createMockWindow({ wm_class: "TestApp", title: "Test" });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
      ctx.display.get_focus_window.mockReturnValue(metaWindow);

      wm().command({ name: "LayoutTabbedToggle" });

      expect(node.parentNode.layout).toBe(LAYOUT_TYPES.TABBED);
    });

    it("should do nothing if tabbed mode disabled", () => {
      ctx.settings.set_boolean("tabbed-tiling-mode-enabled", false);
      const metaWindow = createMockWindow({ wm_class: "TestApp", title: "Test" });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
      ctx.display.get_focus_window.mockReturnValue(metaWindow);

      const beforeLayout = node.parentNode.layout;

      wm().command({ name: "LayoutTabbedToggle" });

      expect(node.parentNode.layout).toBe(beforeLayout);
    });

    it("should do nothing if no focus node window", () => {
      expect(() => wm().command({ name: "LayoutTabbedToggle" })).not.toThrow();
    });
  });

  describe("CancelOperation", () => {
    it("should set cancelGrab when window is in GRAB_TILE mode", () => {
      const metaWindow = createMockWindow({ wm_class: "TestApp", title: "Test" });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
      node.mode = WINDOW_MODES.GRAB_TILE;
      ctx.display.get_focus_window.mockReturnValue(metaWindow);

      wm().command({ name: "CancelOperation" });

      expect(wm()._grab.cancelGrab).toBe(true);
    });

    it("should not set cancelGrab when window is not in GRAB_TILE mode", () => {
      const metaWindow = createMockWindow({ wm_class: "TestApp", title: "Test" });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
      ctx.display.get_focus_window.mockReturnValue(metaWindow);

      wm().command({ name: "CancelOperation" });

      expect(wm()._grab.cancelGrab).toBe(false);
    });
  });

  describe("WindowSwapLastActive", () => {
    it("should swap with last active window", () => {
      const metaWindow1 = createMockWindow({ id: 1, wm_class: "App1", title: "Window 1" });
      const metaWindow2 = createMockWindow({ id: 2, wm_class: "App2", title: "Window 2" });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow1);
      ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow2);
      ctx.display.get_focus_window.mockReturnValue(metaWindow1);

      const swapPairsSpy = vi.spyOn(wm().layoutEngine, "swapPairs");

      wm().command({ name: "WindowSwapLastActive" });

      expect(swapPairsSpy).toHaveBeenCalled();
    });
  });

  describe("ShowTabDecorationToggle", () => {
    it("should toggle showtab-decoration-enabled", () => {
      const metaWindow = createMockWindow({ wm_class: "TestApp", title: "Test" });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
      ctx.display.get_focus_window.mockReturnValue(metaWindow);
      ctx.settings.set_boolean("tabbed-tiling-mode-enabled", true);

      ctx.settings.set_boolean("showtab-decoration-enabled", true);
      wm().command({ name: "ShowTabDecorationToggle" });
      expect(ctx.settings.get_boolean("showtab-decoration-enabled")).toBe(false);

      ctx.settings.set_boolean("showtab-decoration-enabled", false);
      wm().command({ name: "ShowTabDecorationToggle" });
      expect(ctx.settings.get_boolean("showtab-decoration-enabled")).toBe(true);
    });

    it("should do nothing if tabbed mode disabled", () => {
      const metaWindow = createMockWindow({ wm_class: "TestApp", title: "Test" });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
      ctx.display.get_focus_window.mockReturnValue(metaWindow);
      ctx.settings.set_boolean("tabbed-tiling-mode-enabled", false);

      ctx.settings.set_boolean("showtab-decoration-enabled", true);
      wm().command({ name: "ShowTabDecorationToggle" });
      expect(ctx.settings.get_boolean("showtab-decoration-enabled")).toBe(true);
    });

    it("toggles the platform setting without a legacy focus node", () => {
      ctx.settings.set_boolean("tabbed-tiling-mode-enabled", true);
      ctx.settings.set_boolean("showtab-decoration-enabled", true);

      expect(() => wm().command({ name: "ShowTabDecorationToggle" })).not.toThrow();
      expect(ctx.settings.get_boolean("showtab-decoration-enabled")).toBe(false);
    });

    it("updates core policy without dispatching through the legacy tree", () => {
      wm()._tilingEngineMode = "core";
      ctx.settings.set_boolean("tabbed-tiling-mode-enabled", true);
      ctx.settings.set_boolean("showtab-decoration-enabled", true);
      const observePolicy = vi.spyOn(wm()._tilingShadow, "observePolicy");
      const legacyDispatch = vi.spyOn(wm()._commandBus, "dispatch");

      wm().command({ name: "ShowTabDecorationToggle" });

      expect(ctx.settings.get_boolean("showtab-decoration-enabled")).toBe(false);
      expect(observePolicy).toHaveBeenCalledOnce();
      expect(legacyDispatch).not.toHaveBeenCalled();
    });
  });

  describe("WindowResize", () => {
    function setupResizeWindow() {
      const metaWindow = createMockWindow({ wm_class: "TestApp", title: "Test" });
      metaWindow._workspace = ctx.workspaces[0];
      const { monitor } = getWorkspaceAndMonitor(ctx);
      ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
      ctx.display.get_focus_window.mockReturnValue(metaWindow);
      return metaWindow;
    }

    it("should resize window to the right", () => {
      const metaWindow = setupResizeWindow();
      const grabBegin = vi.spyOn(wm()._grab, "begin");

      wm().command({ name: "WindowResize", direction: "Right", amount: 10 });

      // Assert through the grab-session owner, not the WM resize facade (S7).
      expect(grabBegin).toHaveBeenCalledWith(
        expect.anything(),
        metaWindow,
        Meta.GrabOp.KEYBOARD_RESIZING_E
      );
    });

    it("should resize window to the left", () => {
      const metaWindow = setupResizeWindow();
      const grabBegin = vi.spyOn(wm()._grab, "begin");

      wm().command({ name: "WindowResize", direction: "Left", amount: 10 });

      expect(grabBegin).toHaveBeenCalledWith(
        expect.anything(),
        metaWindow,
        Meta.GrabOp.KEYBOARD_RESIZING_W
      );
    });

    it("should resize window upward", () => {
      const metaWindow = setupResizeWindow();
      const grabBegin = vi.spyOn(wm()._grab, "begin");

      wm().command({ name: "WindowResize", direction: "Top", amount: 10 });

      expect(grabBegin).toHaveBeenCalledWith(
        expect.anything(),
        metaWindow,
        Meta.GrabOp.KEYBOARD_RESIZING_N
      );
    });

    it("should resize window downward", () => {
      const metaWindow = setupResizeWindow();
      const grabBegin = vi.spyOn(wm()._grab, "begin");

      wm().command({ name: "WindowResize", direction: "Bottom", amount: 10 });

      expect(grabBegin).toHaveBeenCalledWith(
        expect.anything(),
        metaWindow,
        Meta.GrabOp.KEYBOARD_RESIZING_S
      );
    });

    it("should do nothing if no focus window", () => {
      ctx.display.get_focus_window.mockReturnValue(null);
      expect(() =>
        wm().command({ name: "WindowResize", direction: "Right", amount: 10 })
      ).not.toThrow();
    });

    it("dispatches core keyboard resize through the portable operation adapter", () => {
      const metaWindow = setupResizeWindow();
      wm()._tilingEngineMode = "core";
      const portableResize = vi.spyOn(wm()._tilingShadow, "observeKeyboardResize");
      const legacyDispatch = vi.spyOn(wm()._commandBus, "dispatch");

      wm().command({ name: "WindowResize", direction: "Right", amount: 192 });

      expect(portableResize).toHaveBeenCalledWith(metaWindow, Meta.GrabOp.KEYBOARD_RESIZING_E, 192);
      expect(legacyDispatch).not.toHaveBeenCalled();
    });
  });

  describe("WindowClose", () => {
    it("should close the focused window", () => {
      const metaWindow = createMockWindow({ wm_class: "TestApp", title: "Test" });
      ctx.display.get_focus_window.mockReturnValue(metaWindow);
      const deleteSpy = vi.spyOn(metaWindow, "delete");

      wm().command({ name: "WindowClose" });

      expect(deleteSpy).toHaveBeenCalled();
    });

    it("should do nothing if no focus window", () => {
      ctx.display.get_focus_window.mockReturnValue(null);

      expect(() => wm().command({ name: "WindowClose" })).not.toThrow();
    });
  });

  describe("unknown command", () => {
    it("should not throw for unknown action", () => {
      expect(() => wm().command({ name: "NonExistentAction" })).not.toThrow();
    });
  });
});
