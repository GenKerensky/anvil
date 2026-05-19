/**
 * Tiling specs
 *
 * Replaces: features/tiling.feature (@agent)
 *
 * Verifies default tiling mode, tree structure after window open, and that
 * layout settings can be toggled.
 */

import {
  getSettings,
  openWindow,
  closeAllWindows,
  launchApp,
  getWindowGeometries,
  getMonitorWorkArea,
  windowsOverlap,
  windowsFillWorkArea,
  sendAnvilCommand,
  sleep,
} from "./helpers.js";

const TOL = 0.03;

describe("Tiling", function () {
  beforeEach(async function () {
    await closeAllWindows();
    await sleep(300);
  });

  afterEach(async function () {
    await closeAllWindows();
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

  it("single window fills the work area", async function () {
    await launchApp("org.gnome.TextEditor.desktop");
    await sleep(800);

    const area = getMonitorWorkArea();
    const wins = getWindowGeometries();
    expect(wins.length).toBeGreaterThanOrEqual(1);
    const w = wins[wins.length - 1];

    expect(Math.abs(w.width - area.width) / area.width).toBeLessThan(TOL);
    expect(Math.abs(w.height - area.height) / area.height).toBeLessThan(TOL);
    expect(w.x).toBeGreaterThanOrEqual(area.x);
    expect(w.y).toBeGreaterThanOrEqual(area.y);
    expect(w.x + w.width).toBeLessThanOrEqual(area.x + area.width + 2);
    expect(w.y + w.height).toBeLessThanOrEqual(area.y + area.height + 2);
  });

  it("two windows do not overlap and stay within work area", async function () {
    await launchApp("org.gnome.TextEditor.desktop");
    await launchApp("org.gnome.TextEditor.desktop");
    await sleep(800);

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

  it("three windows tile without overlap", async function () {
    await launchApp("org.gnome.TextEditor.desktop");
    await launchApp("org.gnome.TextEditor.desktop");
    await launchApp("org.gnome.TextEditor.desktop");
    await sleep(1000);

    const wins = getWindowGeometries();
    expect(wins.length).toBeGreaterThanOrEqual(3);
    expect(windowsOverlap(wins)).toBe(false);
    expect(windowsFillWorkArea(wins, TOL)).toBe(true);
  });

  it("four windows tile without overlap", async function () {
    await launchApp("org.gnome.TextEditor.desktop");
    await launchApp("org.gnome.TextEditor.desktop");
    await launchApp("org.gnome.TextEditor.desktop");
    await launchApp("org.gnome.TextEditor.desktop");
    await sleep(1200);

    const wins = getWindowGeometries();
    expect(wins.length).toBeGreaterThanOrEqual(4);
    expect(windowsOverlap(wins)).toBe(false);
    expect(windowsFillWorkArea(wins, TOL)).toBe(true);
  });

  it("after-swap layout does not overlap", async function () {
    await launchApp("org.gnome.TextEditor.desktop");
    await launchApp("org.gnome.TextEditor.desktop");
    await launchApp("org.gnome.TextEditor.desktop");
    await sleep(1000);

    sendAnvilCommand({ name: "Swap", direction: "Left" });
    await sleep(800);

    const wins = getWindowGeometries();
    expect(wins.length).toBeGreaterThanOrEqual(3);
    expect(windowsOverlap(wins)).toBe(false);
  });

  it("after-toggle layout does not overlap", async function () {
    await launchApp("org.gnome.TextEditor.desktop");
    await launchApp("org.gnome.TextEditor.desktop");
    await launchApp("org.gnome.TextEditor.desktop");
    await sleep(1000);

    sendAnvilCommand({ name: "LayoutToggle" });
    await sleep(800);

    const wins = getWindowGeometries();
    expect(wins.length).toBeGreaterThanOrEqual(3);
    expect(windowsOverlap(wins)).toBe(false);
  });

  describe("Layout settings can be toggled", function () {
    const booleanKeys = [
      "stacked-tiling-mode-enabled",
      "tabbed-tiling-mode-enabled",
      "auto-split-enabled",
    ];

    for (const key of booleanKeys) {
      it("can toggle " + key, function () {
        const s = getSettings();
        s.set_boolean(key, false);
        expect(s.get_boolean(key)).toBe(false);
        s.set_boolean(key, true);
        expect(s.get_boolean(key)).toBe(true);
      });
    }
  });
});
