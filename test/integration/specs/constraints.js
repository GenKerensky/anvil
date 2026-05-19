/**
 * Monitor constraint tests — only possible in container where GSettings writes
 * are safe (container-local dconf, not host).
 */

import {
  launchApp,
  getWindowGeometries,
  getMonitorWorkArea,
  sendAnvilCommand,
  closeAllWindows,
  sleep,
  clearMonitorConstraints,
  setMonitorConstraint,
  getAnvilWM,
} from "../../lib/shared-commands.js";

const COMMAND_DELAY = 600;
const RESIZE_AMOUNT = 150;

describe("Monitor Constraints", function () {
  beforeEach(async function () {
    clearMonitorConstraints();
    await closeAllWindows();
    await sleep(500);
  });

  afterEach(async function () {
    clearMonitorConstraints();
    await closeAllWindows();
  });

  it("setting a constraint limits window width on resize", async function () {
    await launchApp("org.gnome.TextEditor.desktop");
    await launchApp("org.gnome.TextEditor.desktop");
    await sleep(COMMAND_DELAY);

    const area = getMonitorWorkArea();
    const maxW = Math.floor(area.width * 0.35);

    const wm = getAnvilWM();
    const connector = wm._getMonitorConnector(0);
    setMonitorConstraint(connector, maxW, Math.floor(area.height * 0.35), true, false);
    await sleep(400);

    const before = getWindowGeometries();
    expect(before.length).toBeGreaterThanOrEqual(2);
    const focused = before[0];

    sendAnvilCommand({ name: "WindowResizeRight", amount: RESIZE_AMOUNT });
    await sleep(COMMAND_DELAY);

    const after = getWindowGeometries();
    expect(after.length).toBeGreaterThanOrEqual(2);

    // The focused window should not exceed the constraint limit
    const resized = after[0];
    expect(resized.width).toBeLessThanOrEqual(maxW + 5);
  });

  it("resize-exempt windows bypass the constraint after enough resize events", async function () {
    await launchApp("org.gnome.TextEditor.desktop");
    await launchApp("org.gnome.TextEditor.desktop");
    await sleep(COMMAND_DELAY);

    const area = getMonitorWorkArea();
    const maxW = Math.floor(area.width * 0.35);

    const wm = getAnvilWM();
    const connector = wm._getMonitorConnector(0);
    setMonitorConstraint(connector, maxW, Math.floor(area.height * 0.35), true, true);
    await sleep(400);

    // First resize — should be clamped
    sendAnvilCommand({ name: "WindowResizeRight", amount: RESIZE_AMOUNT });
    await sleep(COMMAND_DELAY);

    const afterFirst = getWindowGeometries();
    expect(afterFirst[0].width).toBeLessThanOrEqual(maxW + 5);

    // Wait for exemption counter to increment
    await sleep(500);

    // Second resize — should be exempt
    sendAnvilCommand({ name: "WindowResizeRight", amount: RESIZE_AMOUNT });
    await sleep(COMMAND_DELAY);

    const afterSecond = getWindowGeometries();
    // After exemption, the window should exceed the limit
    expect(afterSecond[0].width).toBeGreaterThan(maxW);
  });

  it("removing constraints reverts to normal behaviour", async function () {
    await launchApp("org.gnome.TextEditor.desktop");
    await launchApp("org.gnome.TextEditor.desktop");
    await sleep(COMMAND_DELAY);

    const area = getMonitorWorkArea();
    const maxW = Math.floor(area.width * 0.35);

    const wm = getAnvilWM();
    const connector = wm._getMonitorConnector(0);

    // Set constraint
    setMonitorConstraint(connector, maxW, Math.floor(area.height * 0.35), true, false);
    await sleep(400);

    // Resize with constraint
    sendAnvilCommand({ name: "WindowResizeRight", amount: RESIZE_AMOUNT });
    await sleep(COMMAND_DELAY);

    const withConstraint = getWindowGeometries();
    expect(withConstraint[0].width).toBeLessThanOrEqual(maxW + 5);

    // Remove constraint
    clearMonitorConstraints();
    await sleep(400);

    // Resize again — should NOT be clamped
    sendAnvilCommand({ name: "WindowResizeRight", amount: RESIZE_AMOUNT });
    await sleep(COMMAND_DELAY);

    const withoutConstraint = getWindowGeometries();
    // After removing constraint, the window should be able to grow larger
    expect(withoutConstraint[0].width).toBeGreaterThan(maxW);
  });

  it("zero constraint is equivalent to no constraint", async function () {
    await launchApp("org.gnome.TextEditor.desktop");
    await launchApp("org.gnome.TextEditor.desktop");
    await sleep(COMMAND_DELAY);

    const wm = getAnvilWM();
    const connector = wm._getMonitorConnector(0);

    // Set zero constraint
    setMonitorConstraint(connector, 0, 0, true, false);
    await sleep(400);

    const before = getWindowGeometries();
    expect(before.length).toBeGreaterThanOrEqual(2);

    sendAnvilCommand({ name: "WindowResizeRight", amount: RESIZE_AMOUNT });
    await sleep(COMMAND_DELAY);

    const after = getWindowGeometries();
    expect(after.length).toBeGreaterThanOrEqual(2);

    // With zero constraint, resize should still have an effect (not clamped to 0)
    expect(after[0].width).not.toBe(before[0].width);
  });
});
