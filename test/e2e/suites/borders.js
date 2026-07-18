/**
 * Border and gap tests
 *
 * Verifies FocusBorderToggle and GapSize commands.
 */

import Meta from "gi://Meta";

import {
  getSettings,
  launchApp,
  getWindowGeometries,
  sendAnvilCommand,
  closeAllWindows,
  sleep,
  waitForWindowCount,
} from "../../lib/shared-commands.js";

/** @param {any} window */
function maximizeWindow(window) {
  try {
    window.set_maximize_flags(Meta.MaximizeFlags.BOTH);
    window.maximize();
  } catch {
    window.maximize(Meta.MaximizeFlags.BOTH);
  }
}

/** @param {any} window */
function unmaximizeWindow(window) {
  try {
    window.set_unmaximize_flags(Meta.MaximizeFlags.BOTH);
    window.unmaximize();
  } catch {
    window.unmaximize(Meta.MaximizeFlags.BOTH);
  }
}

describe("Borders and Gaps", function () {
  beforeEach(async function () {
    await closeAllWindows();
    await sleep(200);
    // Reset to known defaults
    getSettings().set_boolean("focus-border-toggle", false);
    getSettings().set_boolean("split-border-toggle", false);
    getSettings().set_uint("window-gap-size-increment", 0);
  });

  afterEach(async function () {
    getSettings().set_boolean("focus-border-toggle", false);
    getSettings().set_boolean("split-border-toggle", false);
    getSettings().set_uint("window-gap-size-increment", 0);
    await closeAllWindows();
  });

  it("FocusBorderToggle toggles the focus border setting", async function () {
    const before = getSettings().get_boolean("focus-border-toggle");
    expect(before).toBe(false);

    sendAnvilCommand({ name: "FocusBorderToggle" });
    await sleep(200);

    const after = getSettings().get_boolean("focus-border-toggle");
    expect(after).toBe(true);

    sendAnvilCommand({ name: "FocusBorderToggle" });
    await sleep(200);

    const restored = getSettings().get_boolean("focus-border-toggle");
    expect(restored).toBe(false);
  });

  it("attaches and restores the surface mask across window states", async function () {
    getSettings().set_boolean("focus-border-toggle", true);
    await launchApp("org.gnome.Nautilus.desktop");
    await waitForWindowCount(1, 5000);

    const window = global.display.get_focus_window();
    expect(window).not.toBeNull();
    const actor = /** @type {any} */ (window.get_compositor_private());
    const shadow = () => actor.cornerShadow ?? null;
    const surface = () =>
      actor.get_children().find((/** @type {any} */ child) => child !== shadow()) ?? null;
    const mask = () => surface()?.get_effect("anvil-window-corner-mask") ?? null;

    expect(mask()).not.toBeNull();
    expect(actor.get_effect("anvil-window-corner-mask")).toBeNull();
    expect(shadow()).not.toBeNull();
    const stack = global.window_group.get_children();
    expect(shadow().get_parent()).toBe(actor);
    expect(stack.indexOf(shadow())).toBe(-1);
    expect(actor.get_children().indexOf(shadow())).toBeLessThan(
      actor.get_children().indexOf(surface())
    );
    expect(shadow().visible).toBe(true);
    await sleep(1500);
    const focusBorder = actor.border;
    const settledStack = global.window_group.get_children();
    expect(focusBorder).not.toBeNull();
    expect(focusBorder.visible).toBe(true);
    expect(focusBorder.get_parent()).toBe(global.window_group);
    expect(settledStack.indexOf(focusBorder)).toBeGreaterThan(settledStack.indexOf(actor));

    const workspaceManager = global.display.get_workspace_manager();
    const originalWorkspace = workspaceManager.get_active_workspace_index();
    const temporaryWorkspace = workspaceManager.append_new_workspace(
      true,
      global.display.get_current_time()
    );
    await sleep(500);
    expect(actor.get_paint_visibility()).toBe(false);
    expect(shadow().get_paint_visibility()).toBe(false);

    const originalWorkspaceObject = workspaceManager.get_workspace_by_index(originalWorkspace);
    if (!originalWorkspaceObject) throw new Error("original workspace disappeared");
    originalWorkspaceObject.activate(global.display.get_current_time());
    await sleep(500);
    expect(workspaceManager.get_active_workspace_index()).toBe(originalWorkspace);
    expect(actor.get_paint_visibility()).toBe(true);
    expect(shadow().get_paint_visibility()).toBe(true);
    workspaceManager.remove_workspace(temporaryWorkspace, global.display.get_current_time());

    window.minimize();
    await sleep(400);
    expect(mask()).toBeNull();
    expect(shadow().visible).toBe(false);

    window.unminimize();
    await sleep(400);
    expect(mask()).not.toBeNull();
    expect(shadow().visible).toBe(true);

    maximizeWindow(window);
    await sleep(400);
    expect(mask()).toBeNull();
    expect(shadow().visible).toBe(false);

    unmaximizeWindow(window);
    await sleep(400);
    expect(mask()).not.toBeNull();
    expect(shadow().visible).toBe(true);

    window.make_fullscreen();
    await sleep(400);
    expect(mask()).toBeNull();
    expect(shadow().visible).toBe(false);

    window.unmake_fullscreen();
    await sleep(400);
    expect(mask()).not.toBeNull();
    expect(shadow().visible).toBe(true);

    getSettings().set_boolean("focus-border-toggle", false);
    await sleep(200);
    expect(mask()).toBeNull();
    expect(shadow().visible).toBe(false);
  });

  it("GapSize increase changes window spacing", async function () {
    await launchApp("org.gnome.Nautilus.desktop");
    await launchApp("org.gnome.Nautilus.desktop");
    await waitForWindowCount(2, 5000);

    const before = getWindowGeometries();
    expect(before.length).toBeGreaterThanOrEqual(2);

    // Increase gap
    sendAnvilCommand({ name: "GapSize", amount: 1 });
    await sleep(400);

    const after = getWindowGeometries().filter(function (w) {
      return !w.minimized;
    });
    expect(after.length).toBeGreaterThanOrEqual(2);

    // Primary assertion: setting advanced
    expect(getSettings().get_uint("window-gap-size-increment")).toBe(1);
  });

  it("GapSize decrease reduces window spacing", async function () {
    // First set a larger gap
    getSettings().set_uint("window-gap-size-increment", 4);

    await launchApp("org.gnome.Nautilus.desktop");
    await launchApp("org.gnome.Nautilus.desktop");
    await waitForWindowCount(2, 5000);

    // Decrease gap
    sendAnvilCommand({ name: "GapSize", amount: -1 });
    await sleep(200);

    expect(getSettings().get_uint("window-gap-size-increment")).toBe(3);
  });

  it("GapSize respects bounds (0-8)", async function () {
    getSettings().set_uint("window-gap-size-increment", 0);

    await launchApp("org.gnome.Nautilus.desktop");
    await waitForWindowCount(1, 5000);

    // Try to decrease below 0
    sendAnvilCommand({ name: "GapSize", amount: -5 });
    await sleep(200);

    expect(getSettings().get_uint("window-gap-size-increment")).toBe(0);

    // Try to increase above 8
    sendAnvilCommand({ name: "GapSize", amount: 10 });
    await sleep(200);

    expect(getSettings().get_uint("window-gap-size-increment")).toBe(8);
  });
});
