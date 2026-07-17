/*
 * AnvilRuntime lifecycle tests
 *
 * Tests for trackWindow, _validWindow, windowDestroy, minimizedWindow,
 * and postProcessWindow
 * Ported from jcrussell/forge
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import GLib from "gi://GLib";
import Meta from "gi://Meta";
import { WINDOW_MODES } from "../../../src/lib/extension/window/constants.js";
import { NODE_TYPES } from "../../../src/lib/extension/tree.js";
import {
  createMockWindow,
  createAnvilRuntimeFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";

describe("AnvilRuntime - Lifecycle", () => {
  let ctx: any;

  beforeEach(() => {
    ctx = createAnvilRuntimeFixture();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    ctx.cleanup();
  });

  const wm = () => ctx.anvilRuntime;
  const configMgr = () => ctx.configMgr;

  it("embeds the portable inspection in the runtime test probe", () => {
    const state = JSON.parse(wm().getTestStateJson());

    expect(state.portableTiling.schemaVersion).toBe(1);
    expect(state.portableTiling.surfaces).toHaveLength(1);
    expect(state.portablePresentation).toMatchObject({ revision: expect.any(Number), windows: [] });
  });

  describe("_validWindow", () => {
    it("should accept NORMAL windows", () => {
      const window = createMockWindow({ window_type: Meta.WindowType.NORMAL });
      expect(wm()._tracker.validWindow(window)).toBe(true);
    });

    it("should accept DIALOG windows", () => {
      const window = createMockWindow({ window_type: Meta.WindowType.DIALOG });
      expect(wm()._tracker.validWindow(window)).toBe(true);
    });

    it("should accept MODAL_DIALOG windows", () => {
      const window = createMockWindow({ window_type: Meta.WindowType.MODAL_DIALOG });
      expect(wm()._tracker.validWindow(window)).toBe(true);
    });

    it("should reject UTILITY windows", () => {
      const window = createMockWindow({ window_type: Meta.WindowType.UTILITY });
      expect(wm()._tracker.validWindow(window)).toBe(false);
    });

    it("should reject POPUP_MENU windows", () => {
      const window = createMockWindow({ window_type: Meta.WindowType.POPUP_MENU });
      expect(wm()._tracker.validWindow(window)).toBe(false);
    });

    it("should reject DROPDOWN_MENU windows", () => {
      const window = createMockWindow({ window_type: Meta.WindowType.DROPDOWN_MENU });
      expect(wm()._tracker.validWindow(window)).toBe(false);
    });

    it("should reject TOOLTIP windows", () => {
      const window = createMockWindow({ window_type: Meta.WindowType.TOOLTIP });
      expect(wm()._tracker.validWindow(window)).toBe(false);
    });

    it("should reject XWayland Video Bridge windows", () => {
      const window = createMockWindow({
        wm_class: "xwaylandvideobridge",
        title: "Video Bridge",
      });
      expect(wm()._tracker.validWindow(window)).toBe(false);
    });

    it("should reject ddterm windows", () => {
      const window = createMockWindow({
        wm_class: "ddterm",
        title: "ddterm",
      });
      expect(wm()._tracker.validWindow(window)).toBe(false);
    });

    it("should reject XWayland Video Bridge case-insensitively", () => {
      const window = createMockWindow({
        wm_class: "XWaylandVideoBridge",
        title: "Video Bridge",
      });
      expect(wm()._tracker.validWindow(window)).toBe(false);
    });
  });

  describe("minimizedWindow", () => {
    it("should return true for minimized window", () => {
      const metaWindow = createMockWindow({ minimized: true });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const nodeWindow = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);

      expect(wm().minimizedWindow(nodeWindow)).toBe(true);
    });

    it("should return false for non-minimized window", () => {
      const metaWindow = createMockWindow({ minimized: false });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const nodeWindow = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);

      expect(wm().minimizedWindow(nodeWindow)).toBe(false);
    });

    it("should return false for null node", () => {
      expect(wm().minimizedWindow(null)).toBe(false);
    });

    it("should return false for non-window nodes", () => {
      const { monitor } = getWorkspaceAndMonitor(ctx);

      expect(wm().minimizedWindow(monitor)).toBe(false);
    });
  });

  describe("postProcessWindow", () => {
    it("should do nothing for null node", () => {
      expect(() => wm()._tracker.postProcessWindow(null)).not.toThrow();
    });

    it("should move pointer to window node", () => {
      const pointerSpy = vi.spyOn(wm(), "notifyFocusChanged").mockImplementation(() => {});
      const metaWindow = createMockWindow({
        wm_class: "TestApp",
        title: "Test Window",
      });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const nodeWindow = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);

      wm()._tracker.postProcessWindow(nodeWindow);

      expect(pointerSpy).toHaveBeenCalledWith(nodeWindow, "window-create");
    });
  });

  describe("windowDestroy", () => {
    it("withdraws the portable fact before mutating the legacy tree", () => {
      const metaWindow = createMockWindow({ wm_class: "TestApp", title: "Test" });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
      const withdraw = vi.spyOn(wm()._tilingShadow, "withdrawWindow");
      const remove = vi.spyOn(ctx.tree, "removeNode");

      wm()._tracker.windowDestroy(metaWindow.get_compositor_private());

      expect(withdraw).toHaveBeenCalledWith(metaWindow);
      expect(withdraw.mock.invocationCallOrder[0]).toBeLessThan(remove.mock.invocationCallOrder[0]);
    });

    it("should clean up border and remove node from tree", () => {
      const metaWindow = createMockWindow({ wm_class: "TestApp", title: "Test" });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);

      expect(ctx.tree.findNode(metaWindow)).not.toBeNull();

      const actor = metaWindow.get_compositor_private();
      wm()._tracker.windowDestroy(actor);

      expect(ctx.tree.findNode(metaWindow)).toBeNull();
    });

    it("removes the node after Mutter disposes the window actor", () => {
      const metaWindow = createMockWindow({ wm_class: "TestApp", title: "Test" });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
      const actor = metaWindow.get_compositor_private();
      vi.spyOn(metaWindow, "get_compositor_private").mockReturnValue(null);
      const renderSpy = vi.spyOn(wm(), "renderTree").mockImplementation(() => {});

      wm()._tracker.windowDestroy(actor, metaWindow, true);

      expect(ctx.tree.findNode(metaWindow)).toBeNull();
      expect(renderSpy).toHaveBeenCalledWith("window-destroy", true);
    });

    it("should remove float override on destroy", () => {
      const metaWindow = createMockWindow({ wm_class: "TestApp", title: "Test" });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);

      configMgr().windowProps.overrides = [{ wmClass: "TestApp", mode: "float" }];
      const removeSpy = vi.spyOn(wm(), "removeFloatOverride");

      const actor = metaWindow.get_compositor_private();
      wm()._tracker.windowDestroy(actor);

      expect(removeSpy).toHaveBeenCalledWith(metaWindow, true);
    });

    it("should restore focus if destroyed window had focus", () => {
      const metaWindow1 = createMockWindow({
        id: 1,
        wm_class: "App1",
        title: "Window 1",
      });
      const metaWindow2 = createMockWindow({
        id: 2,
        wm_class: "App2",
        title: "Window 2",
      });

      const { monitor } = getWorkspaceAndMonitor(ctx);
      ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow1);
      ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow2);

      ctx.display.get_focus_window.mockReturnValue(metaWindow1);
      const raiseSpy = vi.spyOn(metaWindow2, "raise");
      const focusSpy = vi.spyOn(metaWindow2, "focus");

      const actor = metaWindow1.get_compositor_private();
      wm()._tracker.windowDestroy(actor);

      expect(ctx.tree.findNode(metaWindow1)).toBeNull();
      expect(raiseSpy).toHaveBeenCalled();
      expect(focusSpy).toHaveBeenCalled();
    });

    it("falls back to a current-workspace window when the closed window has no sibling", () => {
      const closed = createMockWindow({ id: 1, wm_class: "App1", title: "Closed" });
      const fallback = createMockWindow({ id: 2, wm_class: "App2", title: "Fallback" });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, closed);
      ctx.workspaces[0]._windows = [fallback];
      ctx.display.get_focus_window.mockReturnValue(closed);
      const raiseSpy = vi.spyOn(fallback, "raise");
      const focusSpy = vi.spyOn(fallback, "focus");

      wm()._tracker.windowDestroy(closed.get_compositor_private());

      expect(raiseSpy).toHaveBeenCalled();
      expect(focusSpy).toHaveBeenCalled();
    });

    it("should not renderTree when destroying an ephemeral helper window", () => {
      const metaWindow = createMockWindow({
        wm_class: "wl-clipboard",
        title: "wl-clipboard",
        rect: { x: 640, y: 416, width: 1, height: 1 },
      });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);

      const renderSpy = vi.spyOn(wm(), "renderTree").mockImplementation(() => {});
      wm()._tracker.windowDestroy(metaWindow.get_compositor_private());

      expect(renderSpy).not.toHaveBeenCalled();
    });

    it("should not throw for missing actor properties", () => {
      const actor = {
        border: null,
        splitBorder: null,
        actorSignals: null,
        connect: vi.fn(),
        disconnect: vi.fn(),
        remove_all_transitions: vi.fn(),
      };

      expect(() => wm()._tracker.windowDestroy(actor)).not.toThrow();
    });
  });

  describe("trackWindow", () => {
    it("removes a legacy node when the Meta window becomes unmanaged", () => {
      const window = createMockWindow({ workspace: ctx.workspaces[0] });
      wm()._tracker.trackWindow(ctx.display, window);
      expect(ctx.tree.findNode(window)).not.toBeNull();

      window.emit("unmanaged", window);

      expect(ctx.tree.findNode(window)).toBeNull();
    });

    it("observes the portable fact before mutating the legacy tree", () => {
      const window = createMockWindow({ workspace: ctx.workspaces[0] });
      const observe = vi.spyOn(wm()._tilingShadow, "observeWindow");
      const createNode = vi.spyOn(ctx.tree, "createNode");

      wm()._tracker.trackWindow(ctx.display, window);

      expect(observe).toHaveBeenCalledWith(window);
      expect(observe.mock.invocationCallOrder[0]).toBeLessThan(
        createNode.mock.invocationCallOrder.at(-1)!
      );
    });

    it("observes frame signals before legacy geometry handling", () => {
      const window = createMockWindow({ workspace: ctx.workspaces[0] });
      const observe = vi.spyOn(wm()._tilingShadow, "observeFrame");
      const legacy = vi.spyOn(wm(), "updateMetaPositionSize").mockImplementation(() => {});
      wm()._tracker.trackWindow(ctx.display, window);

      window.emit("position-changed", window);

      expect(observe).toHaveBeenCalledWith(window);
      expect(observe.mock.invocationCallOrder[0]).toBeLessThan(legacy.mock.invocationCallOrder[0]);
    });

    it("observes focus before legacy focus handling", () => {
      const window = createMockWindow({ workspace: ctx.workspaces[0] });
      const observe = vi.spyOn(wm()._tilingShadow, "observeFocus");
      const legacy = vi.spyOn(wm()._eventScheduler, "enqueue");
      const setActiveDecoration = vi.spyOn(wm()._borders, "setActiveWindow");
      const render = vi.spyOn(wm(), "renderTree");
      wm()._tracker.trackWindow(ctx.display, window);
      observe.mockClear();
      legacy.mockClear();
      setActiveDecoration.mockClear();
      render.mockClear();

      window.emit("focus", window);

      expect(observe).toHaveBeenCalledWith(window);
      expect(setActiveDecoration).toHaveBeenCalledExactlyOnceWith(window);
      expect(render).toHaveBeenCalledWith("focus", true, "skip");
      expect(observe.mock.invocationCallOrder[0]).toBeLessThan(legacy.mock.invocationCallOrder[0]);
    });

    it("keeps floating-window focus raises on the active-only decoration path", () => {
      const window = createMockWindow({ workspace: ctx.workspaces[0] });
      const enqueue = vi.spyOn(wm()._eventScheduler, "enqueue");
      const render = vi.spyOn(wm(), "renderTree");
      wm()._tracker.trackWindow(ctx.display, window);
      ctx.tree.findNode(window).mode = WINDOW_MODES.FLOAT;
      ctx.display.get_focus_window.mockReturnValue(window);
      enqueue.mockClear();
      render.mockClear();

      window.emit("focus", window);
      const raise = enqueue.mock.calls
        .map(([event]) => event as { name: string; callback: () => void })
        .find((event) => event.name === "raise-float");
      expect(raise).toBeDefined();

      render.mockClear();
      raise!.callback();
      expect(render).toHaveBeenCalledExactlyOnceWith("raise-float-queue", false, "skip");
    });

    it("uses the surgical active-decoration update for core focus changes", () => {
      const window = createMockWindow({ workspace: ctx.workspaces[0] });
      const setActiveDecoration = vi.spyOn(wm()._borders, "setActiveWindow");
      wm()._tilingEngineMode = "core";
      wm()._tracker.trackWindow(ctx.display, window);
      setActiveDecoration.mockClear();

      window.emit("focus", window);

      expect(setActiveDecoration).toHaveBeenCalledExactlyOnceWith(window);
    });

    it("observes minimized availability before legacy rendering", () => {
      const window = createMockWindow({ workspace: ctx.workspaces[0] });
      const observe = vi.spyOn(wm()._tilingShadow, "observeWindow");
      const legacy = vi.spyOn(wm(), "renderTree");
      wm()._tracker.trackWindow(ctx.display, window);
      observe.mockClear();
      legacy.mockClear();
      window.minimized = true;

      window.emit("notify::minimized", window);

      expect(observe).toHaveBeenCalledWith(window);
      expect(observe.mock.invocationCallOrder[0]).toBeLessThan(legacy.mock.invocationCallOrder[0]);
    });

    it("should not add invalid window types to tree", () => {
      const window = createMockWindow({
        window_type: Meta.WindowType.UTILITY,
        wm_class: "Utility",
        title: "Utility",
      });

      const initialWindowCount = ctx.tree.getNodeByType(NODE_TYPES.WINDOW).length;

      wm()._tracker.trackWindow(ctx.display, window);

      const afterCount = ctx.tree.getNodeByType(NODE_TYPES.WINDOW).length;

      expect(afterCount).toBe(initialWindowCount);
    });

    it("should not track ephemeral clipboard helper windows", () => {
      const window = createMockWindow({
        wm_class: "wl-clipboard",
        title: "wl-clipboard",
        rect: { x: 640, y: 416, width: 1, height: 1 },
      });

      const initialWindowCount = ctx.tree.getNodeByType(NODE_TYPES.WINDOW).length;

      wm()._tracker.trackWindow(ctx.display, window);

      expect(ctx.tree.getNodeByType(NODE_TYPES.WINDOW).length).toBe(initialWindowCount);
    });

    it("should not track XWayland Video Bridge windows", () => {
      const window = createMockWindow({
        wm_class: "xwaylandvideobridge",
        title: "Video Bridge",
      });

      const initialCount = ctx.tree.getNodeByType(NODE_TYPES.WINDOW).length;

      wm()._tracker.trackWindow(ctx.display, window);

      const afterCount = ctx.tree.getNodeByType(NODE_TYPES.WINDOW).length;

      expect(afterCount).toBe(initialCount);
    });
  });

  describe("isFloatingExempt (late metadata)", () => {
    it("should not force-float a NORMAL window when wm_class and title are null (e.g. Inkscape at window-created)", () => {
      const window = createMockWindow({
        wm_class: null,
        title: null,
        window_type: Meta.WindowType.NORMAL,
        allows_resize: true,
      });
      // Critical for delayed tracking: previously this returned true, forcing the window
      // to stay floating even though it is a regular app window.
      expect(wm().isFloatingExempt(window)).toBe(false);
    });

    it("should not force-float a NORMAL window with empty title when class is present", () => {
      const window = createMockWindow({
        title: "",
        window_type: Meta.WindowType.NORMAL,
      });
      expect(wm().isFloatingExempt(window)).toBe(false);
    });

    it("should still float DIALOG windows regardless of class/title", () => {
      const window = createMockWindow({
        wm_class: null,
        title: null,
        window_type: Meta.WindowType.DIALOG,
      });
      expect(wm().isFloatingExempt(window)).toBe(true);
    });
  });

  describe("pending window tracking", () => {
    it("should track an initially invalid window as soon as Meta marks it tileable", () => {
      const window = createMockWindow({
        wm_class: null,
        title: null,
        window_type: Meta.WindowType.UTILITY,
      });
      const renderSpy = vi.spyOn(wm(), "renderTree").mockImplementation(() => {});

      wm()._tracker.trackWhenReady(ctx.display, window);

      expect(ctx.tree.findNode(window)).toBeNull();
      expect(window.getHandlerCount("notify::window-type")).toBe(1);

      window._window_type = Meta.WindowType.NORMAL;
      window.wm_class = "org.inkscape.Inkscape";
      window.title = "New Document 1 - Inkscape";
      window.emit("notify::window-type");

      expect(ctx.tree.findNode(window)?.mode).toBe(WINDOW_MODES.TILE);
      expect(window.getHandlerCount("notify::window-type")).toBe(0);
      expect(renderSpy).toHaveBeenCalledWith("window-create", true);
    });

    it("should track valid windows immediately when their actor maps", () => {
      const window = createMockWindow({
        wm_class: "Brave-browser",
        title: "New Tab - Brave",
        window_type: Meta.WindowType.NORMAL,
      });
      const renderSpy = vi.spyOn(wm(), "renderTree").mockImplementation(() => {});

      wm()._tracker.trackMappedActor({ meta_window: window } as any);

      expect(ctx.tree.findNode(window)?.mode).toBe(WINDOW_MODES.TILE);
      expect(renderSpy).toHaveBeenCalledWith("window-create", true);
    });

    it("registers decorations when a tracked Xwayland window maps its actor later", () => {
      ctx.settings.set_boolean("focus-border-toggle", true);
      const window = createMockWindow({
        wm_class: "obsidian",
        title: "Obsidian",
        window_type: Meta.WindowType.NORMAL,
      });
      const actor = window.get_compositor_private();
      const getActor = vi.spyOn(window, "get_compositor_private").mockReturnValue(null);
      ctx.display.get_focus_window.mockReturnValue(window);

      wm()._tracker.trackWhenReady(ctx.display, window);

      expect(ctx.tree.findNode(window)).not.toBeNull();
      expect(actor.cornerShadow).toBeUndefined();

      getActor.mockReturnValue(actor);
      wm()._tracker.trackMappedActor(actor);

      const surface = actor.get_children().find((child: any) => child !== actor.cornerShadow);
      expect(surface.get_effect("anvil-window-corner-mask")).toBeTruthy();
      expect(actor.cornerShadow?.get_parent()).toBe(actor);
      expect(actor.border?.visible).toBe(true);
    });

    it("should reconcile valid windows already present before their actor maps", () => {
      let reconcileCallback: (() => boolean) | null = null;
      vi.spyOn(GLib, "timeout_add").mockImplementation((_priority, _interval, callback) => {
        reconcileCallback = callback as () => boolean;
        return 1;
      });

      const window = createMockWindow({
        wm_class: "org.inkscape.Inkscape",
        title: "New Document 1 - Inkscape",
        window_type: Meta.WindowType.NORMAL,
      });
      ctx.display.get_tab_list.mockReturnValue([window]);
      const renderSpy = vi.spyOn(wm(), "renderTree").mockImplementation(() => {});

      wm()._tracker.scheduleReconcile();

      expect(ctx.tree.findNode(window)).toBeNull();
      expect(reconcileCallback).not.toBeNull();

      reconcileCallback!();

      expect(ctx.tree.findNode(window)?.mode).toBe(WINDOW_MODES.TILE);
      expect(renderSpy).toHaveBeenCalledWith("window-create", true);
    });

    it("should reconcile valid actor windows before they appear in the tab list", () => {
      const window = createMockWindow({
        wm_class: "org.inkscape.Inkscape",
        title: "New Document 1 - Inkscape",
        window_type: Meta.WindowType.NORMAL,
      });
      ctx.display.get_tab_list.mockReturnValue([]);
      (global as any).get_window_actors.mockReturnValue([{ meta_window: window }]);
      const renderSpy = vi.spyOn(wm(), "renderTree").mockImplementation(() => {});

      wm()._tracker.reconcileCurrentWindows("test-reconcile");

      expect(ctx.tree.findNode(window)?.mode).toBe(WINDOW_MODES.TILE);
      expect(renderSpy).toHaveBeenCalledWith("window-create", true);
    });
  });

  describe("bindWorkspaceSignals", () => {
    it("defers admission unmaximize until after workspace window-added returns", () => {
      const workspace = ctx.workspaces[0];
      const window = createMockWindow({
        id: 42,
        wm_class: "Godot",
        title: "Gray Horizon - Godot Engine",
        workspace,
        maximized_horizontally: true,
        maximized_vertically: true,
      });
      const unmaximize = vi.spyOn(window, "unmaximize");
      const enqueue = vi.spyOn(wm()._eventScheduler, "enqueue");

      (wm() as any)._signalManager._signalsBound = true;
      (wm() as any)._signalManager.bindWorkspaceSignals(workspace);
      workspace.emit("window-added", workspace, window);

      expect(unmaximize).not.toHaveBeenCalled();
      const admissionUnmaximize = enqueue.mock.calls
        .map(([event]) => event as { name: string; callback: () => void })
        .find((event) => event.name === "admission-unmaximize:42");
      expect(admissionUnmaximize).toBeDefined();

      admissionUnmaximize!.callback();

      expect(unmaximize).toHaveBeenCalledOnce();
    });

    it("should track valid windows immediately from workspace window-added callbacks", () => {
      const workspace = ctx.workspaces[0];
      const window = createMockWindow({
        id: 42,
        wm_class: "org.gnome.TextEditor",
        title: "New Document - Text Editor",
        workspace,
      });

      // S2: bindWorkspaceSignals is lifecycle-gated (no connects outside enable).
      // Simulate the bound state that enable()/bindAll() would establish.
      (wm() as any)._signalManager._signalsBound = true;
      (wm() as any)._signalManager.bindWorkspaceSignals(workspace);
      workspace.emit("window-added", workspace, window);

      expect(ctx.tree.findNode(window)).not.toBeNull();
    });
  });

  describe("enable/disable workspace transition flag (S4)", () => {
    it("graph initialization resets a stuck workspaceChanging flag", () => {
      // Simulate a disable that fired mid-transition (timer cancelled, flag left true).
      wm()._workspaceChanging = true;

      (wm() as any)._initializeGraph();

      expect(wm()._workspaceChanging).toBe(false);
    });
  });
});
