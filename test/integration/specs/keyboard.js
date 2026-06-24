/**
 * Keyboard shortcut tests — Jasmine port of E2E keyboard suite.
 */

import {
  launchApp,
  getWindowGeometries,
  sendKeyCombo,
  closeAllWindows,
  sleep,
  waitForWindowCount,
  waitForFocusChange,
  getFocusedWindowId,
} from "../../lib/shared-commands.js";

describe("Keyboard Shortcuts", function () {
  beforeEach(async function () {
    await closeAllWindows();
    await sleep(200);
  });

  afterEach(async function () {
    await closeAllWindows();
  });

  it("Super+H changes split orientation", async function () {
    await launchApp("org.gnome.TextEditor.desktop");
    await launchApp("org.gnome.TextEditor.desktop");
    await waitForWindowCount(2, 5000);

    const before = getWindowGeometries();
    const a = before[0];
    const b = before[1];

    // Initially side-by-side (horizontal split) → same y, different x
    expect(Math.abs(a.y - b.y) / Math.abs(a.y || 1)).toBeLessThan(0.05);
    expect(a.x).not.toBe(b.x);

    sendKeyCombo("Super+H");
    await waitForWindowCount(2, 5000);

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
    await waitForWindowCount(2, 5000);

    const wins = getWindowGeometries();
    expect(wins.length).toBeGreaterThanOrEqual(2);

    const prevFocusId = getFocusedWindowId();
    sendKeyCombo("Super+J");
    await waitForFocusChange(prevFocusId, 5000);
  });

  it("Super+C toggles float on focused window", async function () {
    await launchApp("org.gnome.TextEditor.desktop");
    await launchApp("org.gnome.TextEditor.desktop");
    await waitForWindowCount(2, 5000);

    const before = getWindowGeometries();
    expect(before.length).toBeGreaterThanOrEqual(1);

    sendKeyCombo("Super+C");
    await waitForWindowCount(2, 5000);

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
