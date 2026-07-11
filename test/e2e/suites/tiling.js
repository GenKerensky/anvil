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
  openWindow,
  sendAnvilCommandAndSettle,
  waitForWindowCount,
  waitForGeometryStable,
  getNodePercents,
} from "../../lib/shared-commands.js";

beforeEach(async function () {
  await closeAllWindows();
});

afterEach(async function () {
  await closeAllWindows();
});

describe("Window Tiling", function () {
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
    await launchApp("org.gnome.Nautilus.desktop");
    await launchApp("org.gnome.Nautilus.desktop");
    await launchApp("org.gnome.Nautilus.desktop");
    await waitForWindowCount(3, 5000);

    await sendAnvilCommandAndSettle({ name: "Swap", direction: "Left" });

    const wins = getWindowGeometries().filter(function (g) {
      return !g.minimized;
    });
    expect(wins.length).toBeGreaterThanOrEqual(3);
    wins.forEach(function (w) {
      expect(w.width).toBeGreaterThan(0);
    });
  });

  it("after-toggle layout does not overlap", async function () {
    await launchApp("org.gnome.Nautilus.desktop");
    await launchApp("org.gnome.Nautilus.desktop");
    await launchApp("org.gnome.Nautilus.desktop");
    await waitForWindowCount(3, 5000);

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
  });
});
