/**
 * Border and gap tests
 *
 * Verifies FocusBorderToggle and GapSize commands.
 */

import {
  getSettings,
  launchApp,
  getWindowGeometries,
  getMonitorWorkArea,
  sendAnvilCommand,
  closeAllWindows,
  sleep,
  waitForWindowCount,
} from "../../lib/shared-commands.js";

describe("Borders and Gaps", function () {
  beforeEach(async function () {
    await closeAllWindows();
    await sleep(200);
    // Reset to known defaults
    getSettings().set_boolean("focus-border-toggle", false);
    getSettings().set_uint("window-gap-size-increment", 0);
  });

  afterEach(async function () {
    getSettings().set_boolean("focus-border-toggle", false);
    getSettings().set_uint("window-gap-size-increment", 0);
    await closeAllWindows();
  });

  it("FocusBorderToggle toggles the focus border setting", async function () {
    const before = getSettings().get_boolean("focus-border-toggle");
    expect(before).toBe(false);

    sendAnvilCommand({ name: "FocusBorderToggle" });
    await sleep(200);

    const after = getSettings().get_boolean("focus-border-toggle");
    expect(after).toBe(true);

    sendAnvilCommand({ name: "FocusBorderToggle" });
    await sleep(200);

    const restored = getSettings().get_boolean("focus-border-toggle");
    expect(restored).toBe(false);
  });

  it("GapSize increase changes window spacing", async function () {
    await launchApp("org.gnome.TextEditor.desktop");
    await launchApp("org.gnome.TextEditor.desktop");
    await waitForWindowCount(2, 5000);

    const before = getWindowGeometries();
    expect(before.length).toBeGreaterThanOrEqual(2);

    // Increase gap
    sendAnvilCommand({ name: "GapSize", amount: 1 });
    await sleep(200);

    const after = getWindowGeometries();
    expect(after.length).toBeGreaterThanOrEqual(2);

    // With gaps, total window area should be less than work area
    const area = getMonitorWorkArea();
    const totalAfter = after.reduce(function (sum, w) {
      return sum + w.width * w.height;
    }, 0);
    const workArea = area.width * area.height;
    // After increasing gap, windows should be smaller (with gaps between them)
    expect(totalAfter).toBeLessThan(workArea);

    // Verify setting was updated
    expect(getSettings().get_uint("window-gap-size-increment")).toBe(1);
  });

  it("GapSize decrease reduces window spacing", async function () {
    // First set a larger gap
    getSettings().set_uint("window-gap-size-increment", 4);

    await launchApp("org.gnome.TextEditor.desktop");
    await launchApp("org.gnome.TextEditor.desktop");
    await waitForWindowCount(2, 5000);

    // Decrease gap
    sendAnvilCommand({ name: "GapSize", amount: -1 });
    await sleep(200);

    expect(getSettings().get_uint("window-gap-size-increment")).toBe(3);
  });

  it("GapSize respects bounds (0-8)", async function () {
    getSettings().set_uint("window-gap-size-increment", 0);

    await launchApp("org.gnome.TextEditor.desktop");
    await waitForWindowCount(1, 5000);

    // Try to decrease below 0
    sendAnvilCommand({ name: "GapSize", amount: -5 });
    await sleep(200);

    expect(getSettings().get_uint("window-gap-size-increment")).toBe(0);

    // Try to increase above 8
    sendAnvilCommand({ name: "GapSize", amount: 10 });
    await sleep(200);

    expect(getSettings().get_uint("window-gap-size-increment")).toBe(8);
  });
});
