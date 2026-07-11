/*
 * Window filter helpers (B11-1).
 */
import Meta from "gi://Meta";

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

export function findWindowWith(title: string) {
  const display = global.display;
  const type = Meta.TabList.NORMAL_ALL;
  const workspaceMgr = display.get_workspace_manager();
  const workspaces = workspaceMgr.get_n_workspaces();

  for (let wsId = 1; wsId <= workspaces; wsId++) {
    const workspace = workspaceMgr.get_workspace_by_index(wsId);
    const tabList = (display as Meta.Display).get_tab_list(type, workspace);
    for (const metaWindow of tabList) {
      if (
        metaWindow.title &&
        title &&
        (metaWindow.title === title || metaWindow.title.includes(title))
      ) {
        return metaWindow;
      }
    }
  }

  return undefined;
}

export function monitorIndex(monitorValue: string) {
  if (!monitorValue) return -1;
  const wsIndex = monitorValue.indexOf("ws");
  let indexVal = monitorValue.slice(0, wsIndex);
  indexVal = indexVal.replace("mo", "");
  return parseInt(indexVal);
}
