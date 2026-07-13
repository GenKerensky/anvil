/**
 * Minimal writer-mode lifecycle smoke test. Kept deliberately small so a
 * pre-map Mutter crash has a fast, isolated E2E reproduction.
 */

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
});
