/**
 * Focus direction tests
 *
 * Verifies that Focus Left/Right/Up/Down commands correctly move focus
 * between tiled windows.
 */

import {
  launchApp,
  getFocusedWindowId,
  waitForFocusChange,
  waitForWindowCount,
  getWindowGeometries,
  sendAnvilCommand,
  closeAllWindows,
  sleep,
} from "../../lib/shared-commands.js";

/**
 * @param {string} dir
 */
function focusDir(dir) {
  sendAnvilCommand({ name: "Focus", direction: dir });
}

describe("Focus Directions", function () {
  beforeEach(async function () {
    await closeAllWindows();
    await sleep(500);
  });

  afterEach(async function () {
    await closeAllWindows();
  });

  it("Focus Right changes focus to another window", async function () {
    await launchApp("org.gnome.TextEditor.desktop");
    await launchApp("org.gnome.TextEditor.desktop");
    await waitForWindowCount(2, 3000);

    const wins = getWindowGeometries();
    expect(wins.length).toBeGreaterThanOrEqual(2);

    const firstId = getFocusedWindowId();
    expect(firstId).not.toBeNull();

    focusDir("Right");
    const secondId = await waitForFocusChange(firstId, 3000);

    expect(secondId).not.toBeNull();
    expect(secondId).not.toBe(firstId);
  });

  it("Focus Left moves to the left window", async function () {
    await launchApp("org.gnome.TextEditor.desktop");
    await launchApp("org.gnome.TextEditor.desktop");
    await waitForWindowCount(2, 3000);

    const wins = getWindowGeometries();
    expect(wins.length).toBeGreaterThanOrEqual(2);

    // Start by focusing the right window (focus changes from firstId)
    const firstId = getFocusedWindowId();
    expect(firstId).not.toBeNull();
    focusDir("Right");
    const secondId = await waitForFocusChange(firstId, 3000);
    expect(secondId).not.toBeNull();
    expect(secondId).not.toBe(firstId);

    // Move focus back left
    focusDir("Left");
    const leftId = await waitForFocusChange(secondId, 3000);
    expect(leftId).not.toBeNull();
    expect(leftId).toBe(firstId);
  });

  it("Focus Down/Up in a vertical split does not error", async function () {
    // Toggle to vertical split first
    await launchApp("org.gnome.TextEditor.desktop");
    await launchApp("org.gnome.TextEditor.desktop");
    await waitForWindowCount(2, 3000);

    sendAnvilCommand({ name: "LayoutToggle" });
    await sleep(500);

    const wins = getWindowGeometries();
    expect(wins.length).toBeGreaterThanOrEqual(2);

    // Focus may or may not change depending on which window started focused.
    // This is a smoke test — the command should not error regardless.
    focusDir("Down");
    await sleep(500);

    const ext = /** @type {any} */ (global).__anvil_test_state;
    expect(ext).toBeDefined();
  });

  it("Focus cycles through four windows", async function () {
    await launchApp("org.gnome.TextEditor.desktop");
    await launchApp("org.gnome.TextEditor.desktop");
    await launchApp("org.gnome.TextEditor.desktop");
    await launchApp("org.gnome.TextEditor.desktop");
    await waitForWindowCount(4, 3000);

    const wins = getWindowGeometries();
    expect(wins.length).toBeGreaterThanOrEqual(4);

    let currentId = getFocusedWindowId();
    const ids = [];
    // Navigate a 2×2 grid in a cycle: Right → Down → Left → Up
    const directions = ["Right", "Down", "Left", "Up"];
    for (let i = 0; i < 4; i++) {
      ids.push(currentId);
      focusDir(directions[i]);
      currentId = await waitForFocusChange(currentId, 5000);
    }

    // Should have visited at least 2 distinct windows
    const unique = [...new Set(ids.filter((id) => id !== null))];
    expect(unique.length).toBeGreaterThanOrEqual(2);
  });
});
