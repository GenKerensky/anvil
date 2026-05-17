/**
 * Keyboard shortcut tests.
 */

import GLib from "gi://GLib";

import { describe, it, assert, assertApprox } from "../lib/framework.js";
import {
  launchApp,
  getWindowGeometries,
  getFocusedWindowTitle,
  sendKeyCombo,
  closeAllWindows,
} from "../lib/commands.js";

describe("Keyboard Shortcuts", function () {
  it("Super+H changes split orientation", async function () {
    await launchApp("org.gnome.Nautilus.desktop");
    await launchApp("org.gnome.Nautilus.desktop");

    const before = getWindowGeometries();
    assert(before.length >= 2, "Need >= 2 windows");
    const a = before[0];
    const b = before[1];
    assertApprox(a.y, b.y, 4, "Windows not at same y initially");
    assert(a.x !== b.x, "Windows at same x — not side by side");

    sendKeyCombo("Super+H");
    await new Promise(function (resolve) {
      GLib.timeout_add(GLib.PRIORITY_DEFAULT, 800, function () {
        resolve();
        return GLib.SOURCE_REMOVE;
      });
    });

    const after = getWindowGeometries();
    assert(after.length >= 2, "Need >= 2 windows after toggle");
    const a2 = after[0];
    const b2 = after[1];
    assertApprox(a2.x, b2.x, 4, "Windows not at same x after toggle");
    assert(a2.y !== b2.y, "Windows at same y — not stacked");
  });

  it("Super+J moves focus to next window", async function () {
    await launchApp("org.gnome.Nautilus.desktop");
    await launchApp("org.gnome.Nautilus.desktop");

    const wins = getWindowGeometries();
    assert(wins.length >= 2, "Need >= 2 windows");

    sendKeyCombo("Super+J");
    await new Promise(function (resolve) {
      GLib.timeout_add(GLib.PRIORITY_DEFAULT, 600, function () {
        resolve();
        return GLib.SOURCE_REMOVE;
      });
    });

    const title = getFocusedWindowTitle();
    assert(
      title === wins[1].title,
      "Expected focus on '" + wins[1].title + "', got '" + title + "'"
    );
  });

  it("Super+C toggles float on focused window", async function () {
    await launchApp("org.gnome.Nautilus.desktop");
    await launchApp("org.gnome.Nautilus.desktop");

    const before = getWindowGeometries();
    assert(before.length >= 1, "Need >= 1 window");

    sendKeyCombo("Super+C");
    await new Promise(function (resolve) {
      GLib.timeout_add(GLib.PRIORITY_DEFAULT, 800, function () {
        resolve();
        return GLib.SOURCE_REMOVE;
      });
    });

    const after = getWindowGeometries();
    assert(after.length >= 1, "Need >= 1 window after float");
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
    assert(changed, "Window positions unchanged after Super+C");
  });
});
