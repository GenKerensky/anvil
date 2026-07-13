/*
 * AnvilRuntime border actor tests
 *
 * Tests for lazy border actor creation, settings toggles, and split-border visibility.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
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

  describe("trackWindow border actors", () => {
    it("should not create a border actor when both border prefs are false", () => {
      const ctx = createAnvilRuntimeFixture({
        settings: {
          "focus-border-toggle": false,
          "split-border-toggle": false,
        },
      });

      const window = trackTestWindow(ctx);
      const actor = window.get_compositor_private();

      expect(actor.border).toBeNull();
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

      expect(actor.border).not.toBeNull();
      expect(actor.cornerShadow).not.toBeNull();
      expect(ctx.windowGroup.contains(actor.border)).toBe(true);
      expect(ctx.windowGroup.contains(actor.cornerShadow)).toBe(true);
      expect(actor.get_effect("anvil-window-corner-mask")).toBeTruthy();
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

      expect(first.get_compositor_private().get_effect("anvil-window-corner-mask")).toBeTruthy();
      expect(second.get_compositor_private().get_effect("anvil-window-corner-mask")).toBeTruthy();
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
  });

  describe("settings toggles", () => {
    it("registers actor lifecycle while borders are disabled", () => {
      const ctx = createAnvilRuntimeFixture({
        settings: {
          "focus-border-toggle": false,
          "split-border-toggle": false,
        },
      });
      const window = createMockWindow({ workspace: ctx.workspaces[0] });
      const actor = window.get_compositor_private();

      ctx.anvilRuntime._borders.ensureBorderActors(actor);
      ctx.settings.set_boolean("focus-border-toggle", true);
      ctx.anvilRuntime._borders.ensureAllBorderActors();

      expect(actor.border).not.toBeNull();
      expect(actor.cornerShadow).not.toBeNull();

      window.maximize();
      ctx.anvilRuntime._borders.ensureBorderActors(actor);
      expect(actor.border.visible).toBe(false);

      window.unmaximize();
      ctx.anvilRuntime._borders.ensureBorderActors(actor);
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
      expect(actor.border).not.toBeNull();

      ctx.settings.set_boolean("focus-border-toggle", false);
      expect(ctx.anvilRuntime._bordersEnabled()).toBe(false);
      ctx.anvilRuntime.destroyAllBorderActors();

      expect(actor.border).toBeUndefined();
      expect(actor.cornerShadow).toBeUndefined();
      expect(ctx.windowGroup._children).not.toContain(actor.border);
      expect(actor.get_effect("anvil-window-corner-mask")).toBeNull();
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

      window.maximize();
      ctx.anvilRuntime._borders.updateBorderLayout();
      expect(actor.get_effect("anvil-window-corner-mask")).toBeNull();
      expect(actor.border.visible).toBe(false);
      expect(actor.cornerShadow.visible).toBe(false);

      window.unmaximize();
      ctx.anvilRuntime._borders.updateBorderLayout();
      expect(actor.get_effect("anvil-window-corner-mask")).toBeTruthy();
      expect(actor.border.visible).toBe(true);
      expect(actor.cornerShadow.visible).toBe(true);

      window.make_fullscreen();
      ctx.anvilRuntime._borders.updateBorderLayout();
      expect(actor.get_effect("anvil-window-corner-mask")).toBeNull();
      expect(actor.border.visible).toBe(false);
      expect(actor.cornerShadow.visible).toBe(false);
    });

    it("keeps rounded shadows visible and reflects window focus", () => {
      const ctx = createAnvilRuntimeFixture({
        settings: {
          "focus-border-toggle": true,
          "split-border-toggle": false,
        },
      });
      const first = trackTestWindow(ctx);
      const second = trackTestWindow(ctx);
      const firstActor = first.get_compositor_private();
      const secondActor = second.get_compositor_private();

      first.appears_focused_value = true;
      second.appears_focused_value = false;
      ctx.display.get_focus_window.mockReturnValue(first);
      ctx.anvilRuntime._borders.updateBorderLayout();

      expect(firstActor.cornerShadow.visible).toBe(true);
      expect(firstActor.cornerShadow.style_class).toBe("window-focused-shadow");
      expect(secondActor.cornerShadow.visible).toBe(true);
      expect(secondActor.cornerShadow.style_class).toBe("window-unfocused-shadow");

      first.appears_focused_value = false;
      second.appears_focused_value = true;
      ctx.display.get_focus_window.mockReturnValue(second);
      ctx.anvilRuntime._borders.updateBorderLayout();

      expect(firstActor.cornerShadow.style_class).toBe("window-unfocused-shadow");
      expect(secondActor.cornerShadow.style_class).toBe("window-focused-shadow");
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

      ctx.anvilRuntime._borders.updateBorderLayout();

      expect(actor.border.visible).toBe(true);
      expect(actor.get_effect("anvil-window-corner-mask")).toBeTruthy();
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
      expect(actor.get_effect("anvil-window-corner-mask")).toBeTruthy();

      ctx.anvilRuntime._tracker.windowDestroy(actor);

      expect(actor.get_effect("anvil-window-corner-mask")).toBeNull();
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
        vi.spyOn(actor, "add_effect_with_name").mockImplementation(() => {
          throw new Error("shader unavailable");
        });
        trackTestWindow(ctx, window);
        expect(actor.border).toBeTruthy();
        expect(actor.get_effect("anvil-window-corner-mask")).toBeNull();
      }

      expect(warn).toHaveBeenCalledTimes(1);
    });
  });

  describe("showWindowBorders split border", () => {
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

      ctx.anvilRuntime._borders.showWindowBorders();

      const actor = metaWindow.get_compositor_private();
      expect(actor.splitBorder).toBeTruthy();
      expect(actor.splitBorder.visible).toBe(true);
      expect(actor.splitBorder.style_class).toContain("window-split-vertical");
    });
  });
});
