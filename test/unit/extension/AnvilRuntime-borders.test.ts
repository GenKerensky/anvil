/*
 * AnvilRuntime border actor tests
 *
 * Tests for lazy border actor creation, settings toggles, and split-border visibility.
 */

import { describe, it, expect, vi } from "vitest";
import Clutter from "gi://Clutter";
import St from "gi://St";
import { Logger } from "../../../src/lib/shared/logger.js";
import { WindowCornerMaskEffect } from "../../../src/lib/extension/window-corner-mask-effect.js";
import { LAYOUT_TYPES, NODE_TYPES } from "../../../src/lib/extension/tree.js";
import {
  createMockWindow,
  createAnvilRuntimeFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";

describe("AnvilRuntime - Borders", () => {
  const windowSurface = (actor: any) =>
    actor.get_children().find((child: any) => child !== actor.cornerShadow) ?? null;
  const mask = (actor: any) => windowSurface(actor)?.get_effect("anvil-window-corner-mask") ?? null;

  const trackTestWindow = (
    ctx: any,
    window = createMockWindow({
      wm_class: "TestApp",
      title: "Test Window",
      workspace: ctx.workspaces[0],
    })
  ) => {
    vi.spyOn(ctx.anvilRuntime._tracker, "postProcessWindow").mockImplementation(() => {});
    vi.spyOn(ctx.anvilRuntime._eventScheduler, "enqueue").mockImplementation(() => {});
    ctx.anvilRuntime._tracker.trackWindow(ctx.display, window);
    return window;
  };

  it("clips source shadow pixels before painting the rounded replacement shadow", () => {
    const effect = new WindowCornerMaskEffect();
    const addSnippet = vi.spyOn(effect, "add_glsl_snippet");

    effect.vfunc_build_pipeline();

    expect(addSnippet).toHaveBeenCalledOnce();
    expect(addSnippet.mock.calls[0][2]).toContain(": 0.0;");
  });

  describe("trackWindow border actors", () => {
    it("owns each rounded replacement shadow inside its masked window actor", () => {
      const ctx = createAnvilRuntimeFixture({
        settings: { "focus-border-toggle": true, "split-border-toggle": false },
      });
      const window = createMockWindow({ workspace: ctx.workspaces[0] });
      const actor = window.get_compositor_private();
      const surface = actor.get_first_child();
      ctx.windowGroup.add_child(actor);

      trackTestWindow(ctx, window);

      expect(mask(actor)).toBeTruthy();
      expect(actor.cornerShadow).toBeTruthy();
      expect(actor.cornerShadow.get_parent()).toBe(actor);
      expect(actor.get_children()).toEqual([actor.cornerShadow, surface]);
      expect(ctx.windowGroup.contains(actor.cornerShadow)).toBe(false);
      expect(actor.cornerShadow.style_class).toBe("window-unfocused-shadow");
      expect(actor.cornerShadow.x).toBe(-3);
      expect(actor.cornerShadow.y).toBe(-3);
    });

    it("switches replacement shadow style with compositor focus", () => {
      const ctx = createAnvilRuntimeFixture({
        settings: { "focus-border-toggle": true, "split-border-toggle": false },
      });
      const window = createMockWindow({ workspace: ctx.workspaces[0] });
      ctx.windowGroup.add_child(window.get_compositor_private());
      trackTestWindow(ctx, window);

      window.appears_focused_value = true;
      ctx.anvilRuntime._borders.setActiveWindow(window);
      ctx.anvilRuntime._borders.reconcileWindow(window);

      expect(window.get_compositor_private().cornerShadow.style_class).toBe(
        "window-focused-shadow"
      );
    });

    it("should not create a border actor when both border prefs are false", () => {
      const ctx = createAnvilRuntimeFixture({
        settings: {
          "focus-border-toggle": false,
          "split-border-toggle": false,
        },
      });

      const window = trackTestWindow(ctx);
      const actor = window.get_compositor_private();
      ctx.anvilRuntime._borders.setActiveWindow(window);

      expect(actor.border).toBeFalsy();
    });

    it("should create a border actor when focus-border-toggle is true", () => {
      const ctx = createAnvilRuntimeFixture({
        settings: {
          "focus-border-toggle": true,
          "split-border-toggle": false,
          "focus-border-hidden-on-single": false,
        },
      });
      ctx.settings.set_uint("window-gap-size", 5);
      ctx.settings.set_uint("window-gap-size-increment", 1);

      const window = trackTestWindow(ctx);
      const actor = window.get_compositor_private();
      ctx.anvilRuntime._borders.setActiveWindow(window);

      expect(actor.border).not.toBeNull();
      expect(ctx.windowGroup.contains(actor.border)).toBe(true);
      expect(mask(actor)).toBeTruthy();
      expect(actor.get_effect("anvil-window-corner-mask")).toBeNull();
    });

    it("should continuously mask unfocused tracked windows while hints are enabled", () => {
      const ctx = createAnvilRuntimeFixture({
        settings: {
          "focus-border-toggle": true,
          "split-border-toggle": false,
        },
      });

      const first = trackTestWindow(ctx);
      const second = trackTestWindow(ctx);

      expect(mask(first.get_compositor_private())).toBeTruthy();
      expect(mask(second.get_compositor_private())).toBeTruthy();
    });

    it("keeps the mask radius in the theme node's actor coordinate space", () => {
      const scale = vi.spyOn(St.ThemeContext.prototype, "scale_factor", "get").mockReturnValue(2);
      const update = vi
        .spyOn(WindowCornerMaskEffect.prototype, "update")
        .mockImplementation(() => {});
      const ctx = createAnvilRuntimeFixture({
        settings: {
          "focus-border-toggle": true,
          "split-border-toggle": false,
        },
      });

      trackTestWindow(ctx);

      expect(update).toHaveBeenCalledWith(expect.any(Array), 15);
      update.mockRestore();
      scale.mockRestore();
    });

    it("expresses frame bounds relative to the window buffer", () => {
      const update = vi
        .spyOn(WindowCornerMaskEffect.prototype, "update")
        .mockImplementation(() => {});
      const ctx = createAnvilRuntimeFixture({
        settings: {
          "focus-border-toggle": true,
          "split-border-toggle": false,
        },
      });
      const window = createMockWindow({
        rect: { x: 8, y: 40, width: 100, height: 100 },
        workspace: ctx.workspaces[0],
      });
      vi.spyOn(window, "get_buffer_rect").mockReturnValue({
        x: -2,
        y: 30,
        width: 120,
        height: 120,
      });

      trackTestWindow(ctx, window);

      expect(update).toHaveBeenCalledWith([10, 10, 110, 110], 15);
      update.mockRestore();
    });

    it("does not repaint an unchanged corner mask", () => {
      const repaint = vi.spyOn(WindowCornerMaskEffect.prototype, "queue_repaint");
      const ctx = createAnvilRuntimeFixture({
        settings: { "focus-border-toggle": true, "split-border-toggle": false },
      });
      const window = createMockWindow({ workspace: ctx.workspaces[0] });
      ctx.windowGroup.add_child(window.get_compositor_private());
      trackTestWindow(ctx, window);

      repaint.mockClear();
      ctx.anvilRuntime._borders.reconcileWindow(window);

      expect(repaint).not.toHaveBeenCalled();
    });

    it("defers masking until the window surface actor exists", () => {
      const ctx = createAnvilRuntimeFixture({
        settings: { "focus-border-toggle": true, "split-border-toggle": false },
      });
      const window = createMockWindow({ workspace: ctx.workspaces[0] });
      const actor = window.get_compositor_private();
      actor._children = [];

      trackTestWindow(ctx, window);
      expect(mask(actor)).toBeNull();

      actor.add_child(new Clutter.Actor());
      ctx.anvilRuntime._borders.reconcileWindow(window);
      expect(mask(actor)).toBeTruthy();
    });

    it("moves the mask when Mutter replaces a window surface actor", () => {
      const ctx = createAnvilRuntimeFixture({
        settings: { "focus-border-toggle": true, "split-border-toggle": false },
      });
      const window = trackTestWindow(ctx);
      const actor = window.get_compositor_private();
      const previousSurface = windowSurface(actor);
      const nextSurface = new Clutter.Actor();
      const disconnect = vi.spyOn(previousSurface, "disconnect");

      actor._children = [actor.cornerShadow, nextSurface];
      ctx.anvilRuntime._borders.reconcileWindow(window);

      expect(previousSurface.get_effect("anvil-window-corner-mask")).toBeNull();
      expect(disconnect).toHaveBeenCalledOnce();
      expect(nextSurface.get_effect("anvil-window-corner-mask")).toBeTruthy();
    });

    it("forgets a mask target when Mutter destroys the surface actor", () => {
      const ctx = createAnvilRuntimeFixture({
        settings: { "focus-border-toggle": true, "split-border-toggle": false },
      });
      const window = trackTestWindow(ctx);
      const actor = window.get_compositor_private();
      const previousSurface = windowSurface(actor);

      previousSurface.emit("destroy");
      actor._children = [actor.cornerShadow, new Clutter.Actor()];

      expect(() => ctx.anvilRuntime._borders.reconcileWindow(window)).not.toThrow();
      expect(mask(actor)).toBeTruthy();
    });
  });

  describe("settings toggles", () => {
    it("fully reconciles a window that is already focused at admission", () => {
      const ctx = createAnvilRuntimeFixture({
        settings: { "focus-border-toggle": true, "split-border-toggle": false },
      });
      const window = createMockWindow({ workspace: ctx.workspaces[0] });
      const actor = window.get_compositor_private();
      ctx.windowGroup.add_child(actor);
      ctx.display.get_focus_window.mockReturnValue(window);

      ctx.anvilRuntime._borders.registerWindow(window, actor);

      expect(mask(actor)).toBeTruthy();
      expect(actor.border?.visible).toBe(true);
    });

    it("registers actor lifecycle while borders are disabled", () => {
      const ctx = createAnvilRuntimeFixture({
        settings: {
          "focus-border-toggle": false,
          "split-border-toggle": false,
        },
      });
      const window = createMockWindow({ workspace: ctx.workspaces[0] });
      const actor = window.get_compositor_private();

      ctx.anvilRuntime._borders.registerWindow(window, actor);
      ctx.settings.set_boolean("focus-border-toggle", true);
      ctx.display.get_focus_window.mockReturnValue(window);
      ctx.anvilRuntime._borders.setActiveWindow(window);
      ctx.anvilRuntime._borders.reconcileAll();
      const border = actor.border;

      expect(actor.border).not.toBeNull();
      expect(mask(actor)).toBeTruthy();

      window.maximize();
      ctx.anvilRuntime._borders.reconcileWindow(window);
      expect(border.visible).toBe(false);

      window.unmaximize();
      ctx.anvilRuntime._borders.reconcileWindow(window);
      expect(actor.border.visible).toBe(true);
    });

    it("should destroy border actors when toggled off at runtime", () => {
      const ctx = createAnvilRuntimeFixture({
        settings: {
          "focus-border-toggle": true,
          "split-border-toggle": false,
        },
      });

      const window = trackTestWindow(ctx);
      const actor = window.get_compositor_private();
      ctx.anvilRuntime._borders.setActiveWindow(window);
      expect(actor.border).not.toBeNull();

      ctx.settings.set_boolean("focus-border-toggle", false);
      expect(ctx.anvilRuntime._borders.bordersEnabled()).toBe(false);
      ctx.anvilRuntime._borders.destroy();

      expect(actor.border).toBeUndefined();
      expect(ctx.windowGroup._children).not.toContain(actor.border);
      expect(mask(actor)).toBeNull();
    });

    it("should remove masks from maximized and fullscreen windows", () => {
      const ctx = createAnvilRuntimeFixture({
        settings: {
          "focus-border-toggle": true,
          "split-border-toggle": false,
          "focus-border-hidden-on-single": false,
        },
      });
      ctx.settings.set_uint("window-gap-size", 5);
      ctx.settings.set_uint("window-gap-size-increment", 1);
      const window = trackTestWindow(ctx);
      const actor = window.get_compositor_private();
      window.appears_focused_value = true;
      ctx.display.get_focus_window.mockReturnValue(window);
      ctx.anvilRuntime._borders.setActiveWindow(window);
      const border = actor.border;

      window.maximize();
      ctx.anvilRuntime._borders.reconcileAll();
      expect(mask(actor)).toBeNull();
      expect(border.visible).toBe(false);

      window.unmaximize();
      ctx.anvilRuntime._borders.reconcileAll();
      expect(mask(actor)).toBeTruthy();
      expect(actor.border.visible).toBe(true);

      window.make_fullscreen();
      ctx.anvilRuntime._borders.reconcileAll();
      expect(mask(actor)).toBeNull();
      expect(border.visible).toBe(false);
    });

    it("does not enter full window reconciliation during focus changes", () => {
      const ctx = createAnvilRuntimeFixture({
        settings: {
          "focus-border-toggle": true,
          "split-border-toggle": false,
        },
      });
      const first = trackTestWindow(ctx);
      const second = trackTestWindow(ctx);
      const third = trackTestWindow(ctx);
      const reconcile = vi.spyOn(ctx.anvilRuntime._borders, "reconcileWindow");

      ctx.anvilRuntime._borders.setActiveWindow(first);
      reconcile.mockClear();
      ctx.anvilRuntime._borders.setActiveWindow(second);

      expect(reconcile).not.toHaveBeenCalled();
      expect(first.get_compositor_private().border).toBeUndefined();
      expect(second.get_compositor_private().border?.visible).toBe(true);
      expect(third.get_compositor_private().border).toBeFalsy();
    });

    it("moves one focus outline between windows without leaving compatibility ownership behind", () => {
      const ctx = createAnvilRuntimeFixture({
        settings: { "focus-border-toggle": true, "split-border-toggle": false },
      });
      const first = trackTestWindow(ctx);
      const second = trackTestWindow(ctx);
      const third = trackTestWindow(ctx);
      const firstActor = first.get_compositor_private();
      const secondActor = second.get_compositor_private();

      ctx.anvilRuntime._borders.setActiveWindow(first);
      const outline = firstActor.border;
      ctx.anvilRuntime._borders.setActiveWindow(second);

      expect(firstActor.border).toBeUndefined();
      expect(secondActor.border).toBe(outline);
      expect(third.get_compositor_private().border).toBeFalsy();
      expect(ctx.windowGroup._children.filter((actor: any) => actor === outline)).toHaveLength(1);
    });

    it("reconciles active hints without entering full window reconciliation", () => {
      const ctx = createAnvilRuntimeFixture({
        settings: { "focus-border-toggle": true, "split-border-toggle": false },
      });
      const first = trackTestWindow(ctx);
      const second = trackTestWindow(ctx);
      ctx.anvilRuntime._borders.setActiveWindow(first);
      ctx.anvilRuntime._borders.reconcileActiveWindow();
      ctx.anvilRuntime._borders.setActiveWindow(second);
      const reconcile = vi.spyOn(ctx.anvilRuntime._borders, "reconcileWindow");

      ctx.anvilRuntime._borders.reconcileActiveWindow();

      expect(reconcile).not.toHaveBeenCalled();
      expect(second.get_compositor_private().border?.visible).toBe(true);
    });

    it("does not restack an already ordered decoration chain", () => {
      const ctx = createAnvilRuntimeFixture({
        settings: { "focus-border-toggle": true, "split-border-toggle": true },
      });
      const window = createMockWindow({ workspace: ctx.workspaces[0] });
      ctx.windowGroup.add_child(window.get_compositor_private());
      trackTestWindow(ctx, window);
      ctx.anvilRuntime._borders.setActiveWindow(window);
      ctx.anvilRuntime._borders.reconcileActiveWindow();
      ctx.windowGroup.set_child_below_sibling.mockClear();

      ctx.anvilRuntime._borders.reconcileWindow(window);

      expect(ctx.windowGroup.set_child_below_sibling).not.toHaveBeenCalled();
    });

    it("treats repeated focus as a no-op and hides the singleton on null focus", () => {
      const ctx = createAnvilRuntimeFixture({
        settings: { "focus-border-toggle": true, "split-border-toggle": false },
      });
      const window = trackTestWindow(ctx);
      const reconcile = vi.spyOn(ctx.anvilRuntime._borders, "reconcileWindow");

      ctx.anvilRuntime._borders.setActiveWindow(window);
      reconcile.mockClear();
      ctx.anvilRuntime._borders.setActiveWindow(window);
      expect(reconcile).not.toHaveBeenCalled();

      ctx.anvilRuntime._borders.setActiveWindow(null);
      expect(reconcile).not.toHaveBeenCalled();
    });

    it("ignores an untracked next window and survives destroying the cached focus", () => {
      const ctx = createAnvilRuntimeFixture({
        settings: { "focus-border-toggle": true, "split-border-toggle": false },
      });
      const tracked = trackTestWindow(ctx);
      const next = trackTestWindow(ctx);
      const untracked = createMockWindow({ workspace: ctx.workspaces[0] });
      const reconcile = vi.spyOn(ctx.anvilRuntime._borders, "reconcileWindow");

      ctx.anvilRuntime._borders.setActiveWindow(tracked);
      reconcile.mockClear();
      ctx.anvilRuntime._borders.setActiveWindow(untracked);
      expect(reconcile).not.toHaveBeenCalled();

      ctx.anvilRuntime._borders.setActiveWindow(next);
      ctx.anvilRuntime._borders.unregisterWindow(next);
      reconcile.mockClear();
      expect(() => ctx.anvilRuntime._borders.setActiveWindow(tracked)).not.toThrow();
      expect(reconcile).not.toHaveBeenCalled();
      expect(tracked.get_compositor_private().border?.visible).toBe(true);
    });

    it("hides the singleton and removes/restores the mask across minimize transitions", () => {
      const ctx = createAnvilRuntimeFixture({
        settings: {
          "focus-border-toggle": true,
          "split-border-toggle": false,
          "focus-border-hidden-on-single": false,
        },
      });
      const window = trackTestWindow(ctx);
      const actor = window.get_compositor_private();
      window.appears_focused_value = true;
      ctx.display.get_focus_window.mockReturnValue(window);
      ctx.anvilRuntime._borders.setActiveWindow(window);
      ctx.anvilRuntime._borders.reconcileAll();
      const border = actor.border;

      expect(actor.border.visible).toBe(true);
      expect(mask(actor)).toBeTruthy();
      expect(actor.cornerShadow.visible).toBe(true);

      window.minimized = true;
      ctx.anvilRuntime._borders.reconcileWindow(window);
      expect(border.visible).toBe(false);
      expect(mask(actor)).toBeNull();
      expect(actor.cornerShadow.visible).toBe(false);

      window.minimized = false;
      ctx.anvilRuntime._borders.reconcileWindow(window);
      expect(actor.border.visible).toBe(true);
      expect(mask(actor)).toBeTruthy();
      expect(actor.cornerShadow.visible).toBe(true);
    });

    it("should keep the border and mask enabled for a normal zero-gap window", () => {
      const ctx = createAnvilRuntimeFixture({
        settings: {
          "focus-border-toggle": true,
          "split-border-toggle": false,
          "tiling-mode-enabled": true,
          "focus-border-hidden-on-single": false,
        },
      });
      ctx.settings.set_uint("window-gap-size", 0);
      ctx.settings.set_uint("window-gap-size-increment", 0);
      const window = trackTestWindow(ctx);
      const actor = window.get_compositor_private();
      window.appears_focused_value = true;
      ctx.display.get_focus_window.mockReturnValue(window);

      ctx.anvilRuntime._borders.reconcileAll();

      expect(actor.border.visible).toBe(true);
      expect(mask(actor)).toBeTruthy();
    });

    it("should remove the mask when a tracked window is destroyed", () => {
      const ctx = createAnvilRuntimeFixture({
        settings: {
          "focus-border-toggle": true,
          "split-border-toggle": false,
        },
      });
      const window = trackTestWindow(ctx);
      const actor = window.get_compositor_private();
      expect(mask(actor)).toBeTruthy();

      ctx.anvilRuntime._tracker.windowDestroy(actor);

      expect(mask(actor)).toBeNull();
      expect(actor.cornerShadow).toBeUndefined();
    });

    it("should preserve borders and log once when mask setup fails", () => {
      const ctx = createAnvilRuntimeFixture({
        settings: {
          "focus-border-toggle": true,
          "split-border-toggle": false,
        },
      });
      const warn = vi.spyOn(Logger, "warn");
      const failingWindows = [
        createMockWindow({ workspace: ctx.workspaces[0] }),
        createMockWindow({ workspace: ctx.workspaces[0] }),
      ];
      for (const window of failingWindows) {
        const actor = window.get_compositor_private();
        vi.spyOn(actor.get_first_child(), "add_effect_with_name").mockImplementation(() => {
          throw new Error("shader unavailable");
        });
        trackTestWindow(ctx, window);
        expect(mask(actor)).toBeNull();
      }

      expect(warn).toHaveBeenCalledTimes(1);
    });
  });

  describe("reconcileAll split border", () => {
    it("should show splitBorder for V-split when split-border is enabled and window is not maximized", () => {
      const ctx = createAnvilRuntimeFixture({
        settings: {
          "focus-border-toggle": true,
          "split-border-toggle": true,
          "tiling-mode-enabled": true,
        },
      });

      ctx.settings.set_uint("window-gap-size", 5);
      ctx.settings.set_uint("window-gap-size-increment", 1);

      const metaWindow = createMockWindow({
        wm_class: "TestApp",
        title: "Test Window",
        appears_focused_value: true,
      });
      const { monitor } = getWorkspaceAndMonitor(ctx);
      const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
      node.parentNode.layout = LAYOUT_TYPES.VSPLIT;

      ctx.display.get_focus_window.mockReturnValue(metaWindow);

      ctx.anvilRuntime._borders.registerWindow(metaWindow, metaWindow.get_compositor_private());
      ctx.anvilRuntime._borders.reconcileAll();

      const actor = metaWindow.get_compositor_private();
      expect(actor.splitBorder).toBeTruthy();
      expect(actor.splitBorder.visible).toBe(true);
      expect(actor.splitBorder.style_class).toContain("window-split-vertical");
    });
  });
});
