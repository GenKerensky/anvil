/**
 * Entry point for gnome-shell --automation-script.
 *
 * GNOME Shell loads this module and calls run() after startup is complete.
 * Called via:  await import(automationScript.get_uri())
 * Then:        Scripting.runPerfScript(perfModule, outputFile)
 */

import GLib from "gi://GLib";
import Gio from "gi://Gio";
import Shell from "gi://Shell";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

import { runAll, sleep } from "./lib/framework.js";
import { closeAllWindows, takeScreenshot } from "./lib/commands.js";

// Side-effect imports to register test suites
import "./suites/extension.js";
import "./suites/tiling.js";
import "./suites/keyboard.js";
import "./suites/operations.js";
import "./suites/resize.js";

const UUID = "anvil@GenKerensky.github.com";
const RESULTS_PATH = "/tmp/anvil-e2e-results.json";
const OUTPUT_DIR = GLib.getenv("ANVIL_E2E_OUTPUT_DIR") || "/tmp/anvil-e2e-output";

function waitForMain() {
  return new Promise(function (resolve) {
    function check() {
      if (Main.extensionManager) {
        resolve();
        return GLib.SOURCE_REMOVE;
      }
      return GLib.SOURCE_CONTINUE;
    }
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, check);
  });
}

function ensureExtensionEnabled() {
  log("[E2E] Ensuring extension is enabled…");
  let ext = Main.extensionManager.lookup(UUID);
  if (!ext) {
    log("[E2E] Extension not loaded, attempting load…");
    try {
      Main.extensionManager.loadNewByUUID(UUID);
    } catch (e) {
      log("[E2E] loadNewByUUID failed: " + e.message);
    }
    ext = Main.extensionManager.lookup(UUID);
  }
  if (ext && ext.state !== 1) {
    log("[E2E] Enabling extension…");
    try {
      Main.extensionManager.enableExtension(UUID);
    } catch (e) {
      log("[E2E] enableExtension failed: " + e.message);
    }
  }
  ext = Main.extensionManager.lookup(UUID);
  if (ext && ext.state === 1) {
    log("[E2E] Extension is ACTIVE");
    return true;
  }
  log("[E2E] Extension NOT active (state=" + (ext ? ext.state : "null") + ")");
  return false;
}

export async function run() {
  const filterTag = GLib.getenv("ANVIL_E2E_TAG") || "";

  log("[E2E] Starting test run" + (filterTag ? " (tag: " + filterTag + ")" : ""));

  // Wait until Main is available (gnome-shell startup may still be in progress)
  await waitForMain();

  // Ensure overview is closed so windows appear on the desktop
  if (Main.overview && Main.overview.visible) {
    log("[E2E] Closing overview…");
    Main.overview.hide();
    await sleep(500);
  }

  // Enable test-mode so the extension exports itself on global.__anvil_test_state
  try {
    const gsettings = new Gio.Settings({ schema_id: "org.gnome.shell.extensions.anvil" });
    gsettings.set_boolean("test-mode", true);
    log("[E2E] test-mode enabled");
  } catch (e) {
    log("[E2E] Failed to set test-mode: " + e.message);
  }

  ensureExtensionEnabled();

  let results;
  try {
    results = await runAll(filterTag);
  } catch (e) {
    log("[E2E] runAll failed: " + e.message);
    results = {
      results: [],
      totalPassed: 0,
      totalFailed: 1,
      timestamp: new Date().toISOString(),
      fatalError: e.message,
    };
  }

  // Screenshot on failure if any
  if (results.totalFailed > 0) {
    const safeTime = new Date().toISOString().replace(/[:.]/g, "-");
    takeScreenshot(OUTPUT_DIR + "/failure-" + safeTime + ".png");
  }

  // Write results JSON
  const json = JSON.stringify(results, null, 2);
  try {
    GLib.file_set_contents(RESULTS_PATH, json);
    log("[E2E] Results written to " + RESULTS_PATH);
  } catch (e) {
    log("[E2E] Failed to write results: " + e.message);
  }

  // Clean up any leftover windows
  closeAllWindows();

  // Let the compositor settle before terminating
  log("[E2E] Tests complete, waiting for exit");
}
