/**
 * Window operations tests (close, re-tile, etc.).
 */

import {
  closeAllWindows,
  closeFocusedWindow,
  getAnvilRuntime,
  getFocusedWindowId,
  getRuntimeWindowStates,
  launchApp,
  getWindowCount,
  waitForGeometry,
  windowsFillWorkArea,
} from "../../lib/shared-commands.js";

beforeEach(async function () {
  await closeAllWindows();
});

afterEach(async function () {
  await closeAllWindows();
});

/**
 * @param {Array<{title: string | null, x: number, y: number, width: number, height: number, minimized: boolean}>} windows
 */
function visibleWindows(windows) {
  return windows.filter(function (window) {
    return !window.minimized;
  });
}

describe("Window Operations", function () {
  it("Alt+F4 closes window and remaining windows re-tile", async function () {
    await launchApp("org.gnome.Nautilus.desktop");
    await launchApp("org.gnome.Nautilus.desktop");
    await launchApp("org.gnome.Nautilus.desktop");

    const before = getWindowCount();
    expect(before).toBe(3);

    const closedId = getFocusedWindowId();
    expect(closedId).not.toBeNull();
    await closeFocusedWindow();

    const wins = await waitForGeometry(function (windows) {
      const visible = visibleWindows(windows);
      return visible.length === 2 && windowsFillWorkArea(visible, 0.2);
    }, 5000);

    const count = getWindowCount();
    expect(count).toBe(2);

    const state = JSON.parse(getAnvilRuntime().getStateJson());
    if (state.tilingEngineMode === "core") {
      const portableWindows = /** @type {any[]} */ (state.portableTiling.windows);
      const participatingWindows = portableWindows.filter(function (window) {
        return window.participating;
      });
      expect(participatingWindows.length).toBe(2);
    } else {
      const treeWindows = getRuntimeWindowStates();
      expect(treeWindows.length).toBe(2);
      expect(
        treeWindows.some(function (window) {
          return window.windowId === closedId;
        })
      ).toBe(false);
    }

    const visibleWins = visibleWindows(wins);
    expect(visibleWins.length).toBe(2);
    visibleWins.forEach(function (w) {
      expect(w.width).toBeGreaterThan(0);
    });
    expect(windowsFillWorkArea(visibleWins, 0.2)).toBe(true);
  });
});
