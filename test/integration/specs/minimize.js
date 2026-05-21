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
} from "../../lib/shared-commands.js";

const COMMAND_DELAY = 1000;

/** @returns {Meta.Window | null} */
function getFocusedWindow() {
  return global.display.get_focus_window();
}

describe("Minimize Behavior", function () {
  beforeEach(async function () {
    await closeAllWindows();
    await sleep(500);
  });

  afterEach(async function () {
    await closeAllWindows();
  });

  it("minimizing a window re-tiles remaining windows", async function () {
    await launchApp("org.gnome.TextEditor.desktop");
    await launchApp("org.gnome.TextEditor.desktop");
    await launchApp("org.gnome.TextEditor.desktop");
    await sleep(COMMAND_DELAY);

    expect(getWindowCount()).toBe(3);

    const before = getWindowGeometries();
    expect(before.length).toBeGreaterThanOrEqual(3);

    // Minimize the focused window
    const w = getFocusedWindow();
    expect(w).not.toBeNull();
    if (w) {
      w.minimize();
    }
    await sleep(COMMAND_DELAY);

    // Should still report 3 windows (minimized still counts)
    expect(getWindowCount()).toBe(3);

    // Visible windows should re-tile without overlap
    const ws = global.display.get_workspace_manager().get_active_workspace();
    const visible = global.display
      .get_tab_list(Meta.TabList.NORMAL_ALL, ws)
      .filter(function (/** @type {{ minimized: boolean }} */ win) {
        return !win.minimized;
      });

    if (visible.length >= 2) {
      const visibleGeos = visible.map(function (win) {
        const rect = win.get_frame_rect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      });

      let overlap = false;
      for (let i = 0; i < visibleGeos.length; i++) {
        for (let j = i + 1; j < visibleGeos.length; j++) {
          const a = visibleGeos[i];
          const b = visibleGeos[j];
          if (
            a.x < b.x + b.width &&
            a.x + a.width > b.x &&
            a.y < b.y + b.height &&
            a.y + a.height > b.y
          ) {
            overlap = true;
          }
        }
      }
      expect(overlap).toBe(false);
    }
  });

  it("unminimizing a window restores tiling", async function () {
    await launchApp("org.gnome.TextEditor.desktop");
    await launchApp("org.gnome.TextEditor.desktop");
    await sleep(COMMAND_DELAY);

    const before = getWindowGeometries();
    expect(before.length).toBeGreaterThanOrEqual(2);

    // Minimize one window
    const w = getFocusedWindow();
    expect(w).not.toBeNull();
    if (w) {
      w.minimize();
    }
    await sleep(COMMAND_DELAY);

    // Unminimize it
    if (w) {
      w.unminimize();
    }
    await sleep(COMMAND_DELAY);

    const after = getWindowGeometries();
    expect(after.length).toBeGreaterThanOrEqual(2);

    // Should not overlap after unminimize
    let overlap = false;
    for (let i = 0; i < after.length; i++) {
      for (let j = i + 1; j < after.length; j++) {
        const a = after[i];
        const b = after[j];
        if (
          a.x < b.x + b.width &&
          a.x + a.width > b.x &&
          a.y < b.y + b.height &&
          a.y + a.height > b.y
        ) {
          overlap = true;
        }
      }
    }
    expect(overlap).toBe(false);
  });
});
