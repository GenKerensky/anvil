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
  getWindowCount,
  getMonitorWorkArea,
  sendAnvilCommand,
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
    await launchApp("org.gnome.TextEditor.desktop");
    await launchApp("org.gnome.TextEditor.desktop");
    await waitForWindowCount(2, 5000);

    const before = getWindowGeometries();
    expect(before.length).toBeGreaterThanOrEqual(2);

    // Initially tiling
    const area = getMonitorWorkArea();
    const totalBefore = before.reduce(function (sum, w) {
      return sum + w.width * w.height;
    }, 0);
    const ratioBefore =
      Math.abs(totalBefore - area.width * area.height) / (area.width * area.height);
    expect(ratioBefore).toBeLessThan(0.05);

    // Toggle workspace skip
    sendAnvilCommand({ name: "WorkspaceActiveTileToggle" });
    await sleep(200);

    const skipStr = getSettings().get_string("workspace-skip-tile");
    expect(skipStr).toContain("0");

    // After skip, windows should no longer be tightly tiling
    const after = getWindowGeometries();
    expect(after.length).toBeGreaterThanOrEqual(2);

    // Total area may change because windows are now floated
    const totalAfter = after.reduce(function (sum, w) {
      return sum + w.width * w.height;
    }, 0);
    const ratioAfter = Math.abs(totalAfter - area.width * area.height) / (area.width * area.height);
    // After skipping tile, windows might not fill work area exactly
    expect(ratioAfter).toBeGreaterThan(0.01);
  });

  it("WorkspaceActiveTileToggle toggles back to tiling", async function () {
    await launchApp("org.gnome.TextEditor.desktop");
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
});
