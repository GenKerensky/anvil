/**
 * Extension Lifecycle specs
 *
 * Replaces: features/extension_lifecycle.feature (@agent)
 *
 * Verifies that the Anvil extension loads correctly, reports no errors, and
 * can be cleanly disabled and re-enabled.
 */

import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { UUID, sleep, getSettings } from "./helpers.js";

// Extension state constants (ExtensionState enum in GJS Shell)
const STATE_ACTIVE = 1;
const STATE_INACTIVE = 2;

describe("Extension Lifecycle", function () {
  it("is active", function () {
    const ext = Main.extensionManager.lookup(UUID);
    expect(ext).not.toBeNull();
    expect(ext).not.toBeUndefined();
    expect(ext.state).toBe(STATE_ACTIVE);
  });

  it("has no errors", function () {
    const ext = Main.extensionManager.lookup(UUID);
    expect(ext).not.toBeNull();
    // stateObj is a custom property added by the extension — may not be on the proxy type
    const error = /** @type {any} */ (ext).stateObj
      ? /** @type {any} */ (ext).stateObj.error
      : null;
    expect(error).toBeFalsy();
  });

  it("test-mode is enabled and __anvil_test_state is available", function () {
    const settings = getSettings();
    expect(settings.get_boolean("test-mode")).toBe(true);
    expect(/** @type {any} */ (global).__anvil_test_state).toBeDefined();
    expect(/** @type {any} */ (global).__anvil_test_state).not.toBeNull();
  });

  it("can be disabled and re-enabled without errors", async function () {
    // Disable
    Main.extensionManager.disableExtension(UUID);

    // Wait for extension to become inactive (poll every 200ms, up to 10s)
    const disableStart = Date.now();
    while (Date.now() - disableStart < 10000) {
      const ext = Main.extensionManager.lookup(UUID);
      if (ext && ext.state === STATE_INACTIVE) break;
      await sleep(200);
    }

    const ext = Main.extensionManager.lookup(UUID);
    expect(ext.state).toBe(STATE_INACTIVE);

    // Re-enable
    Main.extensionManager.enableExtension(UUID);

    // Wait for extension to become active (poll every 200ms, up to 10s)
    const enableStart = Date.now();
    while (Date.now() - enableStart < 10000) {
      const extAfter = Main.extensionManager.lookup(UUID);
      if (extAfter && extAfter.state === STATE_ACTIVE) break;
      await sleep(200);
    }

    const extAfter = Main.extensionManager.lookup(UUID);
    expect(extAfter.state).toBe(STATE_ACTIVE);
    const errorAfter = /** @type {any} */ (extAfter).stateObj
      ? /** @type {any} */ (extAfter).stateObj.error
      : null;
    expect(errorAfter).toBeFalsy();
  });
});
