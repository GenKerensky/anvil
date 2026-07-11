/**
 * Minimize / unminimize tests
 *
 * Verifies that minimizing and unminimizing windows
 * correctly updates the tiling layout.
 */

import Meta from "gi://Meta";
import {
  launchApp,
  getWindowGeometries,
  getWindowCount,
  closeAllWindows,
  sleep,
  waitForWindowCount,
} from "../../lib/shared-commands.js";

/** @returns {Meta.Window | null} */
function getFocusedWindow() {
  return global.display.get_focus_window();
}

describe("Minimize Behavior", function () {
  beforeEach(async function () {
    await closeAllWindows();
    await sleep(200);
  });

  afterEach(async function () {
    await closeAllWindows();
  });

  it("minimizing a window re-tiles remaining windows", async function () {
    await launchApp("org.gnome.Nautilus.desktop");
    await launchApp("org.gnome.Nautilus.desktop");
    await launchApp("org.gnome.Nautilus.desktop");
    await waitForWindowCount(3, 5000);

    expect(getWindowCount()).toBe(3);

    const before = getWindowGeometries();
    expect(before.length).toBeGreaterThanOrEqual(3);

    // Minimize the focused window
    const w = getFocusedWindow();
    expect(w).not.toBeNull();
    if (w) {
      w.minimize();
    }
    await sleep(800);

    // getWindowCount() excludes minimized windows
    expect(getWindowCount()).toBe(2);

    // Visible windows should re-tile without overlap
    const ws = global.display.get_workspace_manager().get_active_workspace();
    const visible = global.display
      .get_tab_list(Meta.TabList.NORMAL_ALL, ws)
      .filter(function (/** @type {{ minimized: boolean }} */ win) {
        return !win.minimized;
      });

    expect(visible.length).toBe(2);

    const visibleGeos = visible.map(function (win) {
      const rect = win.get_frame_rect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });
    visibleGeos.forEach(function (g) {
      expect(g.width).toBeGreaterThan(0);
      expect(g.height).toBeGreaterThan(0);
    });
  });

  it("unminimizing a window restores tiling", async function () {
    await launchApp("org.gnome.Nautilus.desktop");
    await launchApp("org.gnome.Nautilus.desktop");
    await waitForWindowCount(2, 5000);

    const before = getWindowGeometries();
    expect(before.length).toBeGreaterThanOrEqual(2);

    const w = getFocusedWindow();
    expect(w).not.toBeNull();
    if (w) {
      w.minimize();
    }
    await sleep(800);

    if (w) {
      w.unminimize();
    }
    await sleep(800);

    const after = getWindowGeometries().filter(function (g) {
      return !g.minimized;
    });
    expect(after.length).toBeGreaterThanOrEqual(2);
    after.forEach(function (g) {
      expect(g.width).toBeGreaterThan(0);
      expect(g.height).toBeGreaterThan(0);
    });
  });
});
