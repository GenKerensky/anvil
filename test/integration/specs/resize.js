/**
 * Resize tests — Jasmine port of E2E resize suite.
 *
 * 6 layout scenarios × 3 constraint states × 4 directions = 72 tests
 * (+ 2 baseline tests = 74 total).
 */

import {
  launchApp,
  getWindowGeometries,
  getNodePercents,
  sendAnvilCommand,
  closeAllWindows,
  clearMonitorConstraints,
  clearResizedWindows,
  setMonitorConstraint,
  getAnvilWM,
  getMonitorWorkArea,
  sleep,
  waitForWindowCount,
} from "../../lib/shared-commands.js";

const COMMAND_DELAY = 600;
const RESIZE_AMOUNT = 150;

/**
 * @param {number} [ms]
 */
function settle(ms) {
  return sleep(ms || COMMAND_DELAY);
}

/** @returns {{ x: number, y: number, width: number, height: number } | null} */
function getFocusedRect() {
  const w = global.display.get_focus_window();
  if (!w) return null;
  const r = w.get_frame_rect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}

/** @returns {string | null} */
function getMonitorConnector() {
  const w = global.display.get_focus_window();
  if (!w) return null;
  return getAnvilWM()._getMonitorConnector(w.get_monitor());
}

/**
 * @param {Array<{percent: number}>} beforePct
 * @param {Array<{percent: number}>} afterPct
 * @param {Array<{x: number, y: number, width: number, height: number}>} beforeGeo
 * @param {Array<{x: number, y: number, width: number, height: number}>} afterGeo
 */
function anythingChanged(beforePct, afterPct, beforeGeo, afterGeo) {
  for (let i = 0; i < Math.min(beforePct.length, afterPct.length); i++) {
    if (beforePct[i].percent !== afterPct[i].percent) return true;
  }
  for (let i = 0; i < Math.min(beforeGeo.length, afterGeo.length); i++) {
    const b = beforeGeo[i];
    const a = afterGeo[i];
    if (b.x !== a.x || b.y !== a.y || b.width !== a.width || b.height !== a.height) return true;
  }
  return false;
}

const LAYOUTS = [
  { name: "2-win-horizontal", count: 2, setup: null },
  {
    name: "2-win-vertical",
    count: 2,
    setup: async function () {
      sendAnvilCommand({ name: "LayoutToggle" });
      await settle(300);
    },
  },
  { name: "3-win", count: 3, setup: null },
  { name: "4-win", count: 4, setup: null },
  {
    name: "after-swap",
    count: 3,
    setup: async function () {
      sendAnvilCommand({ name: "Swap", direction: "Left" });
      await settle(300);
    },
  },
  {
    name: "after-toggle",
    count: 3,
    setup: async function () {
      sendAnvilCommand({ name: "LayoutToggle" });
      await settle(300);
    },
  },
];

const DIRECTIONS = ["Right", "Left", "Top", "Bottom"];

const CONSTRAINTS = [
  null,
  { name: "constraints-no-exempt", enabled: true, resizeExempt: false },
  { name: "constraints-with-exempt", enabled: true, resizeExempt: true },
];

/**
 * @param {{name: string, count: number, setup: (() => Promise<void>) | null}} layout
 * @param {{name: string, enabled: boolean, resizeExempt: boolean} | null} constraint
 * @param {string} dir
 */
async function testDirection(layout, constraint, dir) {
  const amount = RESIZE_AMOUNT;
  const isExempt = constraint && constraint.resizeExempt;
  const isHorizDir = dir === "Right" || dir === "Left";

  for (let i = 0; i < layout.count; i++) {
    await launchApp("org.gnome.TextEditor.desktop");
  }
  await waitForWindowCount(layout.count, 5000);

  clearMonitorConstraints();
  await settle(300);

  if (layout.setup) {
    await layout.setup();
    await settle(200);
  }

  const pct0 = getNodePercents();
  const geo0 = getWindowGeometries();
  expect(geo0.length).toBeGreaterThanOrEqual(layout.count);

  let maxW = 0;
  let maxH = 0;
  if (constraint) {
    const area = getMonitorWorkArea();
    maxW = Math.floor(area.width * 0.35);
    maxH = Math.floor(area.height * 0.35);
    const conn = getMonitorConnector();
    if (conn == null) throw new Error("No monitor connector — constraints unavailable");
    setMonitorConstraint(conn, maxW, maxH, constraint.enabled, constraint.resizeExempt);
    await settle(400);
  }

  /**
   * @param {{width: number, height: number}} rect
   * @returns {number}
   */
  function relevantDim(rect) {
    return isHorizDir ? rect.width : rect.height;
  }

  const limit = isHorizDir ? maxW : maxH;

  /**
   * @param {Array<{width: number, height: number}>} geo
   * @returns {boolean}
   */
  function isOrthogonalResize(geo) {
    if (geo.length < 2) return false;
    try {
      const wm = getAnvilWM();
      const focusedWin = global.display.get_focus_window();
      if (focusedWin && wm.tree) {
        const node = wm.tree.findNode(focusedWin);
        if (node && node.parentNode) {
          const parent = node.parentNode;
          if (parent.isHSplit && parent.isHSplit() && !isHorizDir) return true;
          if (parent.isVSplit && parent.isVSplit() && isHorizDir) return true;
        }
      }
    } catch (_e) {
      // Fallback to geometry heuristic
    }

    const heights = geo.map(function (/** @type {{height: number}} */ w) {
      return w.height;
    });
    const allSameHeight = heights.every(function (/** @type {number} */ h) {
      return Math.abs(h - heights[0]) < 10;
    });
    if (allSameHeight && !isHorizDir) return true;

    const widths = geo.map(function (/** @type {{width: number}} */ w) {
      return w.width;
    });
    const allSameWidth = widths.every(function (/** @type {number} */ w) {
      return Math.abs(w - widths[0]) < 10;
    });
    if (allSameWidth && isHorizDir) return true;
    return false;
  }

  async function resize() {
    sendAnvilCommand({ name: "WindowResize" + dir, amount });
    await settle(COMMAND_DELAY);
  }

  if (isExempt) {
    const preFirst = getFocusedRect();
    if (preFirst == null) throw new Error("No focused window before first resize");
    const preDim = relevantDim(preFirst);

    await resize();

    const postFirst = getFocusedRect();
    if (postFirst == null) throw new Error("No window after first resize");
    const postDim = relevantDim(postFirst);

    if (Math.abs(postDim - preDim) > 5) {
      const unclamped = preDim + amount;
      if (unclamped > limit) {
        expect(postDim).toBeLessThanOrEqual(limit + 5);
      }
    }

    await settle(500);

    await resize();

    const postSecond = getFocusedRect();
    if (postSecond == null) throw new Error("No window after second resize");
    const secondDim = relevantDim(postSecond);

    if (Math.abs(secondDim - postDim) > 5) {
      expect(secondDim).toBeGreaterThan(limit);
    }

    const pct1 = getNodePercents();
    const geo1 = getWindowGeometries();
    expect(anythingChanged(pct0, pct1, geo0, geo1)).toBe(true);
    return;
  }

  const preRect = getFocusedRect();
  if (preRect == null) throw new Error("No focused window before resize");
  const preDim = relevantDim(preRect);

  await resize();

  const posRect = getFocusedRect();
  if (posRect == null) throw new Error("No window after resize");
  const posDim = relevantDim(posRect);

  const pct1 = getNodePercents();
  const geo1 = getWindowGeometries();
  if (!isOrthogonalResize(geo0)) {
    expect(anythingChanged(pct0, pct1, geo0, geo1)).toBe(true);
  }

  if (constraint && !constraint.resizeExempt) {
    if (Math.abs(posDim - preDim) > 5) {
      const unclamped = preDim + amount;
      if (unclamped > limit) {
        expect(posDim).toBeLessThanOrEqual(limit + 5);
      }
    }
  }
}

describe("Resize", function () {
  beforeEach(async function () {
    clearMonitorConstraints();
    clearResizedWindows();
    await closeAllWindows();
    await settle(500);
  });

  afterEach(async function () {
    clearMonitorConstraints();
    clearResizedWindows();
    await closeAllWindows();
  });

  it("keyboard resize right changes percent", async function () {
    await launchApp("org.gnome.TextEditor.desktop");
    await launchApp("org.gnome.TextEditor.desktop");
    await waitForWindowCount(2, 5000);

    const before = getNodePercents();
    expect(before.length).toBeGreaterThanOrEqual(2);
    expect(before[0].percent).toBe(before[1].percent);

    sendAnvilCommand({ name: "WindowResizeRight", amount: 150 });
    await settle(COMMAND_DELAY);

    const after = getNodePercents();
    expect(after.length).toBeGreaterThanOrEqual(2);
    const changed =
      after[0].percent !== before[0].percent || after[1].percent !== before[1].percent;
    expect(changed).toBe(true);
  });

  it("keyboard resize right produces visible geometry change", async function () {
    await launchApp("org.gnome.TextEditor.desktop");
    await launchApp("org.gnome.TextEditor.desktop");
    await waitForWindowCount(2, 5000);

    const before = getWindowGeometries();
    expect(before.length).toBeGreaterThanOrEqual(2);

    sendAnvilCommand({ name: "WindowResizeRight", amount: 150 });
    await settle(COMMAND_DELAY);

    const after = getWindowGeometries();
    expect(after.length).toBeGreaterThanOrEqual(2);

    let geometryChanged = false;
    if (before[0] && after[0] && before[0].width !== after[0].width) geometryChanged = true;
    if (before[1] && after[1] && before[1].width !== after[1].width) geometryChanged = true;

    expect(geometryChanged).toBe(true);
  });

  for (const layout of LAYOUTS) {
    for (const constraint of CONSTRAINTS) {
      for (const dir of DIRECTIONS) {
        const label =
          layout.name +
          " - " +
          (constraint ? constraint.name : "no-constraints") +
          " - resize-" +
          dir.toLowerCase();

        it(label, async function () {
          await testDirection(layout, constraint, dir);
        });
      }
    }
  }
});
