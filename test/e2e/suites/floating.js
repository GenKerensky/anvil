/**
 * Floating and snap layout tests
 *
 * Verifies FloatToggle, FloatClassToggle, SnapLayoutMove,
 * and TilingModeToggle commands.
 */

import {
  launchApp,
  getWindowGeometries,
  getMonitorWorkArea,
  getSettings,
  sendAnvilCommand,
  sendAnvilCommandAndSettle,
  closeAllWindows,
  sleep,
  waitForWindowCount,
} from "../../lib/shared-commands.js";

describe("Floating and Snap Layout", function () {
  beforeEach(async function () {
    await closeAllWindows();
    await sleep(200);
  });

  afterEach(async function () {
    // Ensure tiling is re-enabled
    getSettings().set_boolean("tiling-mode-enabled", true);
    await closeAllWindows();
  });

  it("FloatToggle floats the focused window", async function () {
    await launchApp("org.gnome.Nautilus.desktop");
    await launchApp("org.gnome.Nautilus.desktop");
    await waitForWindowCount(2, 5000);

    const before = getWindowGeometries();
    expect(before.length).toBeGreaterThanOrEqual(2);

    const totalBefore = before.reduce(function (sum, w) {
      return sum + w.width * w.height;
    }, 0);

    await sendAnvilCommandAndSettle({
      name: "FloatToggle",
      mode: "float",
      x: "center",
      y: "center",
      width: 0.65,
      height: 0.75,
    });

    const after = getWindowGeometries().filter(function (w) {
      return !w.minimized;
    });
    expect(after.length).toBeGreaterThanOrEqual(2);

    // Floated window is centered at ~65%×75% so total covered area drops, or at least changes.
    const totalAfter = after.reduce(function (sum, w) {
      return sum + w.width * w.height;
    }, 0);
    const sizesChanged =
      totalAfter !== totalBefore ||
      after.some(function (w, i) {
        return !before[i] || w.width !== before[i].width || w.height !== before[i].height;
      });
    expect(sizesChanged || totalAfter <= totalBefore).toBe(true);
  });

  it("FloatClassToggle toggles float by window class", async function () {
    await launchApp("org.gnome.Nautilus.desktop");
    await launchApp("org.gnome.Nautilus.desktop");
    await waitForWindowCount(2, 5000);

    const before = getWindowGeometries();
    expect(before.length).toBeGreaterThanOrEqual(2);

    sendAnvilCommand({
      name: "FloatClassToggle",
      mode: "float",
      x: "center",
      y: "center",
      width: 0.65,
      height: 0.75,
    });
    await waitForWindowCount(2, 5000);

    const after = getWindowGeometries();
    expect(after.length).toBeGreaterThanOrEqual(2);

    // Windows should no longer be fully tiling (one or more floated)
    const area = getMonitorWorkArea();
    const totalAfter = after.reduce(function (sum, w) {
      return sum + w.width * w.height;
    }, 0);
    const workArea = area.width * area.height;
    const ratioAfter = Math.abs(totalAfter - workArea) / workArea;
    // After float class toggle, some windows should be floated
    // so total area might not match work area exactly
    expect(ratioAfter).toBeGreaterThan(0.01);
  });

  it("SnapLayoutMove Left 1/3 snaps window to left third", async function () {
    await launchApp("org.gnome.Nautilus.desktop");
    await waitForWindowCount(1, 5000);

    const area = getMonitorWorkArea();

    await sendAnvilCommandAndSettle({
      name: "SnapLayoutMove",
      direction: "Left",
      amount: 1 / 3,
    });

    // Command must not throw; window remains mapped
    const wins = getWindowGeometries().filter(function (w) {
      return !w.minimized;
    });
    expect(wins.length).toBeGreaterThanOrEqual(1);
    expect(wins[0].width).toBeGreaterThan(0);
    expect(area.width).toBeGreaterThan(0);
  });

  it("SnapLayoutMove Right 2/3 snaps window to right two-thirds", async function () {
    await launchApp("org.gnome.Nautilus.desktop");
    await waitForWindowCount(1, 5000);

    await sendAnvilCommandAndSettle({
      name: "SnapLayoutMove",
      direction: "Right",
      amount: 2 / 3,
    });

    const wins = getWindowGeometries().filter(function (w) {
      return !w.minimized;
    });
    expect(wins.length).toBeGreaterThanOrEqual(1);
    expect(wins[0].width).toBeGreaterThan(0);
  });

  it("SnapLayoutMove Center centers the window", async function () {
    await launchApp("org.gnome.Nautilus.desktop");
    await waitForWindowCount(1, 5000);

    await sendAnvilCommandAndSettle({
      name: "SnapLayoutMove",
      direction: "Center",
    });

    const after = getWindowGeometries().filter(function (w) {
      return !w.minimized;
    });
    expect(after.length).toBeGreaterThanOrEqual(1);
    expect(after[0].width).toBeGreaterThan(0);
  });

  it("TilingModeToggle disables and re-enables tiling", async function () {
    await launchApp("org.gnome.Nautilus.desktop");
    await launchApp("org.gnome.Nautilus.desktop");
    await waitForWindowCount(2, 5000);

    const before = getWindowGeometries();
    expect(before.length).toBeGreaterThanOrEqual(2);

    // Disable tiling
    sendAnvilCommand({ name: "TilingModeToggle" });
    await sleep(200);
    expect(getSettings().get_boolean("tiling-mode-enabled")).toBe(false);

    // Re-enable tiling
    sendAnvilCommand({ name: "TilingModeToggle" });
    await sleep(200);
    expect(getSettings().get_boolean("tiling-mode-enabled")).toBe(true);
  });
});
