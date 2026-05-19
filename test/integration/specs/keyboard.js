/**
 * Keyboard shortcut tests — Jasmine port of E2E keyboard suite.
 */

import {
  launchApp,
  getWindowGeometries,
  getFocusedWindowTitle,
  sendKeyCombo,
  closeAllWindows,
  sleep,
} from "../../lib/shared-commands.js";

const COMMAND_DELAY = 800;

describe("Keyboard Shortcuts", function () {
  beforeEach(async function () {
    await closeAllWindows();
    await sleep(500);
  });

  afterEach(async function () {
    await closeAllWindows();
  });

  it("Super+H changes split orientation", async function () {
    await launchApp("org.gnome.TextEditor.desktop");
    await launchApp("org.gnome.TextEditor.desktop");
    await sleep(COMMAND_DELAY);

    const before = getWindowGeometries();
    expect(before.length).toBeGreaterThanOrEqual(2);
    const a = before[0];
    const b = before[1];

    // Initially side-by-side (horizontal split) → same y, different x
    expect(Math.abs(a.y - b.y) / Math.abs(a.y || 1)).toBeLessThan(0.05);
    expect(a.x).not.toBe(b.x);

    sendKeyCombo("Super+H");
    await sleep(COMMAND_DELAY);

    const after = getWindowGeometries();
    expect(after.length).toBeGreaterThanOrEqual(2);
    const a2 = after[0];
    const b2 = after[1];

    // After toggle: stacked (vertical split) → same x, different y
    expect(Math.abs(a2.x - b2.x) / Math.abs(a2.x || 1)).toBeLessThan(0.05);
    expect(a2.y).not.toBe(b2.y);
  });

  it("Super+J moves focus to next window", async function () {
    await launchApp("org.gnome.TextEditor.desktop");
    await launchApp("org.gnome.TextEditor.desktop");
    await sleep(COMMAND_DELAY);

    const wins = getWindowGeometries();
    expect(wins.length).toBeGreaterThanOrEqual(2);

    sendKeyCombo("Super+J");
    await sleep(COMMAND_DELAY);

    const title = getFocusedWindowTitle();
    expect(title).toBe(wins[1].title);
  });

  it("Super+C toggles float on focused window", async function () {
    await launchApp("org.gnome.TextEditor.desktop");
    await launchApp("org.gnome.TextEditor.desktop");
    await sleep(COMMAND_DELAY);

    const before = getWindowGeometries();
    expect(before.length).toBeGreaterThanOrEqual(1);

    sendKeyCombo("Super+C");
    await sleep(COMMAND_DELAY);

    const after = getWindowGeometries();
    expect(after.length).toBeGreaterThanOrEqual(1);

    let changed = false;
    for (let i = 0; i < Math.min(before.length, after.length); i++) {
      if (
        before[i].x !== after[i].x ||
        before[i].y !== after[i].y ||
        before[i].width !== after[i].width ||
        before[i].height !== after[i].height
      ) {
        changed = true;
        break;
      }
    }
    expect(changed).toBe(true);
  });
});
