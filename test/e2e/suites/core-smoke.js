/**
 * Minimal writer-mode lifecycle smoke test. Kept deliberately small so a
 * pre-map Mutter crash has a fast, isolated E2E reproduction.
 */

import Meta from "gi://Meta";

import { closeAllWindows, launchApp, waitForWindowCount } from "../../lib/shared-commands.js";

afterEach(async function () {
  await closeAllWindows();
});

describe("Core writer lifecycle", function () {
  it("survives admission and mapping of one window", async function () {
    await launchApp("org.gnome.Nautilus.desktop");
    await waitForWindowCount(1, 5000);

    const raw = /** @type {any} */ (global).__anvil_test_state.getTestState();
    const state = JSON.parse(raw);
    if (state.tilingEngineMode === "core") {
      expect(state.portableTiling.windows.length).toBeGreaterThanOrEqual(1);
      expect(state.portableTiling.windows[0].participating).toBe(true);
    } else {
      expect(state.treeExists).toBe(true);
    }
  });

  it("admits a late-mapped Xwayland window into the core surface", async function () {
    await launchApp("org.gnome.Nautilus.desktop");
    await waitForWindowCount(1, 5000);
    await launchApp("xterm.desktop");
    await waitForWindowCount(2, 5000);

    const workspace = global.display.get_workspace_manager().get_active_workspace();
    const x11Window = global.display
      .get_tab_list(Meta.TabList.NORMAL_ALL, workspace)
      .find(function (window) {
        return window.get_client_type() === Meta.WindowClientType.X11;
      });
    expect(x11Window).toBeDefined();

    const raw = /** @type {any} */ (global).__anvil_test_state.getTestState();
    const state = JSON.parse(raw);
    if (state.tilingEngineMode === "core") {
      expect(state.portableTilingShadowFailure).toBeNull();
      expect(state.portableTiling.windows.length).toBe(2);
      expect(
        state.portableTiling.windows.every(function (/** @type {any} */ candidate) {
          return state.portableTiling.surfaces.some(function (/** @type {any} */ surface) {
            return surface.id === candidate.surfaceId;
          });
        })
      ).toBe(true);
    }
  });
});
