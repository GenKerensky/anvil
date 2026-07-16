/** Legacy cross-surface swap regression. Runs only in its dedicated two-monitor process. */

import Meta from "gi://Meta";
import GLib from "gi://GLib";

import {
  closeAllWindows,
  getAnvilRuntime,
  getExtensionErrors,
  getFocusedWindowId,
  getRuntimeWindowStates,
  launchApp,
  sendAnvilCommandAndSettle,
  sleep,
  waitForWindowCount,
} from "../../lib/shared-commands.js";

const requestedMonitors = Number.parseInt(GLib.getenv("ANVIL_E2E_VIRTUAL_MONITORS") ?? "1", 10);
const explicitlyRequested = (GLib.getenv("ANVIL_E2E_TAG") ?? "")
  .split(",")
  .map((tag) => tag.trim())
  .includes("cross-surface-swap");

/** @param {any} node @param {number} windowId */
function containsWindow(node, windowId) {
  return (
    node?.windowId === windowId ||
    (node?.children ?? []).some((/** @type {any} */ child) => containsWindow(child, windowId))
  );
}

/** @param {number} windowId */
function treeMonitorFor(windowId) {
  const state = JSON.parse(getAnvilRuntime().getStateJson());
  for (const workspace of state.tree?.children ?? []) {
    const monitors = (workspace.children ?? []).filter(
      (/** @type {any} */ child) => child.type === "MONITOR"
    );
    const index = monitors.findIndex((/** @type {any} */ monitor) =>
      containsWindow(monitor, windowId)
    );
    if (index >= 0) return index;
  }
  return -1;
}

/** @param {Meta.Window} window @param {number} monitor */
async function waitForSurface(window, monitor) {
  const deadline = GLib.get_monotonic_time() + 5_000_000;
  while (GLib.get_monotonic_time() < deadline) {
    if (window.get_monitor() === monitor && treeMonitorFor(window.get_id()) === monitor) return;
    await sleep(50);
  }
  expect(window.get_monitor()).toBe(monitor);
  expect(treeMonitorFor(window.get_id())).toBe(monitor);
}

if (requestedMonitors > 1 && explicitlyRequested) {
  describe("Cross-surface Swap", function () {
    beforeEach(async function () {
      await closeAllWindows();
      await sleep(200);
    });

    afterEach(async function () {
      await closeAllWindows();
    });

    it("swaps adjacent monitor windows without freezing or losing focus", async function () {
      expect(global.display.get_n_monitors()).toBeGreaterThanOrEqual(2);
      await launchApp("org.gnome.Nautilus.desktop");
      await launchApp("org.gnome.Nautilus.desktop");
      await waitForWindowCount(2, 5000);

      const workspace = global.workspace_manager.get_active_workspace();
      const windows = global.display
        .get_tab_list(Meta.TabList.NORMAL_ALL, workspace)
        .filter((window) => !window.minimized)
        .slice(0, 2);
      expect(windows).toHaveSize(2);

      const secondary = windows[0];
      const primary = windows[1];
      secondary.move_to_monitor(1);
      await waitForSurface(secondary, 1);
      await waitForSurface(primary, 0);

      primary.activate(global.display.get_current_time());
      const focusDeadline = GLib.get_monotonic_time() + 2_000_000;
      while (
        getFocusedWindowId() !== primary.get_id() &&
        GLib.get_monotonic_time() < focusDeadline
      ) {
        await sleep(50);
      }
      expect(getFocusedWindowId()).toBe(primary.get_id());

      await sendAnvilCommandAndSettle({ name: "Swap", direction: "Right" }, 3000);

      await waitForSurface(primary, 1);
      await waitForSurface(secondary, 0);
      expect(getFocusedWindowId()).toBe(primary.get_id());

      for (const window of [primary, secondary]) {
        const frame = window.get_frame_rect();
        expect(frame.width).toBeGreaterThan(0);
        expect(frame.height).toBeGreaterThan(0);
      }

      await sendAnvilCommandAndSettle({ name: "Swap", direction: "Left" }, 3000);

      await waitForSurface(primary, 0);
      await waitForSurface(secondary, 1);
      expect(getFocusedWindowId()).toBe(primary.get_id());
      expect(getRuntimeWindowStates()).toHaveSize(2);
      expect(getExtensionErrors()).toEqual([]);
    });
  });
}
