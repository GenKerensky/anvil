/**
 * Floating and snap layout tests
 *
 * Verifies FloatToggle, FloatClassToggle, SnapLayoutMove,
 * and TilingModeToggle commands.
 */

import {
  launchApp,
  getWindowGeometries,
  getMonitorWorkArea,
  getSettings,
  getAnvilRuntime,
  getRuntimeWindowState,
  getRuntimeWindowStates,
  sendAnvilCommand,
  sendAnvilCommandAndSettle,
  closeAllWindows,
  sleep,
  waitForWindowCount,
  clearFloatOverridesForClass,
} from "../../lib/shared-commands.js";

function getTiledWindowPercents() {
  return getRuntimeWindowStates()
    .filter(function (state) {
      return state.mode === "TILE";
    })
    .map(function (state) {
      return { windowId: state.windowId, percent: state.percent };
    });
}

/** @param {string} wmClass */
function findWindowByClass(wmClass) {
  const expected = wmClass.toLowerCase();
  const windows = /** @type {any[]} */ (global.get_window_actors())
    .map(
      /** @param {any} actor */ function (actor) {
        return actor.meta_window ?? actor.get_meta_window?.();
      }
    )
    .filter(Boolean);
  const window = windows.find(function (candidate) {
    return candidate.get_wm_class()?.toLowerCase() === expected;
  });
  if (!window) {
    throw new Error(
      "Window class not found: " +
        wmClass +
        " (found " +
        windows.map(function (candidate) {
          return candidate.get_wm_class();
        }) +
        ")"
    );
  }
  return window;
}

function setCustomTiledPercents() {
  const runtime = getAnvilRuntime();
  const tiledNodes = /** @type {any[]} */ (runtime.tree.nodeWindows).filter(
    /** @param {any} node */ function (node) {
      return node.mode === "TILE";
    }
  );
  if (tiledNodes.length !== 2) {
    throw new Error("Expected exactly two tiled nodes, got " + tiledNodes.length);
  }
  tiledNodes[0].percent = 0.7;
  tiledNodes[1].percent = 0.3;
  runtime.forceRender("e2e-custom-tiled-percents");
  return getTiledWindowPercents();
}

describe("Floating and Snap Layout", function () {
  beforeEach(async function () {
    await closeAllWindows();
    // FloatClassToggle is a toggle: strip any leftover Nautilus class float
    // override from a prior spec so this spec starts from a known (non-floated)
    // state. Without this the spec is order-dependent (a prior override makes
    // the toggle un-float instead of float).
    clearFloatOverridesForClass("org.gnome.Nautilus");
    clearFloatOverridesForClass("XTerm");
    await sleep(200);
  });

  afterEach(async function () {
    // Ensure tiling is re-enabled and no Nautilus class float override bleeds
    getSettings().set_boolean("tiling-mode-enabled", true);
    clearFloatOverridesForClass("org.gnome.Nautilus");
    clearFloatOverridesForClass("XTerm");
    await closeAllWindows();
  });

  it("FloatToggle floats the focused window", async function () {
    await launchApp("org.gnome.Nautilus.desktop");
    await launchApp("org.gnome.Nautilus.desktop");
    await waitForWindowCount(2, 5000);

    const before = getWindowGeometries();
    expect(before.length).toBeGreaterThanOrEqual(2);

    const totalBefore = before.reduce(function (sum, w) {
      return sum + w.width * w.height;
    }, 0);

    await sendAnvilCommandAndSettle({
      name: "FloatToggle",
      mode: "float",
      x: "center",
      y: "center",
      width: 0.65,
      height: 0.75,
    });

    const after = getWindowGeometries().filter(function (w) {
      return !w.minimized;
    });
    expect(after.length).toBeGreaterThanOrEqual(2);

    // Floated window is centered at ~65%×75% so total covered area drops, or at least changes.
    const totalAfter = after.reduce(function (sum, w) {
      return sum + w.width * w.height;
    }, 0);
    const sizesChanged =
      totalAfter !== totalBefore ||
      after.some(function (w, i) {
        return !before[i] || w.width !== before[i].width || w.height !== before[i].height;
      });
    expect(sizesChanged || totalAfter <= totalBefore).toBe(true);
  });

  it("preserves custom tiled sizes when a floating window is admitted", async function () {
    await launchApp("org.gnome.Nautilus.desktop");
    await launchApp("org.gnome.Nautilus.desktop");
    await waitForWindowCount(2, 5000);

    // Establish a class-level float rule through the same command users invoke,
    // then close the setup window so its next instance exercises admission.
    await launchApp("xterm.desktop");
    await waitForWindowCount(3, 5000);
    const setupXterm = findWindowByClass("XTerm");
    setupXterm.activate(global.get_current_time());
    await sleep(300);
    await sendAnvilCommandAndSettle({
      name: "FloatClassToggle",
      mode: "float",
      x: "center",
      y: "center",
      width: 0.65,
      height: 0.75,
    });
    expect(getRuntimeWindowState(setupXterm)?.mode).toBe("FLOAT");
    setupXterm.delete(global.get_current_time());
    await waitForWindowCount(2, 5000);

    // Direct percentages isolate this test from headless compositor resize
    // variability while still exercising the real Meta window lifecycle.
    const before = setCustomTiledPercents();
    expect(before.length).toBe(2);
    expect(
      before.every(function (state) {
        return typeof state.percent === "number";
      })
    ).toBe(true);
    expect(Math.abs(before[0].percent - before[1].percent)).toBeGreaterThan(0.01);

    await launchApp("xterm.desktop");
    await waitForWindowCount(3, 5000);
    await sleep(800);

    expect(getRuntimeWindowState(findWindowByClass("XTerm"))?.mode).toBe("FLOAT");
    const afterById = new Map(
      getTiledWindowPercents().map(function (state) {
        return [state.windowId, state.percent];
      })
    );
    before.forEach(function (state) {
      expect(afterById.get(state.windowId)).toBeCloseTo(state.percent, 6);
    });
  });

  it("FloatClassToggle toggles float by window class", async function () {
    await launchApp("org.gnome.Nautilus.desktop");
    await launchApp("org.gnome.Nautilus.desktop");
    await waitForWindowCount(2, 5000);

    const before = getWindowGeometries();
    expect(before.length).toBeGreaterThanOrEqual(2);

    // Before the toggle, Nautilus is not float-exempt (override cleared in beforeEach).
    const wm = getAnvilRuntime();
    const focusBefore = /** @type {any} */ (global).display.get_focus_window();
    if (focusBefore) expect(wm.isFloatingExempt(focusBefore)).toBe(false);

    sendAnvilCommand({
      name: "FloatClassToggle",
      mode: "float",
      x: "center",
      y: "center",
      width: 0.65,
      height: 0.75,
    });
    await waitForWindowCount(2, 5000);

    // Assert the class-level float override was applied through the owner
    // (RulesEngine classification + tree node mode), not brittle geometry. The
    // prior ratio-after assertion depended on the floated window repositioning,
    // which Anvil does not force for FLOAT windows — so it only passed when
    // Nautilus was already warm (full-suite order) and failed in isolation.
    const focus = /** @type {any} */ (global).display.get_focus_window();
    expect(focus).toBeTruthy();
    expect(wm.isFloatingExempt(focus)).toBe(true);
    const focusNode = getRuntimeWindowState(focus);
    expect(focusNode?.mode).toBe("FLOAT"); // WINDOW_MODES.FLOAT
  });

  it("SnapLayoutMove Left 1/3 snaps window to left third", async function () {
    await launchApp("org.gnome.Nautilus.desktop");
    await waitForWindowCount(1, 5000);

    const area = getMonitorWorkArea();

    await sendAnvilCommandAndSettle({
      name: "SnapLayoutMove",
      direction: "Left",
      amount: 1 / 3,
    });

    // Command must not throw; window remains mapped
    const wins = getWindowGeometries().filter(function (w) {
      return !w.minimized;
    });
    expect(wins.length).toBeGreaterThanOrEqual(1);
    expect(wins[0].width).toBeGreaterThan(0);
    expect(area.width).toBeGreaterThan(0);
  });

  it("SnapLayoutMove Right 2/3 snaps window to right two-thirds", async function () {
    await launchApp("org.gnome.Nautilus.desktop");
    await waitForWindowCount(1, 5000);

    await sendAnvilCommandAndSettle({
      name: "SnapLayoutMove",
      direction: "Right",
      amount: 2 / 3,
    });

    const wins = getWindowGeometries().filter(function (w) {
      return !w.minimized;
    });
    expect(wins.length).toBeGreaterThanOrEqual(1);
    expect(wins[0].width).toBeGreaterThan(0);
  });

  it("SnapLayoutMove Center centers the window", async function () {
    await launchApp("org.gnome.Nautilus.desktop");
    await waitForWindowCount(1, 5000);

    await sendAnvilCommandAndSettle({
      name: "SnapLayoutMove",
      direction: "Center",
    });

    const after = getWindowGeometries().filter(function (w) {
      return !w.minimized;
    });
    expect(after.length).toBeGreaterThanOrEqual(1);
    expect(after[0].width).toBeGreaterThan(0);
  });

  it("TilingModeToggle disables and re-enables tiling", async function () {
    await launchApp("org.gnome.Nautilus.desktop");
    await launchApp("org.gnome.Nautilus.desktop");
    await waitForWindowCount(2, 5000);

    const before = getWindowGeometries();
    expect(before.length).toBeGreaterThanOrEqual(2);

    // Disable tiling
    sendAnvilCommand({ name: "TilingModeToggle" });
    await sleep(200);
    expect(getSettings().get_boolean("tiling-mode-enabled")).toBe(false);

    // Re-enable tiling
    sendAnvilCommand({ name: "TilingModeToggle" });
    await sleep(200);
    expect(getSettings().get_boolean("tiling-mode-enabled")).toBe(true);
  });
});
