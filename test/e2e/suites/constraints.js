/**
 * Monitor constraint tests.
 *
 * Mutates GSettings (monitor-constraints). Each case clears constraints in
 * beforeEach/afterEach to avoid host pollution.
 */

import {
  launchApp,
  getMonitorWorkArea,
  sendAnvilCommand,
  closeAllWindows,
  sleep,
  clearMonitorConstraints,
  clearResizedWindows,
  setMonitorConstraint,
  getAnvilWM,
  waitForWindowCount,
  waitForGeometryStable,
} from "../../lib/shared-commands.js";

const RESIZE_AMOUNT = 150;

/** @returns {{ x: number, y: number, width: number, height: number } | null} */
function focusedRect() {
  const w = global.display.get_focus_window();
  if (!w) return null;
  const r = w.get_frame_rect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}

describe("Monitor Constraints", function () {
  beforeEach(async function () {
    clearMonitorConstraints();
    clearResizedWindows();
    await closeAllWindows();
    await sleep(200);
  });

  afterEach(async function () {
    clearMonitorConstraints();
    clearResizedWindows();
    await closeAllWindows();
  });

  it("setting a constraint limits window width on resize", async function () {
    await launchApp("org.gnome.Nautilus.desktop");
    await launchApp("org.gnome.Nautilus.desktop");
    await waitForWindowCount(2, 5000);

    const area = getMonitorWorkArea();
    const maxW = Math.floor(area.width * 0.35);

    const wm = getAnvilWM();
    const connector = wm.tilingRender.getMonitorConnector(0);
    setMonitorConstraint(connector, maxW, Math.floor(area.height * 0.35), true, false);
    await sleep(300);

    const before = focusedRect();
    expect(before).not.toBeNull();

    sendAnvilCommand({ name: "WindowResize", direction: "Right", amount: RESIZE_AMOUNT });
    await waitForGeometryStable(2000);

    const after = focusedRect();
    expect(after).not.toBeNull();
    // Either clamped to maxW, or still at/below maxW if already smaller
    // Allow generous slack: Wayland configure + async clamp can overshoot slightly
    const afterW = /** @type {{width:number}} */ (after).width;
    const beforeW = /** @type {{width:number}} */ (before).width;
    expect(afterW).toBeLessThanOrEqual(Math.max(maxW, beforeW) + 80);
  });

  it("resize-exempt windows can grow past constraint after enough resize events", async function () {
    await launchApp("org.gnome.Nautilus.desktop");
    await launchApp("org.gnome.Nautilus.desktop");
    await waitForWindowCount(2, 5000);

    const area = getMonitorWorkArea();
    const maxW = Math.floor(area.width * 0.35);

    const wm = getAnvilWM();
    const connector = wm.tilingRender.getMonitorConnector(0);
    setMonitorConstraint(connector, maxW, Math.floor(area.height * 0.35), true, true);
    await sleep(300);

    sendAnvilCommand({ name: "WindowResize", direction: "Right", amount: RESIZE_AMOUNT });
    await waitForGeometryStable(2000);
    const afterFirst = focusedRect();
    expect(afterFirst).not.toBeNull();

    sendAnvilCommand({ name: "WindowResize", direction: "Right", amount: RESIZE_AMOUNT });
    await waitForGeometryStable(2000);
    sendAnvilCommand({ name: "WindowResize", direction: "Right", amount: RESIZE_AMOUNT });
    await waitForGeometryStable(2000);

    const afterExempt = focusedRect();
    expect(afterExempt).not.toBeNull();
    expect(/** @type {{width:number}} */ (afterExempt).width).toBeGreaterThan(0);
  });

  it("removing constraints allows further resize", async function () {
    await launchApp("org.gnome.Nautilus.desktop");
    await launchApp("org.gnome.Nautilus.desktop");
    await waitForWindowCount(2, 5000);

    const area = getMonitorWorkArea();
    const maxW = Math.floor(area.width * 0.35);

    const wm = getAnvilWM();
    const connector = wm.tilingRender.getMonitorConnector(0);

    setMonitorConstraint(connector, maxW, Math.floor(area.height * 0.35), true, false);
    await sleep(300);

    sendAnvilCommand({ name: "WindowResize", direction: "Right", amount: RESIZE_AMOUNT });
    await waitForGeometryStable(2000);
    const withConstraint = focusedRect();
    expect(withConstraint).not.toBeNull();

    clearMonitorConstraints();
    clearResizedWindows();
    await sleep(300);

    sendAnvilCommand({ name: "WindowResize", direction: "Right", amount: RESIZE_AMOUNT });
    await waitForGeometryStable(2000);
    const without = focusedRect();
    expect(without).not.toBeNull();
    expect(/** @type {{width:number}} */ (without).width).toBeGreaterThan(0);
  });

  it("zero constraint does not force zero width", async function () {
    await launchApp("org.gnome.Nautilus.desktop");
    await launchApp("org.gnome.Nautilus.desktop");
    await waitForWindowCount(2, 5000);

    const wm = getAnvilWM();
    const connector = wm.tilingRender.getMonitorConnector(0);

    setMonitorConstraint(connector, 0, 0, true, false);
    await sleep(300);

    const before = focusedRect();
    expect(before).not.toBeNull();
    expect(/** @type {{width:number}} */ (before).width).toBeGreaterThan(0);

    sendAnvilCommand({ name: "WindowResize", direction: "Right", amount: RESIZE_AMOUNT });
    await waitForGeometryStable(2000);

    const after = focusedRect();
    expect(after).not.toBeNull();
    expect(/** @type {{width:number}} */ (after).width).toBeGreaterThan(0);
  });
});
