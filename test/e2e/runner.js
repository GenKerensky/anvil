/**
 * Anvil E2E Test Runner — Jasmine automation-script for gnome-shell --devkit.
 *
 * Loaded by gnome-shell --devkit --wayland --automation-script.
 * Called via: Scripting.runPerfScript(module, outputFile)
 *
 * Uses Jasmine (same as the integration test runner) instead of a custom
 * framework. Results are collected and written to JSON so run.py can poll
 * the file for completion.
 */

import GLib from "gi://GLib";
import Gio from "gi://Gio";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

import { closeAllWindows, takeScreenshot } from "./lib/commands.js";
import { sleep } from "../lib/shared-commands.js";

const UUID = "anvil@GenKerensky.github.com";
const SCHEMA_ID = "org.gnome.shell.extensions.anvil";
const RESULTS_PATH = "/tmp/anvil-e2e-results.json";
const OUTPUT_DIR = GLib.getenv("ANVIL_E2E_OUTPUT_DIR") || "/tmp/anvil-e2e-output";

// ---------------------------------------------------------------------------
// Startup helpers
// ---------------------------------------------------------------------------

/** @returns {Promise<void>} */
function waitForMain() {
  return new Promise(function (resolve) {
    function check() {
      if (Main.extensionManager) {
        resolve(undefined);
        return GLib.SOURCE_REMOVE;
      }
      return GLib.SOURCE_CONTINUE;
    }
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, check);
  });
}

/** @returns {Promise<boolean>} */
async function ensureExtensionEnabled() {
  log("[E2E] Ensuring extension is enabled…");
  let ext = Main.extensionManager.lookup(UUID);

  if (!ext) {
    log("[E2E] Extension not loaded, attempting load…");
    try {
      /** @type {any} */ (Main.extensionManager).loadNewByUUID(UUID);
    } catch (e) {
      log("[E2E] loadNewByUUID failed: " + (e instanceof Error ? e.message : String(e)));
    }
    ext = Main.extensionManager.lookup(UUID);
  }

  if (ext && ext.state === 1) {
    log("[E2E] Extension is ACTIVE");
    return true;
  }

  if (ext && ext.state !== 1) {
    try {
      log("[E2E] Enabling extension via D-Bus…");
      Main.extensionManager.enableExtension(UUID);
    } catch (e) {
      log("[E2E] enableExtension failed: " + (e instanceof Error ? e.message : String(e)));
    }

    // Wait a bit and re-check
    await sleep(1000);
    ext = Main.extensionManager.lookup(UUID);
    if (ext && ext.state === 1) {
      log("[E2E] Extension is now ACTIVE");
      return true;
    }
  }

  log("[E2E] Extension NOT active (state=" + (ext ? ext.state : "null") + ")");
  return false;
}

// ---------------------------------------------------------------------------
// JSON file reporter
// ---------------------------------------------------------------------------

/**
 * @param {string} outputPath
 * @returns {jasmine.CustomReporter}
 */
function makeJsonReporter(outputPath) {
  /** @type {{ results: any[], timestamp: string | null, fatalError: string | null, totalPassed?: number, totalFailed?: number }} */
  const results = { results: [], timestamp: null, fatalError: null };
  /** @type {{ name: string, tests: any[], passed: number, failed: number } | null} */
  let currentSuite = null;

  return {
    /** @param {jasmine.SuiteResult} result */
    suiteStarted(result) {
      if (!currentSuite) {
        currentSuite = { name: result.fullName, tests: [], passed: 0, failed: 0 };
      }
    },

    /** @param {jasmine.SuiteResult} result */
    suiteDone(result) {
      if (currentSuite && currentSuite.name === result.fullName) {
        results.results.push(currentSuite);
        currentSuite = null;
      }
    },

    /** @param {jasmine.SpecResult} result */
    specDone(result) {
      const test = {
        name: result.description,
        fullName: result.fullName,
        passed: result.status === "passed",
        pending: result.status === "pending",
        error:
          result.failedExpectations.length > 0
            ? result.failedExpectations
                .map((/** @type {jasmine.FailedExpectation} */ e) => e.message)
                .join("\n")
            : null,
      };

      if (currentSuite) {
        currentSuite.tests.push(test);
        if (test.passed) currentSuite.passed++;
        else if (!test.pending) currentSuite.failed++;
      }
    },

    /** @param {jasmine.RunDetails} result */
    jasmineDone(result) {
      results.timestamp = new Date().toISOString();
      if (result.failedExpectations && result.failedExpectations.length > 0) {
        results.fatalError = result.failedExpectations
          .map((/** @type {jasmine.FailedExpectation} */ e) => e.message)
          .join("\n");
      }

      const totalPassed = results.results.reduce(
        /** @param {number} s @param {{passed: number}} suite */ (s, suite) => s + suite.passed,
        0
      );
      const totalFailed = results.results.reduce(
        /** @param {number} s @param {{failed: number}} suite */ (s, suite) => s + suite.failed,
        0
      );
      results.totalPassed = totalPassed;
      results.totalFailed = totalFailed;

      const json = JSON.stringify(results, null, 2);
      GLib.file_set_contents(outputPath, json);
      log(
        "[E2E] Results written to " +
          outputPath +
          " (" +
          totalPassed +
          " passed, " +
          totalFailed +
          " failed)"
      );
    },
  };
}

// ---------------------------------------------------------------------------
// Jasmine bootstrap
// ---------------------------------------------------------------------------

/** @returns {Promise<any>} */
async function bootJasmine() {
  const pkgdatadir = "/usr/share/jasmine-gjs";

  const oldSearchPath = imports.searchPath.slice();
  imports.searchPath.unshift(GLib.path_get_dirname(pkgdatadir));
  /** @type {any} */ (globalThis).jasmineImporter = /** @type {any} */ (imports)["jasmine-gjs"];
  imports.searchPath = oldSearchPath;

  const { Jasmine } = await import(`file://${pkgdatadir}/jasmineBoot.js`);
  const runner = new Jasmine();

  runner.installAPI(globalThis);
  runner.env.configure({ random: false });

  return runner;
}

// ---------------------------------------------------------------------------
// Entry point called by gnome-shell --devkit
// ---------------------------------------------------------------------------

export async function run() {
  const filterTag = GLib.getenv("ANVIL_E2E_TAG") || "";

  log("[E2E] Starting test run" + (filterTag ? " (tag: " + filterTag + ")" : ""));

  await waitForMain();

  if (Main.overview && Main.overview.visible) {
    log("[E2E] Closing overview…");
    Main.overview.hide();
    await sleep(500);
  }

  try {
    const settings = new Gio.Settings({ schema_id: SCHEMA_ID });
    settings.set_boolean("test-mode", true);
    log("[E2E] test-mode enabled");
  } catch (e) {
    log("[E2E] Warning: could not set test-mode: " + (e instanceof Error ? e.message : String(e)));
  }

  await ensureExtensionEnabled();

  let runner;
  try {
    runner = await bootJasmine();
  } catch (e) {
    log("[E2E] Fatal: could not boot Jasmine: " + (e instanceof Error ? e.message : String(e)));
    const err = JSON.stringify({
      results: [],
      totalPassed: 0,
      totalFailed: 1,
      fatalError: "Jasmine boot failed: " + (e instanceof Error ? e.message : String(e)),
      timestamp: new Date().toISOString(),
    });
    GLib.file_set_contents(RESULTS_PATH, err);
    return;
  }

  runner.env.addReporter(makeJsonReporter(RESULTS_PATH));

  // If a tag filter is provided, use Jasmine's specFilter to skip non-matching suites.
  // This filters individual specs (it blocks), not top-level describes.
  if (filterTag) {
    const tag = filterTag.toLowerCase();
    const originalFilter = runner.env.specFilter;
    runner.env.configure({
      /** @param {jasmine.Spec} spec */
      specFilter: function (spec) {
        if (!originalFilter(spec)) return false;
        // Allow specs whose full description includes the tag
        return spec.getFullName().toLowerCase().includes(tag);
      },
    });
  }

  // Import spec files — side-effect imports register describe/it suites
  const suites = [
    "./suites/extension.js",
    "./suites/tiling.js",
    "./suites/keyboard.js",
    "./suites/operations.js",
    "./suites/resize.js",
  ];

  for (const path of suites) {
    try {
      await import(path);
      log("[E2E] Loaded suite: " + path);
    } catch (e) {
      log(
        "[E2E] Warning: failed to load suite " +
          path +
          ": " +
          (e instanceof Error ? e.message : String(e))
      );
    }
  }

  log("[E2E] Running all specs…");
  try {
    await runner.env.execute();
  } catch (e) {
    log("[E2E] Fatal error during spec execution: " + (e instanceof Error ? e.message : String(e)));
  }

  // Read the results written by the reporter to determine if we need a screenshot
  let results = { totalFailed: 0 };
  try {
    const bytes = GLib.file_get_contents(RESULTS_PATH);
    if (bytes[0]) {
      const json = new TextDecoder().decode(bytes[1]);
      results = JSON.parse(json);
    }
  } catch (e) {
    /* ignore — reporter already wrote the file */
  }

  if (results.totalFailed > 0) {
    const safeTime = new Date().toISOString().replace(/[:.]/g, "-");
    takeScreenshot(OUTPUT_DIR + "/failure-" + safeTime + ".png");
  }

  closeAllWindows();
  log("[E2E] Tests complete, waiting for exit");
}
