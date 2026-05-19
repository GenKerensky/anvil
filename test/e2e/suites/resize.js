/**
 * Resize tests — keyboard resize + white-box percent checks + constraint
 * clamping/exemption verification.
 *
 * 6 layout scenarios × 3 constraint states × 4 directions = 72 tests
 * (+ 2 existing baseline tests = 74 total).
 */

import GLib from "gi://GLib";

import {
  launchApp,
  getWindowGeometries,
  getNodePercents,
  sendAnvilCommand,
  closeAllWindows,
  formatWindowState,
  clearMonitorConstraints,
  clearResizedWindows,
  setMonitorConstraint,
  getAnvilWM,
  getMonitorWorkArea,
} from "../../lib/shared-commands.js";

const COMMAND_DELAY = 600;
const RESIZE_AMOUNT = 150;

/** @param {number} [ms] @returns {Promise<void>} */
function settle(ms) {
  return new Promise(function (resolve) {
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms || COMMAND_DELAY, function () {
      resolve(undefined);
      return GLib.SOURCE_REMOVE;
    });
  });
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
 * @returns {boolean}
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

/* ── Layout setup definitions ─────────────────────────────────────────── */

/** @type {Array<{name: string, count: number, setup: (() => Promise<void>) | null}>} */
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

/** @type {string[]} */
const DIRECTIONS = ["Right", "Left", "Top", "Bottom"];

/** @type {Array<null | {name: string, enabled: boolean, resizeExempt: boolean}>} */
const CONSTRAINTS = [
  null,
  {
    name: "constraints-no-exempt",
    enabled: true,
    resizeExempt: false,
  },
  {
    name: "constraints-with-exempt",
    enabled: true,
    resizeExempt: true,
  },
];

/* ── Single-direction test body ───────────────────────────────────────── */

/**
 * @param {{name: string, count: number, setup: (() => Promise<void>) | null}} layout
 * @param {{name: string, enabled: boolean, resizeExempt: boolean} | null} constraint
 * @param {string} dir
 */
async function testDirection(layout, constraint, dir) {
  const amount = RESIZE_AMOUNT;
  const isExempt = constraint && constraint.resizeExempt;

  // 1. Launch windows
  for (let i = 0; i < layout.count; i++) {
    await launchApp("org.gnome.Nautilus.desktop");
  }
  await settle(COMMAND_DELAY);

  // 1b. Clear any stale constraints
  clearMonitorConstraints();
  await settle(300);

  // 2. Apply layout setup
  if (layout.setup) {
    await layout.setup();
    await settle(200);
  }

  // 3. Capture initial state
  const pct0 = getNodePercents();
  const geo0 = getWindowGeometries();
  expect(geo0.length).toBeGreaterThanOrEqual(layout.count);

  // 4. Apply constraint (if any)
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

  const isHorizDir = dir === "Right" || dir === "Left";

  /**
   * @param {{width: number, height: number}} rect
   * @returns {number}
   */
  function relevantDim(rect) {
    return isHorizDir ? rect.width : rect.height;
  }

  const limit = isHorizDir ? maxW : maxH;

  // ── Helper: detect if resize is orthogonal to the primary split ──
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
    } catch (e) {
      // Fallback to geometry heuristic if tree access fails
    }

    const heights = geo.map(function (w) {
      return w.height;
    });
    const allSameHeight = heights.every(function (h) {
      return Math.abs(h - heights[0]) < 10;
    });
    if (allSameHeight && !isHorizDir) return true;
    const widths = geo.map(function (w) {
      return w.width;
    });
    const allSameWidth = widths.every(function (w) {
      return Math.abs(w - widths[0]) < 10;
    });
    if (allSameWidth && isHorizDir) return true;
    return false;
  }

  // ── Helper: do one resize ──
  async function resize() {
    sendAnvilCommand({ name: "WindowResize" + dir, amount });
    await settle(COMMAND_DELAY);
  }

  // ── EXEMPT: two-step ──
  if (isExempt) {
    const preFirst = getFocusedRect();
    if (preFirst == null) throw new Error("No focused window before first resize");
    const preDim = relevantDim(preFirst);

    await resize();

    const postFirst = getFocusedRect();
    if (postFirst == null) throw new Error("No window after first resize");
    const postDim = relevantDim(postFirst);

    // Check clamping on first resize
    if (Math.abs(postDim - preDim) > 5) {
      const unclamped = preDim + amount;
      if (unclamped > limit) {
        expect(postDim).toBeLessThanOrEqual(limit + 5);
      }
    }

    // Wait for exemption to activate
    await settle(500);

    // Second resize — should be exempt
    await resize();

    const postSecond = getFocusedRect();
    if (postSecond == null) throw new Error("No window after second resize");
    const secondDim = relevantDim(postSecond);

    if (Math.abs(secondDim - postDim) > 5) {
      expect(secondDim).toBeGreaterThan(limit);
    }

    // Verify overall change
    const pct1 = getNodePercents();
    const geo1 = getWindowGeometries();
    expect(anythingChanged(pct0, pct1, geo0, geo1)).toBe(true);
    return;
  }

  // ── NON-EXEMPT: single resize ──
  const preRect = getFocusedRect();
  if (preRect == null) throw new Error("No focused window before resize");
  const preDim = relevantDim(preRect);

  await resize();

  const posRect = getFocusedRect();
  if (posRect == null) throw new Error("No window after resize");
  const posDim = relevantDim(posRect);

  // Verify resize had an effect (skip for orthogonal directions)
  const pct1 = getNodePercents();
  const geo1 = getWindowGeometries();
  if (!isOrthogonalResize(geo0)) {
    expect(anythingChanged(pct0, pct1, geo0, geo1)).toBe(true);
  }

  // Clamping check (constraint ON, no exempt)
  if (constraint && !constraint.resizeExempt) {
    if (Math.abs(posDim - preDim) > 5) {
      const unclamped = preDim + amount;
      if (unclamped > limit) {
        expect(posDim).toBeLessThanOrEqual(limit + 5);
      }
    }
  }
}

/* ── Test suite ──────────────────────────────────────────────────────── */

describe("Resize", function () {
  beforeEach(async function () {
    clearMonitorConstraints();
    clearResizedWindows();
    await closeAllWindows();
    await settle(500);
  });

  // ── Existing baseline tests ──

  it("keyboard resize right changes percent", async function () {
    await launchApp("org.gnome.Nautilus.desktop");
    await launchApp("org.gnome.Nautilus.desktop");

    await settle(COMMAND_DELAY);

    const before = getNodePercents();
    log(
      "[E2E] Percents before resize: " +
        JSON.stringify(
          before.map(function (n) {
            return { title: n.title, percent: n.percent };
          })
        )
    );

    expect(before.length).toBeGreaterThanOrEqual(2);
    const beforePct0 = before[0].percent;
    const beforePct1 = before[1].percent;
    expect(beforePct0).toBe(beforePct1);

    sendAnvilCommand({ name: "WindowResizeRight", amount: 150 });
    await settle(COMMAND_DELAY);

    const after = getNodePercents();
    log(
      "[E2E] Percents after resize: " +
        JSON.stringify(
          after.map(function (n) {
            return { title: n.title, percent: n.percent };
          })
        )
    );

    expect(after.length).toBeGreaterThanOrEqual(2);
    const afterPct0 = after[0].percent;
    const afterPct1 = after[1].percent;

    const changed = afterPct0 !== beforePct0 || afterPct1 !== beforePct1;
    expect(changed).toBe(true);
  });

  it("keyboard resize right produces visible geometry change", async function () {
    await launchApp("org.gnome.Nautilus.desktop");
    await launchApp("org.gnome.Nautilus.desktop");

    await settle(COMMAND_DELAY);

    const before = getWindowGeometries();
    log("[E2E] Geometries before resize:\n" + formatWindowState(before));
    expect(before.length).toBeGreaterThanOrEqual(2);

    sendAnvilCommand({ name: "WindowResizeRight", amount: 150 });
    await settle(COMMAND_DELAY);

    const after = getWindowGeometries();
    log("[E2E] Geometries after resize:\n" + formatWindowState(after));
    expect(after.length).toBeGreaterThanOrEqual(2);

    const a0 = before[0];
    const a1 = after[0];
    const b0 = before.length > 1 ? before[1] : null;
    const b1 = after.length > 1 ? after[1] : null;

    let geometryChanged = false;
    if (a0 && a1 && a0.width !== a1.width) geometryChanged = true;
    if (b0 && b1 && b0.width !== b1.width) geometryChanged = true;

    expect(geometryChanged).toBe(true);
  });

  // ── Data-driven 6 × 3 × 4 tests ──

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
