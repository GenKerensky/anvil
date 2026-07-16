import { afterEach, describe, expect, it, vi } from "vitest";
import Meta from "gi://Meta";

import {
  findWindowWith,
  PREFERENCES_WINDOW_CLASS,
} from "../../../src/lib/extension/utils/window-filters.js";

type TestWindow = Meta.Window & { title: string };

const originalGetWorkspaceManager = global.display.get_workspace_manager;
const originalGetTabList = global.display.get_tab_list;

function windowWithTitle(title: string): TestWindow {
  return {
    title,
    get_wm_class: vi.fn(() => "TestApp"),
    get_workspace: vi.fn(() => null),
  } as unknown as TestWindow;
}

function arrangeWorkspaces(windowTitles: readonly (readonly string[])[]) {
  const workspaces = windowTitles.map((_, index) => ({ index: () => index }));
  const windows = windowTitles.map((titles) => titles.map(windowWithTitle));
  const getWorkspaceByIndex = vi.fn((index: number) => workspaces[index] ?? null);
  const getTabList = vi.fn((_type: Meta.TabList, workspace: typeof workspaces[number] | null) => {
    const index = workspace ? workspaces.indexOf(workspace) : -1;
    return index >= 0 ? windows[index] : [];
  });

  global.display.get_workspace_manager = vi.fn(
    () =>
      ({
        get_n_workspaces: () => workspaces.length,
        get_workspace_by_index: getWorkspaceByIndex,
      } as unknown as Meta.WorkspaceManager)
  );
  global.display.get_tab_list = getTabList;

  return { getWorkspaceByIndex, windows };
}

afterEach(() => {
  global.display.get_workspace_manager = originalGetWorkspaceManager;
  global.display.get_tab_list = originalGetTabList;
});

describe("findWindowWith", () => {
  it("finds a preferences window on workspace zero", () => {
    const { windows } = arrangeWorkspaces([["Anvil Settings"], []]);

    expect(findWindowWith("Anvil Settings")).toBe(windows[0][0]);
  });

  it("searches every valid workspace without probing past the end", () => {
    const { getWorkspaceByIndex } = arrangeWorkspaces([[], []]);

    expect(findWindowWith("Anvil Settings")).toBeUndefined();
    expect(getWorkspaceByIndex.mock.calls.map(([index]) => index)).toEqual([0, 1]);
  });

  it("prefers an exact title over an earlier substring match", () => {
    const { windows } = arrangeWorkspaces([["Anvil Settings — stale"], ["Anvil Settings"]]);

    expect(findWindowWith("Anvil Settings")).toBe(windows[1][0]);
  });

  it("ignores a partial-title window with the wrong application identity", () => {
    const { windows } = arrangeWorkspaces([["Anvil documentation"], ["Anvil"]]);
    vi.mocked(windows[1][0].get_wm_class).mockReturnValue(PREFERENCES_WINDOW_CLASS);

    expect(findWindowWith("Anvil", PREFERENCES_WINDOW_CLASS)).toBe(windows[1][0]);
  });

  it("does not match an empty search title", () => {
    arrangeWorkspaces([["Anvil Settings"]]);

    expect(findWindowWith("")).toBeUndefined();
  });
});
