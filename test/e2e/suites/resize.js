/**
 * Resize tests — keyboard resize + white-box percent checks.
 *
 * These tests use Anvil's internal `WindowResizeRight`/`WindowResizeLeft`
 * commands to simulate resize without requiring mouse injection.
 */

import GLib from "gi://GLib";

import { describe, it, assert, beforeEach } from "../lib/framework.js";
import {
  launchApp,
  getWindowGeometries,
  getNodePercents,
  sendAnvilCommand,
  closeAllWindows,
  formatWindowState,
} from "../lib/commands.js";

const INITIAL_SETTLE = 800;
const COMMAND_DELAY = 600;

describe("Resize", function () {
  beforeEach(async function () {
    await closeAllWindows();
    await new Promise(function (resolve) {
      GLib.timeout_add(GLib.PRIORITY_DEFAULT, INITIAL_SETTLE, function () {
        resolve();
        return GLib.SOURCE_REMOVE;
      });
    });
  });

  it("keyboard resize right changes percent", async function () {
    await launchApp("org.gnome.Nautilus.desktop");
    await launchApp("org.gnome.Nautilus.desktop");

    await new Promise(function (resolve) {
      GLib.timeout_add(GLib.PRIORITY_DEFAULT, INITIAL_SETTLE, function () {
        resolve();
        return GLib.SOURCE_REMOVE;
      });
    });

    const before = getNodePercents();
    log(
      "[E2E] Percents before resize: " +
        JSON.stringify(
          before.map(function (n) {
            return { title: n.title, percent: n.percent };
          })
        )
    );

    assert(before.length >= 2, "Need >= 2 tiled windows");
    const beforePct0 = before[0].percent;
    const beforePct1 = before[1].percent;
    assert(beforePct0 === beforePct1, "Expected equal percents initially");

    // Resize the focused window to the right by 150px
    sendAnvilCommand({ name: "WindowResizeRight", amount: 150 });

    await new Promise(function (resolve) {
      GLib.timeout_add(GLib.PRIORITY_DEFAULT, COMMAND_DELAY, function () {
        resolve();
        return GLib.SOURCE_REMOVE;
      });
    });

    const after = getNodePercents();
    log(
      "[E2E] Percents after resize: " +
        JSON.stringify(
          after.map(function (n) {
            return { title: n.title, percent: n.percent };
          })
        )
    );

    assert(after.length >= 2, "Need >= 2 windows after resize");
    const afterPct0 = after[0].percent;
    const afterPct1 = after[1].percent;

    // After resize, percents should differ from the initial 50/50
    const changed = afterPct0 !== beforePct0 || afterPct1 !== beforePct1;
    assert(changed, "Percents did not change after resize — snap-back bug present");
  });

  it("keyboard resize right produces visible geometry change", async function () {
    await launchApp("org.gnome.Nautilus.desktop");
    await launchApp("org.gnome.Nautilus.desktop");

    await new Promise(function (resolve) {
      GLib.timeout_add(GLib.PRIORITY_DEFAULT, INITIAL_SETTLE, function () {
        resolve();
        return GLib.SOURCE_REMOVE;
      });
    });

    const before = getWindowGeometries();
    log("[E2E] Geometries before resize:\n" + formatWindowState(before));
    assert(before.length >= 2, "Need >= 2 windows");

    sendAnvilCommand({ name: "WindowResizeRight", amount: 150 });

    await new Promise(function (resolve) {
      GLib.timeout_add(GLib.PRIORITY_DEFAULT, COMMAND_DELAY, function () {
        resolve();
        return GLib.SOURCE_REMOVE;
      });
    });

    const after = getWindowGeometries();
    log("[E2E] Geometries after resize:\n" + formatWindowState(after));
    assert(after.length >= 2, "Need >= 2 windows after resize");

    // The focused window should have grown wider, or the other should have shrunk
    const a0 = before[0];
    const a1 = after[0];
    const b0 = before.length > 1 ? before[1] : null;
    const b1 = after.length > 1 ? after[1] : null;

    let geometryChanged = false;
    if (a0 && a1 && a0.width !== a1.width) geometryChanged = true;
    if (b0 && b1 && b0.width !== b1.width) geometryChanged = true;

    assert(
      geometryChanged,
      "Window geometries unchanged after resize — snap-back bug present\n" +
        "Before: " +
        JSON.stringify(
          before.map(function (w) {
            return w.width;
          })
        ) +
        "\n" +
        "After: " +
        JSON.stringify(
          after.map(function (w) {
            return w.width;
          })
        )
    );
  });
});
