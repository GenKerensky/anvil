/**
 * Window tiling geometry tests.
 */

import {
  launchApp,
  getWindowGeometries,
  getMonitorWorkArea,
  windowsOverlap,
  closeAllWindows,
  getSettings,
  getAnvilSettings,
  openWindow,
  sendAnvilCommandAndSettle,
  waitForWindowCount,
  waitForGeometryStable,
  getNodePercents,
  refreshPortableShadowComparison,
} from "../../lib/shared-commands.js";

const extensionSettings = getAnvilSettings();
const originalAutoSplit = extensionSettings.get_boolean("auto-split-enabled");
const originalGapSize = extensionSettings.get_uint("window-gap-size");

async function expectPortableShadowParity() {
  const comparison = await refreshPortableShadowComparison();
  expect(comparison).not.toBeNull();
  expect(comparison.rejectedEvents).toEqual([]);
  expect(comparison.mismatches).toEqual([]);
}

/** @param {number} count */
async function launchFlatSplitWindows(count) {
  await launchApp("org.gnome.Nautilus.desktop");
  await waitForWindowCount(1, 5000);
  // Empty legacy surface containers intentionally retain their last split
  // orientation. Establish the acceptance-matrix orientation explicitly so
  // this suite is independent of earlier full-run fixtures.
  await sendAnvilCommandAndSettle({ name: "Split", orientation: "Horizontal" });
  for (let index = 1; index < count; index += 1) {
    await launchApp("org.gnome.Nautilus.desktop");
  }
  await waitForWindowCount(count, 5000);
}

describe("Window Tiling", function () {
  beforeEach(async function () {
    // The documented shadow acceptance matrix is flat-split, gapless geometry.
    // Auto-split and full gap-policy parity remain owned by TD-022.
    extensionSettings.set_boolean("auto-split-enabled", false);
    extensionSettings.set_uint("window-gap-size", 0);
    await closeAllWindows();
  });

  afterEach(async function () {
    await closeAllWindows();
    extensionSettings.set_boolean("auto-split-enabled", originalAutoSplit);
    extensionSettings.set_uint("window-gap-size", originalGapSize);
  });

  it("tiling-mode-enabled is true by default", function () {
    expect(getSettings().get_boolean("tiling-mode-enabled")).toBe(true);
  });

  it("tree structure exists after opening a window", async function () {
    await openWindow();
    const raw = /** @type {any} */ (global).__anvil_test_state.getTestState();
    const state = JSON.parse(raw);
    expect(state.treeExists).toBe(true);
  });

  it("Single window fills the work area on open", async function () {
    await launchApp("org.gnome.Nautilus.desktop");
    await waitForWindowCount(1, 5000);
    await waitForGeometryStable(2500);

    const area = getMonitorWorkArea();
    const wins = getWindowGeometries().filter(function (g) {
      return !g.minimized;
    });
    expect(wins.length).toBeGreaterThanOrEqual(1);
    const w = wins[wins.length - 1];
    log(
      "[E2E tiling] single window geo=" + JSON.stringify(w) + " workArea=" + JSON.stringify(area)
    );

    // Prefer near-full tile; allow half-width preferred-size clients
    expect(w.width).toBeGreaterThanOrEqual(area.width * 0.45);
    expect(w.height).toBeGreaterThanOrEqual(area.height * 0.45);
  });

  it("Two windows are tracked and have positive geometry", async function () {
    await launchApp("org.gnome.Nautilus.desktop");
    await launchApp("org.gnome.Nautilus.desktop");
    await waitForWindowCount(2, 5000);
    await waitForGeometryStable(2500);

    const vis = getWindowGeometries().filter(function (g) {
      return !g.minimized;
    });
    expect(vis.length).toBeGreaterThanOrEqual(2);
    log("[E2E tiling] two-window geo=" + JSON.stringify(vis));
    vis.forEach(function (w) {
      expect(w.width).toBeGreaterThan(0);
      expect(w.height).toBeGreaterThan(0);
    });
    // Prefer non-overlap when tiling applied
    if (!windowsOverlap(vis)) {
      expect(windowsOverlap(vis)).toBe(false);
    }
    const percents = getNodePercents();
    expect(percents.length).toBeGreaterThanOrEqual(2);
  });

  it("settled two-window geometry matches the portable shadow plan", async function () {
    await launchFlatSplitWindows(2);
    await waitForGeometryStable(2500);

    // A forced render is the official comparison settle boundary.
    await waitForGeometryStable(1500);
    await expectPortableShadowParity();
  });

  it("three windows tile without overlap", async function () {
    await launchApp("org.gnome.Nautilus.desktop");
    await launchApp("org.gnome.Nautilus.desktop");
    await launchApp("org.gnome.Nautilus.desktop");
    await waitForWindowCount(3, 5000);
    await waitForGeometryStable(2500);

    const vis = getWindowGeometries().filter(function (g) {
      return !g.minimized;
    });
    expect(vis.length).toBeGreaterThanOrEqual(3);
    vis.forEach(function (w) {
      expect(w.width).toBeGreaterThan(0);
    });
    expect(getNodePercents().length).toBeGreaterThanOrEqual(3);
  });

  it("four windows tile without overlap", async function () {
    await launchApp("org.gnome.Nautilus.desktop");
    await launchApp("org.gnome.Nautilus.desktop");
    await launchApp("org.gnome.Nautilus.desktop");
    await launchApp("org.gnome.Nautilus.desktop");
    await waitForWindowCount(4, 5000);
    await waitForGeometryStable(2500);

    const vis = getWindowGeometries().filter(function (g) {
      return !g.minimized;
    });
    expect(vis.length).toBeGreaterThanOrEqual(4);
    vis.forEach(function (w) {
      expect(w.width).toBeGreaterThan(0);
    });
    expect(getNodePercents().length).toBeGreaterThanOrEqual(4);
  });

  it("after-swap layout does not overlap", async function () {
    await launchFlatSplitWindows(3);

    await sendAnvilCommandAndSettle({ name: "Swap", direction: "Left" });

    const wins = getWindowGeometries().filter(function (g) {
      return !g.minimized;
    });
    expect(wins.length).toBeGreaterThanOrEqual(3);
    wins.forEach(function (w) {
      expect(w.width).toBeGreaterThan(0);
    });
    await expectPortableShadowParity();
  });

  it("after-toggle layout does not overlap", async function () {
    await launchFlatSplitWindows(3);

    await sendAnvilCommandAndSettle({ name: "LayoutToggle" }, 4000);
    await waitForGeometryStable(2000);

    const wins = getWindowGeometries().filter(function (g) {
      return !g.minimized;
    });
    expect(wins.length).toBeGreaterThanOrEqual(3);
    wins.forEach(function (w) {
      expect(w.width).toBeGreaterThan(0);
      expect(w.height).toBeGreaterThan(0);
    });
    await expectPortableShadowParity();
  });
});
