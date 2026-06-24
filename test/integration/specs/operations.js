/**
 * Window operations tests — Jasmine port of E2E operations suite.
 */

import {
  launchApp,
  getWindowGeometries,
  closeFocusedWindow,
  windowsOverlap,
  closeAllWindows,
  sleep,
  waitForWindowCount,
} from "../../lib/shared-commands.js";

describe("Window Operations", function () {
  beforeEach(async function () {
    await closeAllWindows();
    await sleep(200);
  });

  afterEach(async function () {
    await closeAllWindows();
  });

  it("Alt+F4 closes window and remaining windows re-tile", async function () {
    await launchApp("org.gnome.TextEditor.desktop");
    await launchApp("org.gnome.TextEditor.desktop");
    await launchApp("org.gnome.TextEditor.desktop");
    await waitForWindowCount(3, 5000);

    expect(getWindowGeometries().length).toBe(3);

    await closeFocusedWindow();
    await waitForWindowCount(2, 5000);

    expect(getWindowGeometries().length).toBe(2);

    const wins = getWindowGeometries();
    expect(windowsOverlap(wins)).toBe(false);
  });
});
