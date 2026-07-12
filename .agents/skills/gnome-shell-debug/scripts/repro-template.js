// Copy to test/debug/local/repro.js — executed from SOURCE path; session copy is audit-only.
// Imports use test/debug relative paths (../../lib → test/lib)

import GLib from "gi://GLib";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { sleep, getAnvilRuntime } from "../../lib/shared-commands.js";

const RESULTS = GLib.getenv("ANVIL_DEBUG_RESULTS") || "/tmp/anvil-debug-repro-results.json";

if (GLib.getenv("ANVIL_DEBUG_LOOP") !== "1") {
  throw new Error("repro.js must run inside debug loop orchestrator");
}

function writeResult(obj) {
  const payload = JSON.stringify({
    passed: obj.passed,
    message: obj.message,
    data: obj.data ?? {},
    timestamp: new Date().toISOString(),
  });
  GLib.file_set_contents(RESULTS, payload);
}

async function waitForExtension() {
  for (let i = 0; i < 50; i++) {
    const ext = Main.extensionManager.lookup("anvil@GenKerensky.github.com");
    if (ext?.state === 1 && global.__anvil_runtime) return;
    await sleep(200);
  }
  throw new Error("Extension not ACTIVE or __anvil_runtime missing");
}

async function main() {
  log("[DEBUG_LOOP] repro start");
  await waitForExtension();
  try {
    const wm = getAnvilRuntime();
    void wm;
    // ... repro steps ...
    writeResult({ passed: true, message: "ok" });
  } catch (e) {
    writeResult({ passed: false, message: String(e) });
  }
}

main();
