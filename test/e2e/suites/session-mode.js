/** Unlock-dialog session-mode lifecycle soak for the headless Shell. */

import * as Main from "resource:///org/gnome/shell/ui/main.js";

import {
  closeAllWindows,
  getAnvilRuntime,
  getExtensionErrors,
  isExtensionActive,
  launchApp,
  sleep,
  waitForWindowCount,
} from "../../lib/shared-commands.js";

/**
 * @param {string} mode
 * @param {number} [timeoutMs=5000]
 */
async function waitForSessionMode(mode, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (Main.sessionMode.currentMode === mode) return;
    await sleep(100);
  }
  throw new Error(
    `Session mode did not become ${mode}; current mode is ${Main.sessionMode.currentMode}`
  );
}

describe("Unlock Dialog Session Mode", function () {
  afterEach(async function () {
    if (Main.sessionMode.currentMode === "unlock-dialog") {
      Main.sessionMode.popMode("unlock-dialog");
      await waitForSessionMode("user");
    }
    await closeAllWindows();
  });

  it("preserves core state while Shell enters and leaves unlock-dialog", async function () {
    await launchApp("org.gnome.Nautilus.desktop");
    await waitForWindowCount(1, 5000);

    const before = JSON.parse(getAnvilRuntime().getStateJson());
    Main.sessionMode.pushMode("unlock-dialog");
    await waitForSessionMode("unlock-dialog");

    expect(isExtensionActive()).toBe(true);
    expect(getExtensionErrors()).toEqual([]);
    expect(/** @type {any} */ (global).__anvil_test_state.indicator).toBeNull();

    Main.sessionMode.popMode("unlock-dialog");
    await waitForSessionMode("user");
    await sleep(500);

    expect(isExtensionActive()).toBe(true);
    expect(getExtensionErrors()).toEqual([]);
    expect(/** @type {any} */ (global).__anvil_test_state.indicator).not.toBeNull();
    const after = JSON.parse(getAnvilRuntime().getStateJson());
    if (after.tilingEngineMode === "core") {
      expect(after.portableTilingShadowFailure).toBeNull();
      expect(after.portableTiling.windows.map((/** @type {any} */ window) => window.id)).toEqual(
        before.portableTiling.windows.map((/** @type {any} */ window) => window.id)
      );
    }
  });
});
