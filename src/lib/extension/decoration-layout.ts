/**
 * DecorationLayout — tab/con show/hide per workspace.
 *
 * Extracted from AnvilRuntime.updateDecorationLayout.
 * Reads tree, focusMetaWindow, settings via host. Calls into
 * Uses the production presentation port for actor show/hide as needed.
 *
 * Extraction rationale: `.agents/memory/decisions.md`.
 */

import Meta from "gi://Meta";
import type Gio from "gi://Gio";

import { Tree, Node, NODE_TYPES } from "./tree.js";
import type { AnvilMetaWindow } from "./window/types.js";
import type { TreePresentationPort } from "./tree-presentation.js";

export interface DecorationLayoutHost {
  isRenderFrozen(): boolean;
  readonly tree: Tree;
  focusMetaWindow: Meta.Window | null;
  readonly settings: Gio.Settings;
  readonly presentation: TreePresentationPort;
}

export class DecorationLayout {
  constructor(private host: DecorationLayoutHost) {}

  updateDecorationLayout(): void {
    if (this.host.isRenderFrozen()) return;
    const activeWsNode = this.getActiveWsNode();
    const allCons = this.host.tree.getNodeByType(NODE_TYPES.CON);

    // First, hide all decorations:
    allCons.forEach((con: Node) => {
      this.host.presentation.hideDecoration(con);
    });

    // Next, handle showing-desktop usually by Super + D
    if (!activeWsNode) return;
    const allWindows = activeWsNode.getNodeByType(NODE_TYPES.WINDOW);
    const allHiddenWindows = allWindows.filter((w: Node) => {
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
      .filter((monitor: Node) => {
        return (
          monitor.getNodeByType(NODE_TYPES.WINDOW).filter((w: Node) => {
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

    monWsNoMaxWindows.forEach((monitorWs: Node) => {
      const activeMonWsCons = monitorWs.getNodeByType(NODE_TYPES.CON);
      activeMonWsCons.forEach((con: Node) => {
        const tiled = this.host.tree.getTiledChildren(con.childNodes);
        const showTabs = this.host.settings.get_boolean("showtab-decoration-enabled");
        if (tiled.length > 0 && showTabs) {
          const focusMetaWindow = this.host.focusMetaWindow;
          if (focusMetaWindow) this.host.presentation.showDecorationBelow(con, focusMetaWindow);
          con.childNodes.forEach((cn: Node) => {
            this.host.presentation.refreshTabTitle(cn);
          });
        }
      });
    });
  }

  private getActiveWsNode(): Node | null {
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
