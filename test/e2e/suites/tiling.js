/**
 * Window tiling geometry tests.
 */

import { describe, it, assert, assertApprox, beforeEach } from "../lib/framework.js";
import {
  launchApp,
  getWindowGeometries,
  getMonitorWorkArea,
  windowsOverlap,
  closeAllWindows,
} from "../lib/commands.js";

beforeEach(async function () {
  await closeAllWindows();
});

const TOL = 0.03;

describe("Window Tiling", function () {
  it("Single window fills the work area on open", async function () {
    await launchApp("org.gnome.Nautilus.desktop");
    const area = getMonitorWorkArea();
    const wins = getWindowGeometries();
    assert(wins.length >= 1, "No windows found");
    const w = wins[wins.length - 1];

    assertApprox(w.width, area.width, TOL, "width");
    assertApprox(w.height, area.height, TOL, "height");
    assert(w.x >= area.x, "Window left edge out of bounds");
    assert(w.y >= area.y, "Window top edge out of bounds");
    assert(w.x + w.width <= area.x + area.width + 2, "Window right edge out of bounds");
    assert(w.y + w.height <= area.y + area.height + 2, "Window bottom edge out of bounds");
  });

  it("Two windows do not overlap and stay within work area", async function () {
    await launchApp("org.gnome.Nautilus.desktop");
    await launchApp("org.gnome.Nautilus.desktop");

    const wins = getWindowGeometries();
    assert(wins.length >= 2, "Need >= 2 windows, got " + wins.length);
    assert(!windowsOverlap(wins), "Windows overlap");

    const area = getMonitorWorkArea();
    for (let i = 0; i < wins.length; i++) {
      const w = wins[i];
      assert(w.width > 0, "Window " + i + " has zero width");
      assert(w.height > 0, "Window " + i + " has zero height");
      assert(w.x >= area.x, "Window " + i + " left edge out of bounds");
      assert(w.y >= area.y, "Window " + i + " top edge out of bounds");
      assert(w.x + w.width <= area.x + area.width + 2, "Window " + i + " right edge out of bounds");
      assert(
        w.y + w.height <= area.y + area.height + 2,
        "Window " + i + " bottom edge out of bounds"
      );
    }
  });
});
