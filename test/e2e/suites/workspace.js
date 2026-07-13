/**
 * Workspace tests
 *
 * Verifies WorkspaceActiveTileToggle (skip tile per workspace)
 * and basic multi-workspace behavior.
 */

import {
  getSettings,
  launchApp,
  getWindowGeometries,
  sendAnvilCommand,
  getAnvilRuntime,
  closeAllWindows,
  sleep,
  waitForWindowCount,
} from "../../lib/shared-commands.js";

describe("Workspace", function () {
  beforeEach(async function () {
    await closeAllWindows();
    await sleep(200);
    // Clear any workspace skip settings
    getSettings().set_string("workspace-skip-tile", "");
  });

  afterEach(async function () {
    getSettings().set_string("workspace-skip-tile", "");
    getSettings().set_boolean("tiling-mode-enabled", true);
    await closeAllWindows();
  });

  it("WorkspaceActiveTileToggle skips tiling on current workspace", async function () {
    await launchApp("org.gnome.Nautilus.desktop");
    await launchApp("org.gnome.Nautilus.desktop");
    await waitForWindowCount(2, 5000);

    const before = getWindowGeometries();
    expect(before.length).toBeGreaterThanOrEqual(2);

    // Toggle workspace skip
    sendAnvilCommand({ name: "WorkspaceActiveTileToggle" });
    await sleep(400);

    const skipStr = getSettings().get_string("workspace-skip-tile");
    expect(skipStr).toContain("0");

    const after = getWindowGeometries();
    expect(after.length).toBeGreaterThanOrEqual(2);
  });

  it("WorkspaceActiveTileToggle toggles back to tiling", async function () {
    await launchApp("org.gnome.Nautilus.desktop");
    await waitForWindowCount(1, 5000);

    // Skip workspace
    sendAnvilCommand({ name: "WorkspaceActiveTileToggle" });
    await sleep(200);

    let skipStr = getSettings().get_string("workspace-skip-tile");
    expect(skipStr).toContain("0");

    // Toggle back
    sendAnvilCommand({ name: "WorkspaceActiveTileToggle" });
    await sleep(200);

    skipStr = getSettings().get_string("workspace-skip-tile");
    expect(skipStr).not.toContain("0");

    // Windows should be tiling again
    const wins = getWindowGeometries();
    expect(wins.length).toBeGreaterThanOrEqual(1);
  });

  it("reconciles surfaces when a dynamic workspace is created and removed", async function () {
    const manager = global.display.get_workspace_manager();
    const originalIndex = manager.get_active_workspace_index();
    const initialCount = manager.get_n_workspaces();
    const timestamp = global.display.get_current_time();
    const created = manager.append_new_workspace(true, timestamp);
    await sleep(500);

    expect(manager.get_active_workspace_index()).toBe(created.index());
    await launchApp("org.gnome.Nautilus.desktop");
    await launchApp("org.gnome.Nautilus.desktop");
    await waitForWindowCount(2, 5000);

    manager.remove_workspace(created, global.display.get_current_time());
    await sleep(1000);

    expect(manager.get_n_workspaces()).toBe(initialCount);
    expect(manager.get_active_workspace_index()).toBe(originalIndex);
    const state = JSON.parse(getAnvilRuntime().getStateJson());
    if (state.tilingEngineMode === "core") {
      expect(state.portableTilingShadowFailure).toBeNull();
      expect(state.portableTiling.surfaces.length).toBeGreaterThan(0);
      expect(state.portableTiling.windows.length).toBe(2);
      expect(
        state.portableTiling.windows.every(function (/** @type {any} */ candidate) {
          return state.portableTiling.surfaces.some(function (/** @type {any} */ surface) {
            return surface.id === candidate.surfaceId;
          });
        })
      ).toBe(true);
    }
  });
});
