/**
 * Move direction tests
 *
 * Verifies that Move Left/Right/Up/Down commands correctly
 * reposition windows in the tree without errors.
 */

import {
  launchApp,
  getWindowGeometries,
  getFocusedWindowTitle,
  sendAnvilCommand,
  closeAllWindows,
  sleep,
} from "../../lib/shared-commands.js";

const COMMAND_DELAY = 800;

/**
 * @param {string} dir
 */
function moveDir(dir) {
  sendAnvilCommand({ name: "Move", direction: dir });
}

describe("Move Directions", function () {
  beforeEach(async function () {
    await closeAllWindows();
    await sleep(500);
  });

  afterEach(async function () {
    await closeAllWindows();
  });

  it("Move Right repositions the focused window", async function () {
    await launchApp("org.gnome.TextEditor.desktop");
    await launchApp("org.gnome.TextEditor.desktop");
    await sleep(COMMAND_DELAY);

    const before = getWindowGeometries();
    expect(before.length).toBeGreaterThanOrEqual(2);

    const focusedTitle = getFocusedWindowTitle();
    expect(focusedTitle).toBeTruthy();

    moveDir("Right");
    await sleep(COMMAND_DELAY);

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
    expect(getFocusedWindowTitle()).toBe(focusedTitle);
  });

  it("Move Left repositions the focused window", async function () {
    await launchApp("org.gnome.TextEditor.desktop");
    await launchApp("org.gnome.TextEditor.desktop");
    await sleep(COMMAND_DELAY);

    // Focus the right window first
    sendAnvilCommand({ name: "Focus", direction: "Right" });
    await sleep(COMMAND_DELAY);

    const before = getWindowGeometries();
    expect(before.length).toBeGreaterThanOrEqual(2);

    const focusedTitle = getFocusedWindowTitle();
    expect(focusedTitle).toBeTruthy();

    moveDir("Left");
    await sleep(COMMAND_DELAY);

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

    expect(getFocusedWindowTitle()).toBe(focusedTitle);
  });

  it("Move Up/Down in vertical layout", async function () {
    await launchApp("org.gnome.TextEditor.desktop");
    await launchApp("org.gnome.TextEditor.desktop");
    await sleep(COMMAND_DELAY);

    // Toggle to vertical layout
    sendAnvilCommand({ name: "LayoutToggle" });
    await sleep(COMMAND_DELAY);

    const before = getWindowGeometries();
    expect(before.length).toBeGreaterThanOrEqual(2);

    const focusedTitle = getFocusedWindowTitle();

    moveDir("Down");
    await sleep(COMMAND_DELAY);

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

    expect(getFocusedWindowTitle()).toBe(focusedTitle);
  });

  it("Move through four windows maintains tiling", async function () {
    await launchApp("org.gnome.TextEditor.desktop");
    await launchApp("org.gnome.TextEditor.desktop");
    await launchApp("org.gnome.TextEditor.desktop");
    await launchApp("org.gnome.TextEditor.desktop");
    await sleep(1200);

    const before = getWindowGeometries();
    expect(before.length).toBeGreaterThanOrEqual(4);

    // Move right a few times
    moveDir("Right");
    await sleep(COMMAND_DELAY);
    moveDir("Right");
    await sleep(COMMAND_DELAY);

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
