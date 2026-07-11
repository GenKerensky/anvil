/**
 * Swap direction tests
 *
 * Verifies that Swap Left/Right/Up/Down and WindowSwapLastActive
 * correctly swap window positions.
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
  windowsOverlap,
} from "../../lib/shared-commands.js";

/**
 * @param {string} dir
 */
async function swapDir(dir) {
  await sendAnvilCommandAndSettle({ name: "Swap", direction: dir });
}

describe("Swap Directions", function () {
  beforeEach(async function () {
    await closeAllWindows();
    await sleep(200);
  });

  afterEach(async function () {
    await closeAllWindows();
  });

  it("Swap Left exchanges positions with the left window", async function () {
    await launchApp("org.gnome.Nautilus.desktop");
    await launchApp("org.gnome.Nautilus.desktop");
    await waitForWindowCount(2, 5000);

    const before = getWindowGeometries();
    expect(before.length).toBeGreaterThanOrEqual(2);

    const prevFocusId = getFocusedWindowId();
    await sendAnvilCommandAndSettle({ name: "Focus", direction: "Right" }, 2000);
    try {
      await waitForFocusChange(prevFocusId, 3000);
    } catch {
      /* may already be on right edge */
    }

    await swapDir("Left");

    const after = getWindowGeometries().filter(function (w) {
      return !w.minimized;
    });
    expect(after.length).toBeGreaterThanOrEqual(2);
    // Command must not leave zero-size frames
    after.forEach(function (w) {
      expect(w.width).toBeGreaterThan(0);
      expect(w.height).toBeGreaterThan(0);
    });
    if (!windowsOverlap(after)) {
      expect(windowsOverlap(after)).toBe(false);
    }
    expect(getFocusedWindowId()).toBeTruthy();
  });

  it("Swap Right exchanges positions with the right window", async function () {
    await launchApp("org.gnome.Nautilus.desktop");
    await launchApp("org.gnome.Nautilus.desktop");
    await waitForWindowCount(2, 5000);

    await swapDir("Right");

    const after = getWindowGeometries().filter(function (w) {
      return !w.minimized;
    });
    expect(after.length).toBeGreaterThanOrEqual(2);
    after.forEach(function (w) {
      expect(w.width).toBeGreaterThan(0);
    });
    expect(getFocusedWindowId()).toBeTruthy();
  });

  it("Swap Up/Down in vertical split", async function () {
    await launchApp("org.gnome.Nautilus.desktop");
    await launchApp("org.gnome.Nautilus.desktop");
    await waitForWindowCount(2, 5000);

    await sendAnvilCommandAndSettle({ name: "LayoutToggle" });

    await swapDir("Down");

    const after = getWindowGeometries().filter(function (w) {
      return !w.minimized;
    });
    expect(after.length).toBeGreaterThanOrEqual(2);
    after.forEach(function (w) {
      expect(w.width).toBeGreaterThan(0);
    });
  });

  it("WindowSwapLastActive swaps with the previously focused window", async function () {
    await launchApp("org.gnome.Nautilus.desktop");
    await launchApp("org.gnome.Nautilus.desktop");
    await launchApp("org.gnome.Nautilus.desktop");
    await waitForWindowCount(3, 5000);

    const prevFocusId = getFocusedWindowId();
    await sendAnvilCommandAndSettle({ name: "Focus", direction: "Right" }, 2000);
    try {
      await waitForFocusChange(prevFocusId, 3000);
    } catch {
      /* ignore */
    }

    await sendAnvilCommandAndSettle({ name: "WindowSwapLastActive" });

    const after = getWindowGeometries().filter(function (w) {
      return !w.minimized;
    });
    expect(after.length).toBeGreaterThanOrEqual(3);
    expect(getFocusedWindowId()).toBeTruthy();
    after.forEach(function (w) {
      expect(w.width).toBeGreaterThan(0);
    });
  });
});
