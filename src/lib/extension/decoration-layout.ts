/**
 * DecorationLayout — tab/con show/hide per workspace.
 *
 * Extracted from AnvilRuntime.updateDecorationLayout.
 * Reads tree, focusMetaWindow, settings via host. Calls into
 * tab-decoration.ts functions for actor show/hide as needed.
 *
 * Extraction rationale: `.agents/memory/decisions.md`.
 */

import Meta from "gi://Meta";
import type Gio from "gi://Gio";

import { Tree, Node, NODE_TYPES } from "./tree.js";
import type { AnvilMetaWindow } from "./window/types.js";

export interface DecorationLayoutHost {
  isRenderFrozen(): boolean;
  readonly tree: Tree;
  focusMetaWindow: Meta.Window | null;
  readonly settings: Gio.Settings;
}

export class DecorationLayout {
  constructor(private host: DecorationLayoutHost) {}

  updateDecorationLayout(): void {
    if (this.host.isRenderFrozen()) return;
    const activeWsNode = this.getActiveWsNode();
    const allCons = this.host.tree.getNodeByType(NODE_TYPES.CON);

    // First, hide all decorations:
    allCons.forEach((con: any) => {
      if (con.decoration) {
        con.decoration.hide();
      }
    });

    // Next, handle showing-desktop usually by Super + D
    if (!activeWsNode) return;
    const allWindows = activeWsNode.getNodeByType(NODE_TYPES.WINDOW);
    const allHiddenWindows = allWindows.filter((w: any) => {
      const metaWindow = w.nodeValue as Meta.Window;
      return !metaWindow.showing_on_its_workspace() || metaWindow.minimized;
    });

    // Then if all hidden, do not proceed showing the decorations at all;
    if (allWindows.length === allHiddenWindows.length) return;

    // Show the decoration where on all monitors of active workspace
    // But not on the monitor where there is a maximized or fullscreen window
    // Note, that when multi-display, user can have multi maximized windows,
    // So it needs to be fully filtered:
    const monWsNoMaxWindows = activeWsNode
      .getNodeByType(NODE_TYPES.MONITOR)
      .filter((monitor: any) => {
        return (
          monitor.getNodeByType(NODE_TYPES.WINDOW).filter((w: any) => {
            return (() => {
              try {
                return (
                  (w.nodeValue as Meta.Window).is_maximized() ||
                  (w.nodeValue as Meta.Window).is_fullscreen()
                );
              } catch {
                return (
                  (w.nodeValue as AnvilMetaWindow).get_maximized() === Meta.MaximizeFlags.BOTH ||
                  (w.nodeValue as Meta.Window).is_fullscreen()
                );
              }
            })();
          }).length === 0
        );
      });

    monWsNoMaxWindows.forEach((monitorWs: any) => {
      const activeMonWsCons = monitorWs.getNodeByType(NODE_TYPES.CON);
      activeMonWsCons.forEach((con: any) => {
        const tiled = this.host.tree.getTiledChildren(con.childNodes);
        const showTabs = this.host.settings.get_boolean("showtab-decoration-enabled");
        if (con.decoration && tiled.length > 0 && showTabs) {
          con.decoration.show();
          const focusMetaWindow = this.host.focusMetaWindow;
          if (global.window_group.contains(con.decoration) && focusMetaWindow) {
            global.window_group.remove_child(con.decoration);
            // Show it below the focused window
            global.window_group.insert_child_below(
              con.decoration,
              focusMetaWindow.get_compositor_private()
            );
          }
          con.childNodes.forEach((cn: any) => {
            cn.render();
          });
        }
      });
    });
  }

  private getActiveWsNode(): Node<any> | null {
    const display = global.display;
    const wsMgr = display.get_workspace_manager();
    const wsIndex = wsMgr.get_active_workspace_index();
    const ws = `ws${wsIndex}`;
    if (ws) {
      return this.host.tree.findNode(ws);
    }
    return null;
  }
}
