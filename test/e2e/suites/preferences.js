/**
 * Preferences process lifecycle and duplicate-window regression coverage.
 */

import Meta from "gi://Meta";

import { closeAllWindows, sleep } from "../../lib/shared-commands.js";

const PREFERENCES_TITLE = "Anvil";

function preferencesWindows() {
  const workspaceManager = global.display.get_workspace_manager();
  const windows = [];
  for (let index = 0; index < workspaceManager.get_n_workspaces(); index++) {
    const workspace = workspaceManager.get_workspace_by_index(index);
    windows.push(...global.display.get_tab_list(Meta.TabList.NORMAL_ALL, workspace));
  }
  return windows.filter(function (window) {
    return window.get_title()?.includes(PREFERENCES_TITLE);
  });
}

/**
 * @param {number} expected
 * @param {number} [timeoutMs]
 */
async function waitForPreferencesCount(expected, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const windows = preferencesWindows();
    if (windows.length === expected) return windows;
    await sleep(200);
  }
  const allWindows = global.display.get_tab_list(Meta.TabList.NORMAL_ALL, null);
  const titles = allWindows.map(function (window) {
    return window.get_title();
  });
  throw new Error(
    `Timed out waiting for ${expected} preferences windows; found ${
      preferencesWindows().length
    }; ` + `visible titles: ${titles.join(", ")}`
  );
}

afterEach(async function () {
  await closeAllWindows();
});

describe("Preferences lifecycle", function () {
  it("opens, reuses, closes, and reopens one preferences window", async function () {
    const runtime = /** @type {any} */ (global).__anvil_runtime;

    runtime.command({ name: "PrefsOpen" });
    const [firstWindow] = await waitForPreferencesCount(1);
    const firstId = firstWindow.get_id();
    log(
      `[E2E] Preferences identity: title=${firstWindow.get_title()} ` +
        `class=${firstWindow.get_wm_class()}`
    );

    runtime.command({ name: "PrefsOpen" });
    await sleep(750);

    const reusedWindows = preferencesWindows();
    expect(reusedWindows.length).toBe(1);
    expect(reusedWindows[0].get_id()).toBe(firstId);
    expect(global.display.get_focus_window()?.get_id()).toBe(firstId);

    firstWindow.delete(global.display.get_current_time());
    await waitForPreferencesCount(0);

    runtime.command({ name: "PrefsOpen" });
    const [reopenedWindow] = await waitForPreferencesCount(1);
    expect(reopenedWindow.get_id()).not.toBe(firstId);
  });
});
