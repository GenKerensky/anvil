/**
 * Window operations tests (close, re-tile, etc.).
 */

import GLib from "gi://GLib";

import {
  launchApp,
  getWindowGeometries,
  getWindowCount,
  closeFocusedWindow,
} from "../../lib/shared-commands.js";

/** @param {number} ms @returns {Promise<void>} */
function settle(ms) {
  return new Promise(function (resolve) {
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, function () {
      resolve(undefined);
      return GLib.SOURCE_REMOVE;
    });
  });
}

describe("Window Operations", function () {
  it("Alt+F4 closes window and remaining windows re-tile", async function () {
    await launchApp("org.gnome.Nautilus.desktop");
    await launchApp("org.gnome.Nautilus.desktop");
    await launchApp("org.gnome.Nautilus.desktop");

    const before = getWindowCount();
    expect(before).toBe(3);

    closeFocusedWindow();
    await settle(1500);

    const count = getWindowCount();
    expect(count).toBe(2);

    const wins = getWindowGeometries().filter(function (w) {
      return !w.minimized;
    });
    expect(wins.length).toBe(2);
    wins.forEach(function (w) {
      expect(w.width).toBeGreaterThan(0);
    });
  });
});
