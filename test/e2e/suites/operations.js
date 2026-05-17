/**
 * Window operations tests (close, re-tile, etc.).
 */

import GLib from "gi://GLib";

import { describe, it, assert } from "../lib/framework.js";
import {
  launchApp,
  getWindowGeometries,
  getWindowCount,
  closeFocusedWindow,
  windowsOverlap,
  closeAllWindows,
} from "../lib/commands.js";

describe("Window Operations", function () {
  it("Alt+F4 closes window and remaining windows re-tile", async function () {
    await launchApp("org.gnome.Nautilus.desktop");
    await launchApp("org.gnome.Nautilus.desktop");
    await launchApp("org.gnome.Nautilus.desktop");

    const before = getWindowCount();
    assert(before === 3, "Expected 3 windows, got " + before);

    closeFocusedWindow();
    await new Promise(function (resolve) {
      GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1500, function () {
        resolve();
        return GLib.SOURCE_REMOVE;
      });
    });

    const count = getWindowCount();
    assert(count === 2, "Expected 2 windows after close, got " + count);

    const wins = getWindowGeometries();
    assert(!windowsOverlap(wins), "Windows overlap after re-tile");
  });
});
