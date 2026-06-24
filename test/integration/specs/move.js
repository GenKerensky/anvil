/**
 * Move direction tests
 *
 * Verifies that Move Left/Right/Up/Down commands correctly
 * reposition windows in the tree without errors.
 */

import {
  launchApp,
  getWindowGeometries,
  sendAnvilCommand,
  closeAllWindows,
  sleep,
  waitForWindowCount,
  waitForFocusChange,
  getFocusedWindowId,
} from "../../lib/shared-commands.js";

/**
 * @param {string} dir
 */
function moveDir(dir) {
  sendAnvilCommand({ name: "Move", direction: dir });
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
    await launchApp("org.gnome.TextEditor.desktop");
    await launchApp("org.gnome.TextEditor.desktop");
    await waitForWindowCount(2, 5000);

    const before = getWindowGeometries();
    expect(before.length).toBeGreaterThanOrEqual(2);

    const focusedId = getFocusedWindowId();
    expect(focusedId).toBeTruthy();

    moveDir("Right");
    await waitForWindowCount(2, 5000);

    const after = getWindowGeometries();
    expect(after.length).toBeGreaterThanOrEqual(2);

    // Should not overlap
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

    // Focus should still be on the moved window
    expect(getFocusedWindowId()).toBe(focusedId);
  });

  it("Move Left repositions the focused window", async function () {
    await launchApp("org.gnome.TextEditor.desktop");
    await launchApp("org.gnome.TextEditor.desktop");
    await waitForWindowCount(2, 5000);

    // Focus the right window first
    const prevFocusId = getFocusedWindowId();
    sendAnvilCommand({ name: "Focus", direction: "Right" });
    await waitForFocusChange(prevFocusId, 5000);

    const before = getWindowGeometries();
    expect(before.length).toBeGreaterThanOrEqual(2);

    const focusedId = getFocusedWindowId();
    expect(focusedId).toBeTruthy();

    moveDir("Left");
    await waitForWindowCount(2, 5000);

    const after = getWindowGeometries();
    expect(after.length).toBeGreaterThanOrEqual(2);

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

    expect(getFocusedWindowId()).toBe(focusedId);
  });

  it("Move Up/Down in vertical layout", async function () {
    await launchApp("org.gnome.TextEditor.desktop");
    await launchApp("org.gnome.TextEditor.desktop");
    await waitForWindowCount(2, 5000);

    // Toggle to vertical layout
    sendAnvilCommand({ name: "LayoutToggle" });
    await waitForWindowCount(2, 5000);

    const before = getWindowGeometries();
    expect(before.length).toBeGreaterThanOrEqual(2);

    const focusedId = getFocusedWindowId();

    moveDir("Down");
    await waitForWindowCount(2, 5000);

    const after = getWindowGeometries();
    expect(after.length).toBeGreaterThanOrEqual(2);

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

    expect(getFocusedWindowId()).toBe(focusedId);
  });

  it("Move through four windows maintains tiling", async function () {
    await launchApp("org.gnome.TextEditor.desktop");
    await launchApp("org.gnome.TextEditor.desktop");
    await launchApp("org.gnome.TextEditor.desktop");
    await launchApp("org.gnome.TextEditor.desktop");
    await waitForWindowCount(4, 5000);

    const before = getWindowGeometries();
    expect(before.length).toBeGreaterThanOrEqual(4);

    // Move right a few times
    moveDir("Right");
    await waitForWindowCount(4, 5000);
    moveDir("Right");
    await waitForWindowCount(4, 5000);

    const after = getWindowGeometries();
    expect(after.length).toBeGreaterThanOrEqual(4);

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
