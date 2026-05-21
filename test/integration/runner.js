/**
 * Anvil Integration Test Runner — Jasmine automation-script for gnome-shell.
 *
 * Loaded by gnome-shell --headless --wayland --automation-script.
 *
 * GNOME 50 calls `export async function run()` on automation scripts in both
 * --headless and --devkit modes.  We guard against double-execution so the
 * module-level bootstrap (for older shells) and the exported run() both
 * work without running tests twice.
 *
 * Startup sequence:
 *   1. Wait for Main.extensionManager to be available
 *   2. Set test-mode=true via Gio.Settings (enables global.__anvil_test_state)
 *   3. Wait for the extension to be ACTIVE with __anvil_test_state.extWm set
 *   4. Bootstrap Jasmine from the system-installed jasmine-gjs package
 *   5. Import all spec files (side-effect: registers describe/it suites)
 *   6. Add a JSON file reporter
 *   7. Execute all specs
 *   8. Write results to /tmp/anvil-jasmine-results.json
 *
 * Results file is polled by run-tests.sh on the host. Writing the file is the
 * completion signal — no D-Bus agent, no ready marker ping required.
 */

import GLib from "gi://GLib";
import Gio from "gi://Gio";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

const UUID = "anvil@GenKerensky.github.com";
const SCHEMA_ID = "org.gnome.shell.extensions.anvil";
const RESULTS_PATH = "/tmp/anvil-jasmine-results.json";
const SPECS_DIR = "/usr/local/share/anvil-tests/specs";
const SPEC_FILTER_PATH = "/tmp/spec-filter";

// ---------------------------------------------------------------------------
// Startup helpers (identical logic to the old agent.js)
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

/** @returns {Promise<void>} */
function ensureExtension() {
  return new Promise(function (resolve) {
    function check() {
      const ext = Main.extensionManager.lookup(UUID);
      const g = /** @type {any} */ (global);
      const hasTestState = g.__anvil_test_state != null && g.__anvil_test_state.extWm != null;

      if (ext && ext.state === 1 && hasTestState) {
        log("[AnvilRunner] Extension ACTIVE with __anvil_test_state.extWm");
        resolve(undefined);
        return GLib.SOURCE_REMOVE;
      }

      if (ext && ext.state === 1 && !hasTestState) {
        log("[AnvilRunner] Extension ACTIVE but __anvil_test_state not ready — re-enabling");
        try {
          Main.extensionManager.disableExtension(UUID);
        } catch (e) {
          log(
            "[AnvilRunner] disableExtension failed: " + (e instanceof Error ? e.message : String(e))
          );
        }
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, function () {
          try {
            Main.extensionManager.enableExtension(UUID);
          } catch (e) {
            log(
              "[AnvilRunner] enableExtension failed: " +
                (e instanceof Error ? e.message : String(e))
            );
          }
          return GLib.SOURCE_REMOVE;
        });
      } else if (ext && ext.state !== 1) {
        try {
          Main.extensionManager.enableExtension(UUID);
        } catch (e) {
          log(
            "[AnvilRunner] enableExtension failed: " + (e instanceof Error ? e.message : String(e))
          );
        }
      }
      return GLib.SOURCE_CONTINUE;
    }
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, check);
  });
}

// ---------------------------------------------------------------------------
// JSON file reporter — collects results and writes them on jasmineDone
// ---------------------------------------------------------------------------

/**
 * @param {string} outputPath
 * @returns {jasmine.CustomReporter}
 */
function makeJsonReporter(outputPath) {
  // Use "results" as the suite array key to match the devkit runner's JSON schema,
  // allowing both runners to share the same print_results() in runner_utils.py.
  /** @type {{ results: any[], timestamp: string | null, fatalError: string | null, totalPassed?: number, totalFailed?: number }} */
  const results = { results: [], timestamp: null, fatalError: null };
  /** @type {{ name: string, tests: any[], passed: number, failed: number } | null} */
  let currentSuite = null;

  return {
    /** @param {jasmine.SuiteResult} result */
    suiteStarted(result) {
      // Only track top-level suites (describe blocks in spec files)
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
        "[AnvilRunner] Results written to " +
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
// Jasmine bootstrap — imports installed jasmine-gjs without using the CLI
// ---------------------------------------------------------------------------

/** @returns {Promise<any>} */
async function bootJasmine() {
  const pkgdatadir = "/usr/share/jasmine-gjs";

  // jasmineBoot.js uses the legacy imports system to load the jasmine core.
  // We must set up the jasmineImporter global before importing jasmineBoot.
  const oldSearchPath = imports.searchPath.slice();
  imports.searchPath.unshift(GLib.path_get_dirname(pkgdatadir));
  /** @type {any} */ (globalThis).jasmineImporter = /** @type {any} */ (imports)["jasmine-gjs"];
  imports.searchPath = oldSearchPath;

  const { Jasmine } = await import(`file://${pkgdatadir}/jasmineBoot.js`);
  const runner = new Jasmine();

  // Install describe/it/expect/beforeAll/afterAll/beforeEach/afterEach/jasmine
  // as globals, matching exactly what the jasmine CLI does.
  runner.installAPI(globalThis);

  // Disable random ordering for deterministic CI output
  runner.env.configure({ random: false });

  return runner;
}

// ---------------------------------------------------------------------------
// Test execution
// ---------------------------------------------------------------------------

async function runTests() {
  log("[AnvilRunner] Starting…");

  try {
    await waitForMain();
    log("[AnvilRunner] Main.extensionManager ready");

    try {
      const settings = new Gio.Settings({ schema_id: SCHEMA_ID });
      settings.set_boolean("test-mode", true);
      log("[AnvilRunner] test-mode enabled");
    } catch (e) {
      log(
        "[AnvilRunner] Warning: could not set test-mode: " +
          (e instanceof Error ? e.message : String(e))
      );
    }

    await ensureExtension();
    log("[AnvilRunner] Extension active — booting Jasmine");

    let runner;
    try {
      runner = await bootJasmine();
    } catch (e) {
      log(
        "[AnvilRunner] Fatal: could not boot Jasmine: " +
          (e instanceof Error ? e.message : String(e))
      );
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

    // Register the JSON reporter before importing specs so it captures
    // everything from the first describe block onward.
    runner.env.addReporter(makeJsonReporter(RESULTS_PATH));

    // Import spec files — side-effect imports register describe/it suites.
    // Order matches the logical test progression.
    const specFiles = [
      "extension-lifecycle.js",
      "tiling.js",
      "keyboard.js",
      "focus.js",
      "swap.js",
      "move.js",
      "operations.js",
      "resize.js",
      "constraints.js",
      "layouts.js",
      "floating.js",
      "workspace.js",
      "borders.js",
      "minimize.js",
      "settings.js",
      "preferences.js",
    ];

    // Read optional spec filter written by run.py --spec.
    // When present, only load matching spec files (exact base-name match).
    let specsToLoad = specFiles;
    let filterData = null;
    try {
      filterData = GLib.file_get_contents(SPEC_FILTER_PATH)[1];
    } catch (_e) {
      // File doesn't exist — not an error, run all specs.
    }
    if (filterData && filterData.byteLength > 0) {
      const decoder = new TextDecoder();
      const filterText = decoder.decode(filterData);
      /** @type {string[]} */
      const filterNames = filterText
        .split(",")
        .map(function (s) {
          return s.trim().replace(/\.js$/i, "");
        })
        .filter(function (s) {
          return s.length > 0;
        });
      log("[AnvilRunner] Spec filter active: " + JSON.stringify(filterNames));

      // Warn about filter entries that don't match any known spec
      for (let i = 0; i < filterNames.length; i++) {
        if (specFiles.indexOf(filterNames[i] + ".js") === -1) {
          log(
            "[AnvilRunner] Warning: spec-filter entry '" +
              filterNames[i] +
              "' does not match any known spec file"
          );
        }
      }

      // Filter to only matching spec files (exact base-name match)
      specsToLoad = specFiles.filter(function (file) {
        return filterNames.indexOf(file.replace(/\.js$/, "")) !== -1;
      });

      if (specsToLoad.length === 0) {
        log("[AnvilRunner] Warning: spec-filter matched no known specs; loading all");
        specsToLoad = specFiles;
      }
    }

    for (const file of specsToLoad) {
      try {
        await import(`file://${SPECS_DIR}/${file}`);
        log("[AnvilRunner] Loaded spec: " + file);
      } catch (e) {
        log(
          "[AnvilRunner] Warning: failed to load spec " +
            file +
            ": " +
            (e instanceof Error ? e.message : String(e))
        );
        log("[AnvilRunner] Stack: " + (e instanceof Error ? e.stack : String(e)));
      }
    }

    log("[AnvilRunner] Running all specs…");
    try {
      await runner.env.execute();
    } catch (e) {
      log(
        "[AnvilRunner] Fatal error during spec execution: " +
          (e instanceof Error ? e.message : String(e))
      );
      // jasmineDone reporter callback will still fire and write the file.
    }

    log("[AnvilRunner] Done.");
  } catch (err) {
    log("[AnvilRunner] Fatal error: " + (err instanceof Error ? err.message : String(err)));
    const errJson = JSON.stringify({
      results: [],
      totalPassed: 0,
      totalFailed: 1,
      fatalError: String(err instanceof Error ? err.message : err),
      timestamp: new Date().toISOString(),
    });
    GLib.file_set_contents(RESULTS_PATH, errJson);
  }
}

// Single entry point — GNOME 50 calls run() on automation scripts in both
// --headless and --devkit modes.  No module-level side effect: the exported
// run() is the sole path into test bootstrap, avoiding the deadlock / export
// conflict that a dual-entry design causes (scripting.js calls
// scriptModule.run() after the module is already mid-execution).
export async function run() {
  await runTests();
}
