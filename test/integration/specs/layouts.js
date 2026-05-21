/**
 * Layout toggle tests
 *
 * Verifies Split, LayoutStackedToggle, LayoutTabbedToggle,
 * and ShowTabDecorationToggle commands.
 */

import {
  launchApp,
  getWindowGeometries,
  getAnvilWM,
  getSettings,
  sendAnvilCommand,
  closeAllWindows,
  sleep,
} from "../../lib/shared-commands.js";

const COMMAND_DELAY = 800;

describe("Advanced Layouts", function () {
  beforeEach(async function () {
    await closeAllWindows();
    await sleep(500);
  });

  afterEach(async function () {
    // Reset layout settings to defaults
    const s = getSettings();
    s.set_boolean("stacked-tiling-mode-enabled", true);
    s.set_boolean("tabbed-tiling-mode-enabled", true);
    s.set_boolean("showtab-decoration-enabled", true);
    await closeAllWindows();
  });

  it("Split Horizontal creates a horizontal container", async function () {
    await launchApp("org.gnome.TextEditor.desktop");
    await launchApp("org.gnome.TextEditor.desktop");
    await sleep(COMMAND_DELAY);

    sendAnvilCommand({ name: "Split", orientation: "horizontal" });
    await sleep(COMMAND_DELAY);

    const wins = getWindowGeometries();
    expect(wins.length).toBeGreaterThanOrEqual(2);

    // Windows should be side-by-side (horizontal split)
    const a = wins[0];
    const b = wins[1];
    expect(Math.abs(a.y - b.y) / Math.abs(a.y || 1)).toBeLessThan(0.05);
    expect(a.x).not.toBe(b.x);
  });

  it("Split Vertical creates a vertical container", async function () {
    await launchApp("org.gnome.TextEditor.desktop");
    await launchApp("org.gnome.TextEditor.desktop");
    await sleep(COMMAND_DELAY);

    sendAnvilCommand({ name: "Split", orientation: "vertical" });
    await sleep(COMMAND_DELAY);

    const wins = getWindowGeometries();
    expect(wins.length).toBeGreaterThanOrEqual(2);

    // Windows should be stacked (vertical split)
    const a = wins[0];
    const b = wins[1];
    expect(Math.abs(a.x - b.x) / Math.abs(a.x || 1)).toBeLessThan(0.05);
    expect(a.y).not.toBe(b.y);
  });

  it("LayoutStackedToggle switches to stacked layout", async function () {
    // Enable stacked tiling mode first
    getSettings().set_boolean("stacked-tiling-mode-enabled", true);

    await launchApp("org.gnome.TextEditor.desktop");
    await launchApp("org.gnome.TextEditor.desktop");
    await sleep(COMMAND_DELAY);

    sendAnvilCommand({ name: "LayoutStackedToggle" });
    await sleep(COMMAND_DELAY);

    const wins = getWindowGeometries();
    expect(wins.length).toBeGreaterThanOrEqual(2);

    // In stacked mode, windows should share the same x position
    // and have similar widths
    const a = wins[0];
    const b = wins[1];
    expect(Math.abs(a.x - b.x) / Math.abs(a.x || 1)).toBeLessThan(0.1);
    expect(Math.abs(a.width - b.width) / Math.abs(a.width || 1)).toBeLessThan(0.1);
  });

  it("LayoutTabbedToggle switches to tabbed layout", async function () {
    // Enable tabbed tiling mode first
    getSettings().set_boolean("tabbed-tiling-mode-enabled", true);

    await launchApp("org.gnome.TextEditor.desktop");
    await launchApp("org.gnome.TextEditor.desktop");
    await sleep(COMMAND_DELAY);

    sendAnvilCommand({ name: "LayoutTabbedToggle" });
    await sleep(COMMAND_DELAY);

    const wins = getWindowGeometries();
    expect(wins.length).toBeGreaterThanOrEqual(2);

    // In tabbed mode, windows should share the same x position
    // and have similar widths
    const a = wins[0];
    const b = wins[1];
    expect(Math.abs(a.x - b.x) / Math.abs(a.x || 1)).toBeLessThan(0.1);
    expect(Math.abs(a.width - b.width) / Math.abs(a.width || 1)).toBeLessThan(0.1);
  });

  it("ShowTabDecorationToggle toggles tab decoration setting", async function () {
    getSettings().set_boolean("tabbed-tiling-mode-enabled", true);
    getSettings().set_boolean("showtab-decoration-enabled", true);

    await launchApp("org.gnome.TextEditor.desktop");
    await launchApp("org.gnome.TextEditor.desktop");
    await sleep(COMMAND_DELAY);

    // First switch to tabbed mode
    sendAnvilCommand({ name: "LayoutTabbedToggle" });
    await sleep(COMMAND_DELAY);

    const before = getSettings().get_boolean("showtab-decoration-enabled");
    expect(before).toBe(true);

    sendAnvilCommand({ name: "ShowTabDecorationToggle" });
    await sleep(COMMAND_DELAY);

    const after = getSettings().get_boolean("showtab-decoration-enabled");
    expect(after).toBe(false);
  });

  it("LayoutToggle cycles between horizontal and vertical", async function () {
    await launchApp("org.gnome.TextEditor.desktop");
    await launchApp("org.gnome.TextEditor.desktop");
    await sleep(COMMAND_DELAY);

    const before = getWindowGeometries();
    expect(before.length).toBeGreaterThanOrEqual(2);
    const a1 = before[0];
    const b1 = before[1];

    // Initially should be side-by-side (horizontal)
    const isHorizontalInitially = Math.abs(a1.y - b1.y) / Math.abs(a1.y || 1) < 0.05;

    sendAnvilCommand({ name: "LayoutToggle" });
    await sleep(COMMAND_DELAY);

    const after = getWindowGeometries();
    expect(after.length).toBeGreaterThanOrEqual(2);
    const a2 = after[0];
    const b2 = after[1];

    // After toggle, should be different orientation
    const isHorizontalAfter = Math.abs(a2.y - b2.y) / Math.abs(a2.y || 1) < 0.05;

    if (isHorizontalInitially) {
      expect(isHorizontalAfter).toBe(false);
    } else {
      expect(isHorizontalAfter).toBe(true);
    }
  });
});
