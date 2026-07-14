/** Multi-monitor reconfiguration soak. Registered only for a multi-monitor harness run. */

import Meta from "gi://Meta";
import GLib from "gi://GLib";
import Clutter from "gi://Clutter";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

import {
  closeAllWindows,
  getAnvilRuntime,
  launchApp,
  sleep,
  waitForWindowCount,
} from "../../lib/shared-commands.js";

const requestedMonitors = Number.parseInt(GLib.getenv("ANVIL_E2E_VIRTUAL_MONITORS") ?? "1", 10);
const requestedTags = (GLib.getenv("ANVIL_E2E_TAG") ?? "")
  .split(",")
  .map((tag) => tag.trim())
  .filter(Boolean);
const explicitlyRequested = requestedTags.includes("monitor-churn");
const UUID = "anvil@GenKerensky.github.com";

/** @param {Meta.Window} window @param {number} monitor */
async function waitForMonitor(window, monitor) {
  const deadline = GLib.get_monotonic_time() + 2_000_000;
  while (window.get_monitor() !== monitor && GLib.get_monotonic_time() < deadline) await sleep(50);
  expect(window.get_monitor()).toBe(monitor);
}

async function waitForWindowsGone() {
  const deadline = GLib.get_monotonic_time() + 5_000_000;
  while (GLib.get_monotonic_time() < deadline) {
    if (
      global.display.list_all_windows().length === 0 &&
      global.get_window_actors().every((actor) => actor.meta_window === null)
    ) {
      await sleep(500);
      return;
    }
    await sleep(50);
  }
  expect(global.display.list_all_windows()).toHaveSize(0);
  expect(global.get_window_actors().filter((actor) => actor.meta_window !== null)).toHaveSize(0);
}

async function settlePointerOnPrimaryMonitor() {
  const primary = global.display.get_monitor_geometry(0);
  Clutter.get_default_backend()
    .get_default_seat()
    ?.warp_pointer(
      primary.x + Math.floor(primary.width / 2),
      primary.y + Math.floor(primary.height / 2)
    );
  const deadline = GLib.get_monotonic_time() + 2_000_000;
  while (global.display.get_current_monitor() !== 0 && GLib.get_monotonic_time() < deadline)
    await sleep(50);
  expect(global.display.get_current_monitor()).toBe(0);
}

/** @param {boolean} enabled */
async function setExtensionEnabled(enabled) {
  if (enabled) Main.extensionManager.enableExtension(UUID);
  else Main.extensionManager.disableExtension(UUID);

  const deadline = GLib.get_monotonic_time() + 5_000_000;
  while (GLib.get_monotonic_time() < deadline) {
    const active = /** @type {any} */ (global).__anvil_runtime != null;
    if (active === enabled) return;
    await sleep(50);
  }
  expect(/** @type {any} */ (global).__anvil_runtime != null).toBe(enabled);
}

function readState() {
  return JSON.parse(getAnvilRuntime().getStateJson());
}

/** @param {any} state */
function expectCoreIntegrity(state) {
  if (state.tilingEngineMode !== "core") return;
  expect(state.portableTilingShadowFailure).toBeNull();
  expect(
    state.portableTiling.windows.every(function (/** @type {any} */ candidate) {
      return (
        !candidate.participating ||
        state.portableTiling.surfaces.some(function (/** @type {any} */ surface) {
          return surface.id === candidate.surfaceId;
        })
      );
    })
  ).toBe(true);
}

// Mutter 50.1 can segfault in meta_monitor_manager_get_logical_monitor_neighbor()
// when mirror churn follows other window-moving suites in the same Shell process.
// Keep this suite in a fresh process via the dedicated runner invocation.
if (requestedMonitors > 1 && explicitlyRequested) {
  describe("Monitor Churn", function () {
    beforeEach(async function () {
      await closeAllWindows();
      await sleep(200);
    });

    afterEach(async function () {
      await closeAllWindows();
      if (/** @type {any} */ (global).__anvil_runtime == null) await setExtensionEnabled(true);
    });

    it("reconstructs surface integrity across mirror and linear reconfiguration", async function () {
      expect(global.display.get_n_monitors()).toBeGreaterThanOrEqual(2);
      await launchApp("org.gnome.Nautilus.desktop");
      await launchApp("org.gnome.Nautilus.desktop");
      await waitForWindowCount(2, 5000);

      const window = global.display.get_focus_window();
      expect(window).not.toBeNull();
      window?.move_to_monitor(1);
      if (window) await waitForMonitor(window, 1);

      const before = readState();
      expectCoreIntegrity(before);

      // Mutter 50.1 queries removed logical monitors while migrating resident
      // windows into ALL_MIRROR. Exercise monitor 1 above, then close the test
      // windows before changing topology so this remains an Anvil churn test.
      await closeAllWindows();
      await waitForWindowCount(0, 5000);
      await waitForWindowsGone();
      await settlePointerOnPrimaryMonitor();
      await setExtensionEnabled(false);

      const monitorManager = global.backend.get_monitor_manager();
      expect(monitorManager.can_switch_config()).toBe(true);
      monitorManager.switch_config(Meta.MonitorSwitchConfigType.ALL_MIRROR);
      await sleep(1000);
      expect((monitorManager.get_logical_monitors() ?? []).length).toBe(1);
      await setExtensionEnabled(true);
      await launchApp("org.gnome.Nautilus.desktop");
      await waitForWindowCount(1, 5000);
      expectCoreIntegrity(readState());

      await closeAllWindows();
      await waitForWindowCount(0, 5000);
      await waitForWindowsGone();
      await setExtensionEnabled(false);
      monitorManager.switch_config(Meta.MonitorSwitchConfigType.ALL_LINEAR);
      await sleep(1200);
      await setExtensionEnabled(true);

      expect(global.display.get_n_monitors()).toBeGreaterThanOrEqual(2);
      const state = readState();
      if (state.tilingEngineMode === "core") {
        expectCoreIntegrity(state);
        expect(state.portableTiling.surfaces.length).toBeGreaterThanOrEqual(2);
        expect(
          state.portableTiling.surfaces.map((/** @type {any} */ surface) => surface.id)
        ).toEqual(before.portableTiling.surfaces.map((/** @type {any} */ surface) => surface.id));
      }
    });
  });
}
