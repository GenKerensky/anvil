/*
 * WindowManager border actor tests
 *
 * Tests for lazy border actor creation, settings toggles, and split-border visibility.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { LAYOUT_TYPES, NODE_TYPES } from "../../../src/lib/extension/tree.js";
import {
  createMockWindow,
  createWindowManagerFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";

describe("WindowManager - Borders", () => {
  const trackTestWindow = (ctx: any) => {
    const window = createMockWindow({
      wm_class: "TestApp",
      title: "Test Window",
      workspace: ctx.workspaces[0],
    });
    vi.spyOn(ctx.windowManager, "postProcessWindow").mockImplementation(() => {});
    vi.spyOn(ctx.windowManager, "queueEvent").mockImplementation(() => {});
    ctx.windowManager.trackWindow(ctx.display, window);
    return window;
  };

  describe("trackWindow border actors", () => {
    it("should not create a border actor when both border prefs are false", () => {
      const ctx = createWindowManagerFixture({
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
      const ctx = createWindowManagerFixture({
        settings: {
          "focus-border-toggle": true,
          "split-border-toggle": false,
        },
      });

      const window = trackTestWindow(ctx);
      const actor = window.get_compositor_private();

      expect(actor.border).not.toBeNull();
      expect(ctx.windowGroup.contains(actor.border)).toBe(true);
    });
  });

  describe("settings toggles", () => {
    it("should destroy border actors when toggled off at runtime", () => {
      const ctx = createWindowManagerFixture({
        settings: {
          "focus-border-toggle": true,
          "split-border-toggle": false,
        },
      });

      const window = trackTestWindow(ctx);
      const actor = window.get_compositor_private();
      expect(actor.border).not.toBeNull();

      ctx.settings.set_boolean("focus-border-toggle", false);
      expect(ctx.windowManager._bordersEnabled()).toBe(false);
      ctx.windowManager.destroyAllBorderActors();

      expect(actor.border).toBeUndefined();
      expect(ctx.windowGroup._children).not.toContain(actor.border);
    });
  });

  describe("showWindowBorders split border", () => {
    it("should show splitBorder for V-split when split-border is enabled and window is not maximized", () => {
      const ctx = createWindowManagerFixture({
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

      ctx.windowManager.showWindowBorders();

      const actor = metaWindow.get_compositor_private();
      expect(actor.splitBorder).toBeTruthy();
      expect(actor.splitBorder.visible).toBe(true);
      expect(actor.splitBorder.style_class).toContain("window-split-vertical");
    });
  });
});
