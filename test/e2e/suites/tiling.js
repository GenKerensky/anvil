/**
 * Window tiling geometry tests.
 */

import {
  launchApp,
  getWindowGeometries,
  getMonitorWorkArea,
  windowsOverlap,
  closeAllWindows,
} from "../../lib/shared-commands.js";

beforeEach(async function () {
  await closeAllWindows();
});

const TOL = 0.03;

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

describe("Window Tiling", function () {
  it("Single window fills the work area on open", async function () {
    await launchApp("org.gnome.Nautilus.desktop");
    const area = getMonitorWorkArea();
    const wins = getWindowGeometries();
    expect(wins.length).toBeGreaterThanOrEqual(1);
    const w = wins[wins.length - 1];

    assertApprox(w.width, area.width, TOL, "width");
    assertApprox(w.height, area.height, TOL, "height");
    expect(w.x).toBeGreaterThanOrEqual(area.x);
    expect(w.y).toBeGreaterThanOrEqual(area.y);
    expect(w.x + w.width).toBeLessThanOrEqual(area.x + area.width + 2);
    expect(w.y + w.height).toBeLessThanOrEqual(area.y + area.height + 2);
  });

  it("Two windows do not overlap and stay within work area", async function () {
    await launchApp("org.gnome.Nautilus.desktop");
    await launchApp("org.gnome.Nautilus.desktop");

    const wins = getWindowGeometries();
    expect(wins.length).toBeGreaterThanOrEqual(2);
    expect(windowsOverlap(wins)).toBe(false);

    const area = getMonitorWorkArea();
    for (let i = 0; i < wins.length; i++) {
      const w = wins[i];
      expect(w.width).toBeGreaterThan(0);
      expect(w.height).toBeGreaterThan(0);
      expect(w.x).toBeGreaterThanOrEqual(area.x);
      expect(w.y).toBeGreaterThanOrEqual(area.y);
      expect(w.x + w.width).toBeLessThanOrEqual(area.x + area.width + 2);
      expect(w.y + w.height).toBeLessThanOrEqual(area.y + area.height + 2);
    }
  });
});
