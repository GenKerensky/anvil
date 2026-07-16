/*
 * Window filter helpers (B11-1).
 */
import Meta from "gi://Meta";

export const PREFERENCES_WINDOW_CLASS = "org.gnome.Shell.Extensions";

export function isEphemeralHelperWindow(metaWindow: Meta.Window) {
  const wmClass = (metaWindow.get_wm_class() ?? "").toLowerCase();
  const title = (metaWindow.get_title() ?? "").toLowerCase();
  const knownHelpers = ["wl-clipboard", "xclip", "xsel"];
  if (knownHelpers.some((name) => wmClass.includes(name) || title === name)) {
    return true;
  }
  const frame = metaWindow.get_frame_rect();
  return frame.width <= 2 && frame.height <= 2;
}

export function isPreferencesWindow(metaWindow: Meta.Window, title: string): boolean {
  return (
    !!title &&
    metaWindow.get_wm_class()?.toLowerCase() === PREFERENCES_WINDOW_CLASS.toLowerCase() &&
    !!metaWindow.title?.includes(title)
  );
}

export function findWindowWith(title: string, wmClass?: string) {
  if (!title) return undefined;
  const display = global.display;
  const type = Meta.TabList.NORMAL_ALL;
  const workspaceMgr = display.get_workspace_manager();
  const workspaces = workspaceMgr.get_n_workspaces();
  let partialMatch: Meta.Window | undefined;

  for (let wsId = 0; wsId < workspaces; wsId++) {
    const workspace = workspaceMgr.get_workspace_by_index(wsId);
    if (!workspace) continue;
    const tabList = (display as Meta.Display).get_tab_list(type, workspace);
    for (const metaWindow of tabList) {
      if (wmClass && metaWindow.get_wm_class()?.toLowerCase() !== wmClass.toLowerCase()) continue;
      if (metaWindow.title === title) return metaWindow;
      if (!partialMatch && metaWindow.title?.includes(title)) partialMatch = metaWindow;
    }
  }

  return partialMatch;
}

export function monitorIndex(monitorValue: string) {
  if (!monitorValue) return -1;
  const wsIndex = monitorValue.indexOf("ws");
  let indexVal = monitorValue.slice(0, wsIndex);
  indexVal = indexVal.replace("mo", "");
  return parseInt(indexVal);
}
