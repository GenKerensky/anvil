/*
 * AnvilRuntime border actor tests
 *
 * Tests for lazy border actor creation, settings toggles, and split-border visibility.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { Logger } from "../../../src/lib/shared/logger.js";
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
      expect(ctx.windowGroup.contains(actor.border)).toBe(true);
      expect(actor.get_first_child().get_effect("anvil-window-corner-mask")).toBeTruthy();
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

      expect(
        first.get_compositor_private().get_first_child().get_effect("anvil-window-corner-mask")
      ).toBeTruthy();
      expect(
        second.get_compositor_private().get_first_child().get_effect("anvil-window-corner-mask")
      ).toBeTruthy();
    });
  });

  describe("settings toggles", () => {
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
      expect(ctx.windowGroup._children).not.toContain(actor.border);
      expect(actor.get_first_child().get_effect("anvil-window-corner-mask")).toBeNull();
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
      expect(actor.get_first_child().get_effect("anvil-window-corner-mask")).toBeNull();
      expect(actor.border.visible).toBe(false);

      window.unmaximize();
      ctx.anvilRuntime._borders.updateBorderLayout();
      expect(actor.get_first_child().get_effect("anvil-window-corner-mask")).toBeTruthy();
      expect(actor.border.visible).toBe(true);

      window.make_fullscreen();
      ctx.anvilRuntime._borders.updateBorderLayout();
      expect(actor.get_first_child().get_effect("anvil-window-corner-mask")).toBeNull();
      expect(actor.border.visible).toBe(false);
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
      expect(actor.get_first_child().get_effect("anvil-window-corner-mask")).toBeTruthy();
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
      expect(actor.get_first_child().get_effect("anvil-window-corner-mask")).toBeTruthy();

      ctx.anvilRuntime._tracker.windowDestroy(actor);

      expect(actor.get_first_child().get_effect("anvil-window-corner-mask")).toBeNull();
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
        expect(actor.border).toBeTruthy();
        expect(actor.get_first_child().get_effect("anvil-window-corner-mask")).toBeNull();
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
