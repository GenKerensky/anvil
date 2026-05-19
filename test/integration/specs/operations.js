/**
 * Window operations tests — Jasmine port of E2E operations suite.
 */

import {
  launchApp,
  getWindowGeometries,
  getWindowCount,
  closeFocusedWindow,
  windowsOverlap,
  closeAllWindows,
  sleep,
} from "../../lib/shared-commands.js";

describe("Window Operations", function () {
  beforeEach(async function () {
    await closeAllWindows();
    await sleep(500);
  });

  afterEach(async function () {
    await closeAllWindows();
  });

  it("Alt+F4 closes window and remaining windows re-tile", async function () {
    await launchApp("org.gnome.TextEditor.desktop");
    await launchApp("org.gnome.TextEditor.desktop");
    await launchApp("org.gnome.TextEditor.desktop");
    await sleep(1000);

    expect(getWindowCount()).toBe(3);

    closeFocusedWindow();
    await sleep(1500);

    expect(getWindowCount()).toBe(2);

    const wins = getWindowGeometries();
    expect(windowsOverlap(wins)).toBe(false);
  });
});
