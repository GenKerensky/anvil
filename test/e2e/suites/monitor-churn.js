/** Multi-monitor reconfiguration soak. Registered only for a multi-monitor harness run. */

import Meta from "gi://Meta";
import GLib from "gi://GLib";

import {
  closeAllWindows,
  getAnvilRuntime,
  launchApp,
  sleep,
  waitForWindowCount,
} from "../../lib/shared-commands.js";

const requestedMonitors = Number.parseInt(GLib.getenv("ANVIL_E2E_VIRTUAL_MONITORS") ?? "1", 10);

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

if (requestedMonitors > 1) {
  describe("Monitor Churn", function () {
    beforeEach(async function () {
      await closeAllWindows();
      await sleep(200);
    });

    afterEach(async function () {
      await closeAllWindows();
    });

    it("preserves surface integrity across mirror and linear reconfiguration", async function () {
      expect(global.display.get_n_monitors()).toBeGreaterThanOrEqual(2);
      await launchApp("org.gnome.Nautilus.desktop");
      await launchApp("org.gnome.Nautilus.desktop");
      await waitForWindowCount(2, 5000);

      const window = global.display.get_focus_window();
      expect(window).not.toBeNull();
      window?.move_to_monitor(1);
      await sleep(700);

      const before = readState();
      expectCoreIntegrity(before);

      const monitorManager = global.backend.get_monitor_manager();
      expect(monitorManager.can_switch_config()).toBe(true);
      monitorManager.switch_config(Meta.MonitorSwitchConfigType.ALL_MIRROR);
      await sleep(1000);
      expect((monitorManager.get_logical_monitors() ?? []).length).toBe(1);
      expectCoreIntegrity(readState());

      monitorManager.switch_config(Meta.MonitorSwitchConfigType.ALL_LINEAR);
      await sleep(1200);

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
