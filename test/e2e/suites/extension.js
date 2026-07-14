/**
 * Extension lifecycle tests.
 */

import * as Main from "resource:///org/gnome/shell/ui/main.js";
import {
  isExtensionActive,
  getExtensionErrors,
  getSettings,
  sleep,
} from "../../lib/shared-commands.js";

const UUID = "anvil@GenKerensky.github.com";
const STATE_ACTIVE = 1;
const STATE_INACTIVE = 2;

describe("Extension Lifecycle", function () {
  it("Extension loads without errors", function () {
    expect(isExtensionActive()).toBe(true);
    const errors = getExtensionErrors();
    expect(errors.length).toBe(0);
  });

  it("is active", function () {
    const ext = Main.extensionManager.lookup(UUID);
    expect(ext).not.toBeNull();
    expect(ext).not.toBeUndefined();
    expect(ext.state).toBe(STATE_ACTIVE);
  });

  it("test-mode is enabled and __anvil_test_state is available", function () {
    const settings = getSettings();
    expect(settings.get_boolean("test-mode")).toBe(true);
    expect(/** @type {any} */ (global).__anvil_test_state).toBeDefined();
    expect(/** @type {any} */ (global).__anvil_test_state).not.toBeNull();
  });

  it("can be disabled and re-enabled without changing unsafe mode", async function () {
    const context = /** @type {any} */ (global).context;
    const originalUnsafeMode = context.unsafe_mode;
    const sentinelUnsafeMode = !originalUnsafeMode;
    context.unsafe_mode = sentinelUnsafeMode;

    try {
      Main.extensionManager.disableExtension(UUID);

      const disableStart = Date.now();
      while (Date.now() - disableStart < 10000) {
        const ext = Main.extensionManager.lookup(UUID);
        if (ext && ext.state === STATE_INACTIVE) break;
        await sleep(200);
      }

      const ext = Main.extensionManager.lookup(UUID);
      expect(ext.state).toBe(STATE_INACTIVE);

      Main.extensionManager.enableExtension(UUID);

      const enableStart = Date.now();
      while (Date.now() - enableStart < 10000) {
        const extAfter = Main.extensionManager.lookup(UUID);
        if (extAfter && extAfter.state === STATE_ACTIVE) break;
        await sleep(200);
      }

      const extAfter = Main.extensionManager.lookup(UUID);
      expect(extAfter.state).toBe(STATE_ACTIVE);
      expect(context.unsafe_mode).toBe(sentinelUnsafeMode);
      const errors = getExtensionErrors();
      expect(errors.length).toBe(0);

      // Re-assert test state after re-enable (test-mode should still be on)
      try {
        getSettings().set_boolean("test-mode", true);
      } catch {
        /* schema may still be available */
      }
      await sleep(500);
    } finally {
      context.unsafe_mode = originalUnsafeMode;
    }
  });
});
