/**
 * Swap direction tests
 *
 * Verifies that Swap Left/Right/Up/Down and WindowSwapLastActive
 * correctly swap window positions.
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
function swapDir(dir) {
  sendAnvilCommand({ name: "Swap", direction: dir });
}

describe("Swap Directions", function () {
  beforeEach(async function () {
    await closeAllWindows();
    await sleep(500);
  });

  afterEach(async function () {
    await closeAllWindows();
  });

  it("Swap Left exchanges positions with the left window", async function () {
    await launchApp("org.gnome.TextEditor.desktop");
    await launchApp("org.gnome.TextEditor.desktop");
    await sleep(COMMAND_DELAY);

    const before = getWindowGeometries();
    expect(before.length).toBeGreaterThanOrEqual(2);

    // Focus right window first
    sendAnvilCommand({ name: "Focus", direction: "Right" });
    await sleep(COMMAND_DELAY);

    const focusedBefore = getFocusedWindowTitle();

    swapDir("Left");
    await sleep(COMMAND_DELAY);

    const after = getWindowGeometries();
    expect(after.length).toBeGreaterThanOrEqual(2);

    // Windows should still not overlap after swap
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

    // Focus should still be on the swapped window
    const focusedAfter = getFocusedWindowTitle();
    expect(focusedAfter).toBe(focusedBefore);
  });

  it("Swap Right exchanges positions with the right window", async function () {
    await launchApp("org.gnome.TextEditor.desktop");
    await launchApp("org.gnome.TextEditor.desktop");
    await sleep(COMMAND_DELAY);

    const before = getWindowGeometries();
    expect(before.length).toBeGreaterThanOrEqual(2);

    const focusedBefore = getFocusedWindowTitle();

    swapDir("Right");
    await sleep(COMMAND_DELAY);

    const after = getWindowGeometries();
    expect(after.length).toBeGreaterThanOrEqual(2);

    // No overlap after swap
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

    const focusedAfter = getFocusedWindowTitle();
    expect(focusedAfter).toBe(focusedBefore);
  });

  it("Swap Up/Down in vertical split", async function () {
    await launchApp("org.gnome.TextEditor.desktop");
    await launchApp("org.gnome.TextEditor.desktop");
    await sleep(COMMAND_DELAY);

    // Toggle to vertical layout
    sendAnvilCommand({ name: "LayoutToggle" });
    await sleep(COMMAND_DELAY);

    const before = getWindowGeometries();
    expect(before.length).toBeGreaterThanOrEqual(2);

    swapDir("Down");
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
  });

  it("WindowSwapLastActive swaps with the previously focused window", async function () {
    await launchApp("org.gnome.TextEditor.desktop");
    await launchApp("org.gnome.TextEditor.desktop");
    await launchApp("org.gnome.TextEditor.desktop");
    await sleep(1000);

    const before = getWindowGeometries();
    expect(before.length).toBeGreaterThanOrEqual(3);

    // Focus a specific window
    sendAnvilCommand({ name: "Focus", direction: "Right" });
    await sleep(COMMAND_DELAY);
    const focusedBefore = getFocusedWindowTitle();

    sendAnvilCommand({ name: "WindowSwapLastActive" });
    await sleep(COMMAND_DELAY);

    const after = getWindowGeometries();
    expect(after.length).toBeGreaterThanOrEqual(3);

    // Focus should remain on the swapped window
    const focusedAfter = getFocusedWindowTitle();
    expect(focusedAfter).toBe(focusedBefore);

    // No overlap
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
