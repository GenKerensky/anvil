// Minimal checked-in repro for the agent debug loop.
// Run: .agents/skills/gnome-shell-debug/scripts/run-debug-loop.sh \
//        --script test/debug/examples/minimal-repro.js --json --iteration 1

import GLib from "gi://GLib";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { sleep, getAnvilRuntime } from "../../lib/shared-commands.js";

const RESULTS = GLib.getenv("ANVIL_DEBUG_RESULTS") || "/tmp/anvil-debug-repro-results.json";

if (GLib.getenv("ANVIL_DEBUG_LOOP") !== "1") {
  throw new Error("minimal-repro.js must run inside debug loop orchestrator");
}

function writeResult(obj) {
  GLib.file_set_contents(
    RESULTS,
    JSON.stringify({
      passed: obj.passed,
      message: obj.message,
      data: obj.data ?? {},
      timestamp: new Date().toISOString(),
    })
  );
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
  log("[DEBUG_LOOP] minimal-repro start");
  await waitForExtension();
  try {
    const wm = getAnvilRuntime();
    const state = JSON.parse(wm.getStateJson());
    if (!state.treeExists) {
      throw new Error("Anvil tree not available");
    }
    writeResult({
      passed: true,
      message: "Extension ACTIVE and tree available",
      data: { uuid: "anvil@GenKerensky.github.com" },
    });
  } catch (e) {
    writeResult({ passed: false, message: String(e) });
  }
}

main();
