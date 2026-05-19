/**
 * Keyboard shortcut tests.
 */

import GLib from "gi://GLib";

import {
  launchApp,
  getWindowGeometries,
  getFocusedWindowTitle,
  sendKeyCombo,
  closeAllWindows,
} from "../../lib/shared-commands.js";

/** @param {number} actual @param {number} expected @param {number} tolerance @param {string} [message] */
function assertApprox(actual, expected, tolerance, message) {
  const diff = Math.abs(actual - expected);
  const max = Math.max(Math.abs(actual), Math.abs(expected), 1);
  const ratio = diff / max;
  if (ratio >= tolerance) {
    throw new Error(
      (message || "Values not approximately equal") +
        ": got " +
        actual +
        ", expected ~" +
        expected +
        " (diff " +
        (ratio * 100).toFixed(1) +
        "%)"
    );
  }
}

/** @param {number} ms @returns {Promise<void>} */
function settle(ms) {
  return new Promise(function (resolve) {
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, function () {
      resolve(undefined);
      return GLib.SOURCE_REMOVE;
    });
  });
}

describe("Keyboard Shortcuts", function () {
  it("Super+H changes split orientation", async function () {
    await launchApp("org.gnome.Nautilus.desktop");
    await launchApp("org.gnome.Nautilus.desktop");

    const before = getWindowGeometries();
    expect(before.length).toBeGreaterThanOrEqual(2);
    const a = before[0];
    const b = before[1];
    assertApprox(a.y, b.y, 4, "Windows not at same y initially");
    expect(a.x).not.toBe(b.x);

    sendKeyCombo("Super+H");
    await settle(800);

    const after = getWindowGeometries();
    expect(after.length).toBeGreaterThanOrEqual(2);
    const a2 = after[0];
    const b2 = after[1];
    assertApprox(a2.x, b2.x, 4, "Windows not at same x after toggle");
    expect(a2.y).not.toBe(b2.y);
  });

  it("Super+J moves focus to next window", async function () {
    await launchApp("org.gnome.Nautilus.desktop");
    await launchApp("org.gnome.Nautilus.desktop");

    const wins = getWindowGeometries();
    expect(wins.length).toBeGreaterThanOrEqual(2);

    sendKeyCombo("Super+J");
    await settle(600);

    const title = getFocusedWindowTitle();
    expect(title).toBe(wins[1].title);
  });

  it("Super+C toggles float on focused window", async function () {
    await launchApp("org.gnome.Nautilus.desktop");
    await launchApp("org.gnome.Nautilus.desktop");

    const before = getWindowGeometries();
    expect(before.length).toBeGreaterThanOrEqual(1);

    sendKeyCombo("Super+C");
    await settle(800);

    const after = getWindowGeometries();
    expect(after.length).toBeGreaterThanOrEqual(1);
    let changed = false;
    for (let i = 0; i < Math.min(before.length, after.length); i++) {
      if (
        before[i].x !== after[i].x ||
        before[i].y !== after[i].y ||
        before[i].width !== after[i].width ||
        before[i].height !== after[i].height
      ) {
        changed = true;
        break;
      }
    }
    expect(changed).toBe(true);
  });
});
