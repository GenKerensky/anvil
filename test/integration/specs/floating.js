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
  getFocusedWindowTitle,
  getSettings,
  sendAnvilCommand,
  closeAllWindows,
  sleep,
} from "../../lib/shared-commands.js";

const COMMAND_DELAY = 800;

describe("Floating and Snap Layout", function () {
  beforeEach(async function () {
    await closeAllWindows();
    await sleep(500);
  });

  afterEach(async function () {
    // Ensure tiling is re-enabled
    getSettings().set_boolean("tiling-mode-enabled", true);
    await closeAllWindows();
  });

  it("FloatToggle floats the focused window", async function () {
    await launchApp("org.gnome.TextEditor.desktop");
    await launchApp("org.gnome.TextEditor.desktop");
    await sleep(COMMAND_DELAY);

    const before = getWindowGeometries();
    expect(before.length).toBeGreaterThanOrEqual(2);

    // The windows should be tiling initially
    const area = getMonitorWorkArea();
    const totalBefore = before.reduce(function (sum, w) {
      return sum + w.width * w.height;
    }, 0);
    const workArea = area.width * area.height;
    const ratioBefore = Math.abs(totalBefore - workArea) / workArea;
    expect(ratioBefore).toBeLessThan(0.05);

    sendAnvilCommand({
      name: "FloatToggle",
      mode: "float",
      x: "center",
      y: "center",
      width: 0.65,
      height: 0.75,
    });
    await sleep(COMMAND_DELAY);

    const after = getWindowGeometries();
    expect(after.length).toBeGreaterThanOrEqual(2);

    // After floating one window, the remaining should still tile
    // and the floated window should be smaller
    const totalAfter = after.reduce(function (sum, w) {
      return sum + w.width * w.height;
    }, 0);
    // Total area should decrease since one window is floated (centered, smaller)
    expect(totalAfter).toBeLessThan(totalBefore);
  });

  it("FloatClassToggle toggles float by window class", async function () {
    await launchApp("org.gnome.TextEditor.desktop");
    await launchApp("org.gnome.TextEditor.desktop");
    await sleep(COMMAND_DELAY);

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
    await sleep(COMMAND_DELAY);

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
    await launchApp("org.gnome.TextEditor.desktop");
    await sleep(COMMAND_DELAY);

    const area = getMonitorWorkArea();

    sendAnvilCommand({
      name: "SnapLayoutMove",
      direction: "Left",
      amount: 1 / 3,
    });
    await sleep(COMMAND_DELAY);

    const wins = getWindowGeometries();
    expect(wins.length).toBeGreaterThanOrEqual(1);
    const w = wins[0];

    // Should be roughly 1/3 width of work area
    expect(w.x).toBe(area.x);
    expect(Math.abs(w.width - area.width / 3) / (area.width / 3)).toBeLessThan(0.15);
  });

  it("SnapLayoutMove Right 2/3 snaps window to right two-thirds", async function () {
    await launchApp("org.gnome.TextEditor.desktop");
    await sleep(COMMAND_DELAY);

    const area = getMonitorWorkArea();

    sendAnvilCommand({
      name: "SnapLayoutMove",
      direction: "Right",
      amount: 2 / 3,
    });
    await sleep(COMMAND_DELAY);

    const wins = getWindowGeometries();
    expect(wins.length).toBeGreaterThanOrEqual(1);
    const w = wins[0];

    // Should be roughly 2/3 width
    expect(Math.abs(w.width - (area.width * 2) / 3) / ((area.width * 2) / 3)).toBeLessThan(0.15);
  });

  it("SnapLayoutMove Center centers the window", async function () {
    await launchApp("org.gnome.TextEditor.desktop");
    await sleep(COMMAND_DELAY);

    const before = getWindowGeometries();
    expect(before.length).toBeGreaterThanOrEqual(1);

    sendAnvilCommand({
      name: "SnapLayoutMove",
      direction: "Center",
    });
    await sleep(COMMAND_DELAY);

    const after = getWindowGeometries();
    expect(after.length).toBeGreaterThanOrEqual(1);

    // Centering should change position
    const b = before[0];
    const a = after[0];
    const changed = b.x !== a.x || b.y !== a.y;
    expect(changed).toBe(true);
  });

  it("TilingModeToggle disables and re-enables tiling", async function () {
    await launchApp("org.gnome.TextEditor.desktop");
    await launchApp("org.gnome.TextEditor.desktop");
    await sleep(COMMAND_DELAY);

    const before = getWindowGeometries();
    expect(before.length).toBeGreaterThanOrEqual(2);

    // Initially should be tiling
    let total = before.reduce(function (sum, w) {
      return sum + w.width * w.height;
    }, 0);
    const area = getMonitorWorkArea();
    let ratio = Math.abs(total - area.width * area.height) / (area.width * area.height);
    expect(ratio).toBeLessThan(0.05);

    // Disable tiling
    sendAnvilCommand({ name: "TilingModeToggle" });
    await sleep(COMMAND_DELAY);

    expect(getSettings().get_boolean("tiling-mode-enabled")).toBe(false);

    // Re-enable tiling
    sendAnvilCommand({ name: "TilingModeToggle" });
    await sleep(COMMAND_DELAY);

    expect(getSettings().get_boolean("tiling-mode-enabled")).toBe(true);
  });
});
