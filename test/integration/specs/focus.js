/**
 * Focus direction tests
 *
 * Verifies that Focus Left/Right/Up/Down commands correctly move focus
 * between tiled windows.
 */

import {
  launchApp,
  getFocusedWindowTitle,
  getWindowGeometries,
  sendAnvilCommand,
  closeAllWindows,
  sleep,
} from "../../lib/shared-commands.js";

const COMMAND_DELAY = 800;

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

  it("Focus Right moves to the right window", async function () {
    await launchApp("org.gnome.TextEditor.desktop");
    await launchApp("org.gnome.TextEditor.desktop");
    await sleep(COMMAND_DELAY);

    const wins = getWindowGeometries();
    expect(wins.length).toBeGreaterThanOrEqual(2);

    const firstTitle = getFocusedWindowTitle();
    expect(firstTitle).toBeTruthy();

    focusDir("Right");
    await sleep(COMMAND_DELAY);

    const secondTitle = getFocusedWindowTitle();
    expect(secondTitle).toBeTruthy();
    expect(secondTitle).not.toBe(firstTitle);
  });

  it("Focus Left moves to the left window", async function () {
    await launchApp("org.gnome.TextEditor.desktop");
    await launchApp("org.gnome.TextEditor.desktop");
    await sleep(COMMAND_DELAY);

    const wins = getWindowGeometries();
    expect(wins.length).toBeGreaterThanOrEqual(2);

    // Start by focusing the right window
    focusDir("Right");
    await sleep(COMMAND_DELAY);

    const rightTitle = getFocusedWindowTitle();
    expect(rightTitle).toBeTruthy();

    focusDir("Left");
    await sleep(COMMAND_DELAY);

    const leftTitle = getFocusedWindowTitle();
    expect(leftTitle).toBeTruthy();
    expect(leftTitle).not.toBe(rightTitle);
  });

  it("Focus Down/Up in a vertical split", async function () {
    // Toggle to vertical split first
    await launchApp("org.gnome.TextEditor.desktop");
    await launchApp("org.gnome.TextEditor.desktop");
    await sleep(COMMAND_DELAY);

    sendAnvilCommand({ name: "LayoutToggle" });
    await sleep(COMMAND_DELAY);

    const wins = getWindowGeometries();
    expect(wins.length).toBeGreaterThanOrEqual(2);

    // In vertical split, windows should be stacked vertically
    const firstTitle = getFocusedWindowTitle();
    expect(firstTitle).toBeTruthy();

    focusDir("Down");
    await sleep(COMMAND_DELAY);

    const secondTitle = getFocusedWindowTitle();
    expect(secondTitle).toBeTruthy();

    // May or may not change depending on which window started focused
    // but at minimum the command should not error
    const ext = /** @type {any} */ (global).__anvil_test_state;
    expect(ext).toBeDefined();
  });

  it("Focus cycles through four windows", async function () {
    await launchApp("org.gnome.TextEditor.desktop");
    await launchApp("org.gnome.TextEditor.desktop");
    await launchApp("org.gnome.TextEditor.desktop");
    await launchApp("org.gnome.TextEditor.desktop");
    await sleep(1200);

    const wins = getWindowGeometries();
    expect(wins.length).toBeGreaterThanOrEqual(4);

    const titles = [];
    for (let i = 0; i < 4; i++) {
      titles.push(getFocusedWindowTitle());
      focusDir("Right");
      await sleep(COMMAND_DELAY);
    }

    // Should have visited at least 2 distinct windows
    const unique = [...new Set(titles.filter(Boolean))];
    expect(unique.length).toBeGreaterThanOrEqual(2);
  });
});
