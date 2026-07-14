/**
 * WorkspaceMutations — workspace tree mutations + float/unfloat helpers.
 *
 * A single class (one honest module interface) wrapping a narrow host, instead
 * of ten free functions that each re-receive the same broad host (review S6).
 * The host is narrow (C4): grab dispatchers are `handleResizing`/`handleMoving`,
 * not a concrete GrabResizeSession reference.
 *
 * Ownership/lifecycle rules: `.agents/rules/architecture.md` (§2 one owner per
 * state). Extraction rationale: `.agents/memory/decisions.md`.
 */

import Meta from "gi://Meta";
import Gio from "gi://Gio";

import { Tree, Node, NODE_TYPES } from "./tree.js";
import { WINDOW_MODES, GRAB_TYPES } from "./window/constants.js";
import { safeRaise } from "./mutter-safe.js";
import type { AnvilMetaWindow } from "./window/types.js";

/** Host surface consumed by WorkspaceMutations (narrow — C4). */
export interface WorkspaceMutationsHost {
  readonly tree: Tree;
  readonly settings: Gio.Settings;
  readonly layoutEngine: import("./layout-engine.js").LayoutEngine;
  readonly focusMetaWindow: Meta.Window | null;
  readonly grabOp: Meta.GrabOp;
  sortedWindows: Meta.Window[];

  findNodeWindow(w: Meta.Window): Node | null;
  renderTree(from: string, force?: boolean): void;
  updateBorderLayout(): void;
  updateDecorationLayout(): void;
  updateStackedFocus(n: Node | null | undefined): void;
  updateTabbedFocus(n: Node | null | undefined): void;
  floatingWindow(n: Node | null): boolean;
  validWindow(w: Meta.Window): boolean;

  // Narrow grab dispatchers (C4) — NOT concrete GrabResizeSession
  handleResizing(n: Node | null): void;
  handleMoving(n: Node | null): void;
  grabModeFor(n: Node): string | null;
}

export class WorkspaceMutations {
  constructor(private host: WorkspaceMutationsHost) {}

  trackCurrentMonWs() {
    const metaWindow = this.host.focusMetaWindow;
    if (!metaWindow) return;
    const currentMonitor = global.display.get_current_monitor();
    const currentWorkspace = global.display.get_workspace_manager().get_active_workspace_index();

    const currentMonWs = `mo${currentMonitor}ws${currentWorkspace}`;
    const activeMetaMonWs = `mo${metaWindow.get_monitor()}ws${metaWindow.get_workspace().index()}`;
    const currentWsNode = this.host.tree.findNode(`ws${currentWorkspace}`);

    if (!currentWsNode) {
      return;
    }

    // Search for all the valid windows on the workspace
    const monWindows = currentWsNode.getNodeByType(NODE_TYPES.WORKSPACE).flatMap((ws) => {
      return ws
        .getNodeByType(NODE_TYPES.WINDOW)
        .filter(
          (w) =>
            !(w.nodeValue as Meta.Window).minimized &&
            w.isTile() &&
            w.nodeValue !== metaWindow &&
            // The searched window should be on the same monitor workspace
            // This ensures that Anvil already updated the workspace node tree:
            currentMonWs === activeMetaMonWs
        )
        .map((w) => w.nodeValue);
    });

    this.host.sortedWindows = global.display
      .sort_windows_by_stacking(monWindows as Meta.Window[])
      .reverse();
  }

  getWindowsOnWorkspace(workspaceIndex: number) {
    const workspaceNode = this.host.tree.findNode(`ws${workspaceIndex}`);
    if (!workspaceNode) return [];
    const workspaceWindows = workspaceNode.getNodeByType(NODE_TYPES.WINDOW);
    return workspaceWindows;
  }

  floatWorkspace(workspaceIndex: number) {
    const workspaceWindows = this.getWindowsOnWorkspace(workspaceIndex);
    if (!workspaceWindows) return;
    workspaceWindows.forEach((w) => {
      w.float = true;
    });
  }

  unfloatWorkspace(workspaceIndex: number) {
    const workspaceWindows = this.getWindowsOnWorkspace(workspaceIndex);
    if (!workspaceWindows) return;
    workspaceWindows.forEach((w) => {
      w.tile = true;
    });
  }

  isActiveWindowWorkspaceTiled(metaWindow: Meta.Window) {
    if (!metaWindow) return true;
    const skipWs = this.host.settings.get_string("workspace-skip-tile");
    const skipArr = skipWs.split(",");
    let skipThisWs = false;

    for (let i = 0; i < skipArr.length; i++) {
      const activeWorkspaceForWin = metaWindow.get_workspace();
      if (activeWorkspaceForWin) {
        const wsIndex = activeWorkspaceForWin.index();
        if (skipArr[i].trim() === `${wsIndex}`) {
          skipThisWs = true;
          break;
        }
      }
    }
    return !skipThisWs;
  }

  isCurrentWorkspaceTiled() {
    const skipWs = this.host.settings.get_string("workspace-skip-tile");
    const skipArr = skipWs.split(",");
    let skipThisWs = false;
    const wsMgr = global.workspace_manager;
    const wsIndex = wsMgr.get_active_workspace_index();

    for (let i = 0; i < skipArr.length; i++) {
      if (skipArr[i].trim() === `${wsIndex}`) {
        skipThisWs = true;
        break;
      }
    }
    return !skipThisWs;
  }

  updateMetaWorkspaceMonitor(from: string, _monitor: number | null, metaWindow: Meta.Window) {
    const host = this.host;
    if (host.validWindow(metaWindow)) {
      if (metaWindow.get_workspace() === null) return;
      const existNodeWindow = host.tree.findNode(metaWindow);
      const metaMonWs = `mo${metaWindow.get_monitor()}ws${metaWindow.get_workspace().index()}`;
      const metaMonWsNode = host.tree.findNode(metaMonWs);
      if (existNodeWindow) {
        if (existNodeWindow.parentNode && metaMonWsNode) {
          // Uses the existing workspace, monitor that the metaWindow
          // belongs to.
          const containsWindow = metaMonWsNode.contains(existNodeWindow);
          if (!containsWindow) {
            // LayoutEngine owns the reparent + percent redistribution (review
            // S1). Ported from jcrussell/forge (preserve proportions on move).
            host.layoutEngine.reparentToNode(existNodeWindow, metaMonWsNode);

            // Ensure that the workspace tiling is honored
            if (this.isActiveWindowWorkspaceTiled(metaWindow)) {
              if (host.grabOp !== Meta.GrabOp.WINDOW_BASE) host.updateTabbedFocus(existNodeWindow);
              host.updateStackedFocus(existNodeWindow);
            } else {
              if (host.floatingWindow(existNodeWindow)) {
                safeRaise(existNodeWindow.nodeValue as Meta.Window);
              }
            }
          }
        }
      }
      host.renderTree(from);
    }
  }

  updateMetaPositionSize(_metaWindow: Meta.Window, from: string) {
    const host = this.host;
    const focusMetaWindow = host.focusMetaWindow;
    if (!focusMetaWindow) return;

    const focusNodeWindow = host.findNodeWindow(focusMetaWindow);
    if (!focusNodeWindow) return;

    const tilingModeEnabled = host.settings.get_boolean("tiling-mode-enabled");

    const grabMode = host.grabModeFor(focusNodeWindow);
    if (grabMode && tilingModeEnabled) {
      if (grabMode === GRAB_TYPES.RESIZING) {
        host.handleResizing(focusNodeWindow);
      } else if (grabMode === GRAB_TYPES.MOVING) {
        host.handleMoving(focusNodeWindow);
      }
    } else {
      if (
        (() => {
          try {
            // GNOME 49+
            return !focusMetaWindow.is_maximized();
          } catch {
            // pre-49 fallback
            return (focusMetaWindow as AnvilMetaWindow).get_maximized() === 0;
          }
        })()
      ) {
        host.renderTree(from);
      }
    }
    host.updateBorderLayout();
    host.updateDecorationLayout();
  }

  floatAllWindows() {
    this.host.tree.getNodeByType(NODE_TYPES.WINDOW).forEach((w) => {
      if (w.isFloat()) {
        w.prevFloat = true;
      }
      w.mode = WINDOW_MODES.FLOAT;
    });
  }

  unfloatAllWindows() {
    this.host.tree.getNodeByType(NODE_TYPES.WINDOW).forEach((w) => {
      if (!w.prevFloat) {
        w.mode = WINDOW_MODES.TILE;
      } else {
        // Reset the float marker
        w.prevFloat = false;
      }
    });
  }
}
