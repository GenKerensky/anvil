/**
 * Anvil E2E Test Runner — Jasmine automation-script for gnome-shell --headless.
 *
 * Loaded by gnome-shell --wayland --headless --automation-script.
 * GNOME calls `export async function run()` on the automation script.
 *
 * Results are written to /tmp/anvil-e2e-results.json for test/e2e/run.py to poll.
 */

import GLib from "gi://GLib";
import Gio from "gi://Gio";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

import { closeAllWindows, takeScreenshot } from "./lib/commands.js";
import {
  sleep,
  clearMonitorConstraints,
  clearResizedWindows,
  clearFloatOverridesForClass,
} from "../lib/shared-commands.js";

const UUID = "anvil@GenKerensky.github.com";
const SCHEMA_ID = "org.gnome.shell.extensions.anvil";
const RESULTS_PATH = "/tmp/anvil-e2e-results.json";
const OUTPUT_DIR = GLib.getenv("ANVIL_E2E_OUTPUT_DIR") || "/tmp/anvil-e2e-output";
const JASMINE_DIR = "/usr/share/jasmine-gjs";

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

/**
 * Wait until the extension is ACTIVE and test-mode state (runtime) is ready.
 * @returns {Promise<void>}
 */
function ensureExtensionReady() {
  return new Promise(function (resolve) {
    function check() {
      const ext = Main.extensionManager.lookup(UUID);
      const g = /** @type {any} */ (global);
      const hasTestState = g.__anvil_test_state != null && g.__anvil_runtime != null;

      if (ext && ext.state === 1 && hasTestState) {
        log("[E2E] Extension ACTIVE with __anvil_runtime");
        resolve(undefined);
        return GLib.SOURCE_REMOVE;
      }

      if (ext && ext.state === 1 && !hasTestState) {
        log("[E2E] Extension ACTIVE but __anvil_test_state not ready — re-enabling");
        try {
          Main.extensionManager.disableExtension(UUID);
        } catch (e) {
          log("[E2E] disableExtension failed: " + (e instanceof Error ? e.message : String(e)));
        }
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, function () {
          try {
            Main.extensionManager.enableExtension(UUID);
          } catch (e) {
            log("[E2E] enableExtension failed: " + (e instanceof Error ? e.message : String(e)));
          }
          return GLib.SOURCE_REMOVE;
        });
      } else if (!ext) {
        try {
          /** @type {any} */ (Main.extensionManager).loadNewByUUID(UUID);
        } catch (e) {
          log("[E2E] loadNewByUUID failed: " + (e instanceof Error ? e.message : String(e)));
        }
      } else if (ext && ext.state !== 1) {
        try {
          Main.extensionManager.enableExtension(UUID);
        } catch (e) {
          log("[E2E] enableExtension failed: " + (e instanceof Error ? e.message : String(e)));
        }
      }
      return GLib.SOURCE_CONTINUE;
    }
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, check);
  });
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
  // Stack of active suites so nested `describe` blocks (and filtered/spec-less
  // suites) are attributed correctly. Specs attach to the top of the stack.
  /** @type {{ name: string, tests: any[], passed: number, failed: number }[]} */
  const suiteStack = [];

  return {
    /** @param {jasmine.SuiteResult} result */
    suiteStarted(result) {
      suiteStack.push({ name: result.fullName, tests: [], passed: 0, failed: 0 });
    },

    /** @param {jasmine.SuiteResult} result */
    suiteDone(result) {
      // Pop the matching suite (top-down) and, if it ran specs, record it.
      for (let i = suiteStack.length - 1; i >= 0; i--) {
        if (suiteStack[i].name === result.fullName) {
          const done = suiteStack.splice(i, 1)[0];
          if (done.tests.length > 0) results.results.push(done);
          break;
        }
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

      const owner = suiteStack[suiteStack.length - 1];
      if (owner) {
        owner.tests.push(test);
        if (test.passed) owner.passed++;
        else if (!test.pending) owner.failed++;
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
  const pkgdatadir = JASMINE_DIR;

  const oldSearchPath = imports.searchPath.slice();
  imports.searchPath.unshift(GLib.path_get_dirname(pkgdatadir));
  /** @type {any} */ (globalThis).jasmineImporter = /** @type {any} */ (imports)["jasmine-gjs"];
  imports.searchPath = oldSearchPath;

  const { Jasmine } = await import(`file://${pkgdatadir}/jasmineBoot.js`);
  const runner = new Jasmine();

  runner.installAPI(globalThis);
  runner.env.configure({ random: false });
  /** @type {any} */ (globalThis).jasmine.DEFAULT_TIMEOUT_INTERVAL = 15000;

  return runner;
}

// ---------------------------------------------------------------------------
// Entry point called by gnome-shell --headless / --devkit
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

  await ensureExtensionReady();

  // Global state reset: the headless session shares the user dconf db, so a
  // prior run (or a `--tag constraints` diagnostic run) can leave
  // monitor-constraints / tiling-mode / float overrides behind. Normalize the
  // mutable GSettings-backed extension state here so the suite starts from a
  // known baseline regardless of prior runs.
  try {
    // Use the EXTENSION's settings instance (global.__anvil_settings), not a
    // fresh Gio.Settings — in the isolated D-Bus session these may resolve to
    // different dconf backends, so only the extension's instance reliably
    // matches what it reads at render time.
    const settings =
      /** @type {Gio.Settings | null} */ (/** @type {any} */ (global).__anvil_settings) ||
      new Gio.Settings({ schema_id: SCHEMA_ID });
    settings.set_boolean("tiling-mode-enabled", true);
    // Clear left-behind skip-tile + constraints so windows tile on every suite.
    // These GSettings persist in the shared dconf across runs; a prior
    // workspace-skip-tile or constraint-suite run would otherwise leave the
    // active workspace skip-tiled (windows float at preferred size) or clamped.
    settings.set_string("workspace-skip-tile", "");
    const empty = new GLib.Variant("a(suubb)", []);
    settings.set_value("monitor-constraints", empty);
    clearMonitorConstraints();
    clearResizedWindows();
    // Remove persisted Nautilus float overrides from prior floating-suite runs so
    // the tiling suite (run first) does not see Nautilus as floating-exempt.
    clearFloatOverridesForClass("org.gnome.Nautilus");
    log("[E2E] Global state reset (tiling + skip-tile + constraints + float-override cleared)");
  } catch (e) {
    log(
      "[E2E] Warning: global state reset failed: " + (e instanceof Error ? e.message : String(e))
    );
  }

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

  // NOTE: tag filtering is done ONLY at the import level (below). The legacy
  // `runner.env.specFilter` configure is intentionally NOT set: in this
  // jasmine-gjs build it cannot be relied on, and a substring specFilter would
  // wrongly exclude specs within a selected suite whose name does not contain
  // the tag (e.g. `--tag resize` loading constraints.js then excluding every
  // constraints spec — they showed as status "excluded"). Import-level selection
  // guarantees every imported spec runs.

  // extension.js is last: disable/re-enable can leave the WM half-initialized and
  // would poison later suites if run first.
  const allSuites = [
    "./suites/core-smoke.js",
    "./suites/tiling.js",
    "./suites/keyboard.js",
    "./suites/operations.js",
    "./suites/resize.js",
    "./suites/focus.js",
    "./suites/swap.js",
    "./suites/move.js",
    "./suites/floating.js",
    "./suites/layouts.js",
    "./suites/workspace.js",
    "./suites/borders.js",
    "./suites/minimize.js",
    "./suites/monitor-churn.js",
    "./suites/session-mode.js",
    "./suites/constraints.js",
    "./suites/extension.js",
  ];

  // Tag filter at the import level (robust against jasmine-gjs specFilter quirks —
  // the env specFilter configure is not honored in this version, which made
  // `--tag` run all 125 specs). Only importing matching suites guarantees only
  // their describes register. Match by basename substring, e.g. "focus" →
  // focus.js, "extension" → extension.js. Some tags select more than one suite —
  // `resize` must also pull in `constraints.js` (monitor-constraint clamp/exempt
  // behavior) per the smoke-test contract; map those explicitly (R2: the plain
  // basename-substring filter silently dropped constraints.js because
  // "constraints" does not contain "resize").
  /** @type {Record<string, string[]>} */
  const TAG_EXPANSIONS = {
    resize: ["resize.js", "constraints.js"],
  };

  /** @type {string[]} */
  let suites = allSuites;
  if (filterTag) {
    const tag = filterTag.toLowerCase();
    const expanded = TAG_EXPANSIONS[tag];
    if (expanded) {
      suites = allSuites.filter((p) => expanded.includes(p.split("/").pop() ?? ""));
    } else {
      suites = allSuites.filter((p) => (p.split("/").pop() ?? "").toLowerCase().includes(tag));
    }
    // Always keep extension.js last when it is in the filtered set so its
    // disable/re-enable cannot poison other suites.
    suites = suites.filter((p) => p !== "./suites/extension.js");
    if (filterTag.toLowerCase().includes("extension")) suites.push("./suites/extension.js");
    if (suites.length === 0) suites = allSuites;
  }

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

  let results = { totalFailed: 0 };
  try {
    const bytes = GLib.file_get_contents(RESULTS_PATH);
    if (bytes[0]) {
      const json = new TextDecoder().decode(bytes[1]);
      results = JSON.parse(json);
    }
  } catch {
    /* ignore — reporter already wrote the file */
  }

  if (results.totalFailed > 0) {
    const safeTime = new Date().toISOString().replace(/[:.]/g, "-");
    takeScreenshot(OUTPUT_DIR + "/failure-" + safeTime + ".png");
  }

  closeAllWindows();
  log("[E2E] Tests complete, waiting for exit");
}
