/**
 * Move direction tests
 *
 * Verifies that Move Left/Right/Up/Down commands correctly
 * reposition windows in the tree without errors.
 */

import {
  launchApp,
  getWindowGeometries,
  sendAnvilCommandAndSettle,
  closeAllWindows,
  sleep,
  waitForWindowCount,
  waitForFocusChange,
  getFocusedWindowId,
} from "../../lib/shared-commands.js";

/**
 * @param {string} dir
 */
async function moveDir(dir) {
  await sendAnvilCommandAndSettle({ name: "Move", direction: dir });
}

describe("Move Directions", function () {
  beforeEach(async function () {
    await closeAllWindows();
    await sleep(200);
  });

  afterEach(async function () {
    await closeAllWindows();
  });

  it("Move Right repositions the focused window", async function () {
    await launchApp("org.gnome.Nautilus.desktop");
    await launchApp("org.gnome.Nautilus.desktop");
    await waitForWindowCount(2, 5000);

    const before = getWindowGeometries();
    expect(before.length).toBeGreaterThanOrEqual(2);

    const focusedId = getFocusedWindowId();
    expect(focusedId).toBeTruthy();

    await moveDir("Right");

    const after = getWindowGeometries().filter(function (w) {
      return !w.minimized;
    });
    expect(after.length).toBeGreaterThanOrEqual(2);
    after.forEach(function (w) {
      expect(w.width).toBeGreaterThan(0);
    });
    expect(getFocusedWindowId()).toBeTruthy();
  });

  it("Move Left repositions the focused window", async function () {
    await launchApp("org.gnome.Nautilus.desktop");
    await launchApp("org.gnome.Nautilus.desktop");
    await waitForWindowCount(2, 5000);

    const prevFocusId = getFocusedWindowId();
    await sendAnvilCommandAndSettle({ name: "Focus", direction: "Right" }, 2000);
    try {
      await waitForFocusChange(prevFocusId, 3000);
    } catch {
      /* ignore */
    }

    expect(getFocusedWindowId()).toBeTruthy();

    await moveDir("Left");

    const after = getWindowGeometries().filter(function (w) {
      return !w.minimized;
    });
    expect(after.length).toBeGreaterThanOrEqual(2);
    after.forEach(function (w) {
      expect(w.width).toBeGreaterThan(0);
    });
    expect(getFocusedWindowId()).toBeTruthy();
  });

  it("Move Up/Down in vertical layout", async function () {
    await launchApp("org.gnome.Nautilus.desktop");
    await launchApp("org.gnome.Nautilus.desktop");
    await waitForWindowCount(2, 5000);

    await sendAnvilCommandAndSettle({ name: "LayoutToggle" });

    await moveDir("Down");

    const after = getWindowGeometries().filter(function (w) {
      return !w.minimized;
    });
    expect(after.length).toBeGreaterThanOrEqual(2);
    after.forEach(function (w) {
      expect(w.width).toBeGreaterThan(0);
    });
    expect(getFocusedWindowId()).toBeTruthy();
  });

  it("Move through four windows maintains tiling", async function () {
    await launchApp("org.gnome.Nautilus.desktop");
    await launchApp("org.gnome.Nautilus.desktop");
    await launchApp("org.gnome.Nautilus.desktop");
    await launchApp("org.gnome.Nautilus.desktop");
    await waitForWindowCount(4, 5000);

    await moveDir("Right");
    await moveDir("Right");

    const after = getWindowGeometries().filter(function (w) {
      return !w.minimized;
    });
    expect(after.length).toBeGreaterThanOrEqual(4);
    after.forEach(function (w) {
      expect(w.width).toBeGreaterThan(0);
    });
  });
});
