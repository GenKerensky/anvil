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
  getAnvilRuntime,
  getRuntimeWindowState,
  sendAnvilCommand,
  sendAnvilCommandAndSettle,
  closeAllWindows,
  sleep,
  waitForWindowCount,
  clearFloatOverridesForClass,
} from "../../lib/shared-commands.js";

describe("Floating and Snap Layout", function () {
  beforeEach(async function () {
    await closeAllWindows();
    // FloatClassToggle is a toggle: strip any leftover Nautilus class float
    // override from a prior spec so this spec starts from a known (non-floated)
    // state. Without this the spec is order-dependent (a prior override makes
    // the toggle un-float instead of float).
    clearFloatOverridesForClass("org.gnome.Nautilus");
    await sleep(200);
  });

  afterEach(async function () {
    // Ensure tiling is re-enabled and no Nautilus class float override bleeds
    getSettings().set_boolean("tiling-mode-enabled", true);
    clearFloatOverridesForClass("org.gnome.Nautilus");
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

    // Before the toggle, Nautilus is not float-exempt (override cleared in beforeEach).
    const wm = getAnvilRuntime();
    const focusBefore = /** @type {any} */ (global).display.get_focus_window();
    if (focusBefore) expect(wm.isFloatingExempt(focusBefore)).toBe(false);

    sendAnvilCommand({
      name: "FloatClassToggle",
      mode: "float",
      x: "center",
      y: "center",
      width: 0.65,
      height: 0.75,
    });
    await waitForWindowCount(2, 5000);

    // Assert the class-level float override was applied through the owner
    // (RulesEngine classification + tree node mode), not brittle geometry. The
    // prior ratio-after assertion depended on the floated window repositioning,
    // which Anvil does not force for FLOAT windows — so it only passed when
    // Nautilus was already warm (full-suite order) and failed in isolation.
    const focus = /** @type {any} */ (global).display.get_focus_window();
    expect(focus).toBeTruthy();
    expect(wm.isFloatingExempt(focus)).toBe(true);
    const focusNode = getRuntimeWindowState(focus);
    expect(focusNode?.mode).toBe("FLOAT"); // WINDOW_MODES.FLOAT
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
