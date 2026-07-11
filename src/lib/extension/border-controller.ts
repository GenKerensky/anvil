/**
 * BorderController — focus / split border actors (B7-2).
 *
 * Owns create/hide/show/update of tiled focus borders and split hints.
 * WindowManager remains a thin facade for host wiring and SettingsBridge.
 */

import Gio from "gi://Gio";
import Meta from "gi://Meta";
import St from "gi://St";

import { NODE_TYPES, type Node, type Tree } from "./tree.js";
import { WINDOW_MODES } from "./window/constants.js";
import type { AnvilMetaWindow, AnvilWindowActor } from "./window/types.js";

export interface BorderControllerHost {
  readonly tree: Tree;
  readonly settings: Gio.Settings;
  readonly focusMetaWindow: Meta.Window | null;
  calculateGaps(node: Node<any>): number;
  findNodeWindow(metaWindow: Meta.Window): Node<any> | null;
}

export class BorderController {
  private _host: BorderControllerHost;

  constructor(host: BorderControllerHost) {
    this._host = host;
  }

  bordersEnabled(): boolean {
    const settings = this._host.settings;
    return (
      settings.get_boolean("focus-border-toggle") || settings.get_boolean("split-border-toggle")
    );
  }

  ensureBorderActors(windowActor: AnvilWindowActor | null) {
    if (!windowActor || !this.bordersEnabled()) return;
    if (!windowActor.border) {
      const border = new St.Bin({ style_class: "window-tiled-border" });
      if (global.window_group) global.window_group.add_child(border);
      windowActor.border = border;
      border.show();
    }
  }

  ensureAllBorderActors() {
    this._host.tree.nodeWindows.forEach((nodeWindow) => {
      const actor = nodeWindow.windowActor as AnvilWindowActor | null;
      if (actor) this.ensureBorderActors(actor);
    });
  }

  destroyAllBorderActors() {
    this._host.tree.nodeWindows.forEach((nodeWindow) => {
      const actor = nodeWindow.windowActor as AnvilWindowActor | null;
      if (!actor) return;
      if (actor.border) {
        if (global.window_group) global.window_group.remove_child(actor.border);
        actor.border.hide();
        actor.border = undefined;
      }
      if (actor.splitBorder) {
        if (global.window_group) global.window_group.remove_child(actor.splitBorder);
        actor.splitBorder.hide();
        actor.splitBorder = undefined;
      }
    });
  }

  hideActorBorder(actor: AnvilWindowActor | null) {
    if (!actor) return;
    if (actor.border) actor.border.hide();
    if (actor.splitBorder) actor.splitBorder.hide();
  }

  hideWindowBorders() {
    if (!this.bordersEnabled()) return;
    this._host.tree.nodeWindows.forEach((nodeWindow) => {
      const actor = nodeWindow.windowActor;
      if (actor) this.hideActorBorder(actor);
      if (nodeWindow!.parentNode!.isTabbed()) {
        if (nodeWindow.tab && !(nodeWindow.tab as any)._destroyed && nodeWindow.tab.get_parent()) {
          try {
            nodeWindow.tab.remove_style_class_name("window-tabbed-tab-active");
          } catch {
            /* ignore */
          }
        }
      }
    });
  }

  showWindowBorders() {
    if (!this.bordersEnabled()) return;
    const host = this._host;
    const metaWindow = host.focusMetaWindow;
    if (!metaWindow) return;
    const windowActor = metaWindow.get_compositor_private() as AnvilWindowActor | null;
    if (!windowActor) return;
    this.ensureBorderActors(windowActor);
    const nodeWindow = host.findNodeWindow(metaWindow);
    if (!nodeWindow) return;
    if (metaWindow.get_wm_class() === null) return;

    const borders: St.Bin[] = [];
    const focusBorderEnabled = host.settings.get_boolean("focus-border-toggle");
    const splitBorderEnabled = host.settings.get_boolean("split-border-toggle");
    const tilingModeEnabled = host.settings.get_boolean("tiling-mode-enabled");
    const gap = host.calculateGaps(nodeWindow);
    const maximized = () => {
      try {
        return metaWindow.is_maximized() || metaWindow.is_fullscreen() || gap === 0;
      } catch {
        return (
          (metaWindow as AnvilMetaWindow).get_maximized() === 3 ||
          metaWindow.is_fullscreen() ||
          gap === 0
        );
      }
    };
    const monitorCount = global.display.get_n_monitors();
    const tiledChildren = host.tree.getTiledChildren(nodeWindow!.parentNode!.childNodes);
    let inset = 3;
    const parentNode = nodeWindow!.parentNode!;
    const floatingWindow = nodeWindow.isFloat();
    const tiledBorder = windowActor.border;

    if (parentNode.isTabbed() && nodeWindow.tab) {
      nodeWindow.tab.add_style_class_name("window-tabbed-tab-active");
    }

    const focusBorderHiddenOnSingle = host.settings.get_boolean("focus-border-hidden-on-single");
    const monitorNode = host.tree.findParent(nodeWindow!, NODE_TYPES.MONITOR);
    const tiledOnMonitor = monitorNode
      ? monitorNode
          .getNodeByMode(WINDOW_MODES.TILE)
          .filter((t: Node<any>) => t.isWindow() && !t.nodeValue.minimized)
      : [];
    const isSingleWindow = tiledOnMonitor.length === 1 && monitorCount === 1;
    const skipBorderForSingle = focusBorderHiddenOnSingle && isSingleWindow && !floatingWindow;

    if (tiledBorder && focusBorderEnabled && !skipBorderForSingle) {
      if (
        !maximized() ||
        (gap === 0 && tiledChildren.length === 1 && monitorCount > 1) ||
        (gap === 0 && tiledChildren.length > 1)
      ) {
        if (tilingModeEnabled) {
          if (parentNode.isStacked()) {
            tiledBorder.set_style_class_name(
              floatingWindow ? "window-floated-border" : "window-stacked-border"
            );
          } else if (parentNode.isTabbed()) {
            if (!floatingWindow) {
              tiledBorder.set_style_class_name("window-tabbed-border");
              if (nodeWindow.backgroundTab) tiledBorder.add_style_class_name("window-tabbed-bg");
            } else {
              tiledBorder.set_style_class_name("window-floated-border");
            }
          } else {
            tiledBorder.set_style_class_name(
              floatingWindow ? "window-floated-border" : "window-tiled-border"
            );
          }
        } else {
          tiledBorder.set_style_class_name("window-floated-border");
        }
        borders.push(tiledBorder);
      }
    }

    if (
      gap === 0 ||
      (() => {
        try {
          return metaWindow.is_maximized();
        } catch {
          return (
            (metaWindow as AnvilMetaWindow).get_maximized() === 1 ||
            (metaWindow as AnvilMetaWindow).get_maximized() === 2
          );
        }
      })()
    ) {
      inset = 0;
    }

    if (
      splitBorderEnabled &&
      focusBorderEnabled &&
      tilingModeEnabled &&
      !nodeWindow.isFloat() &&
      !maximized() &&
      parentNode.childNodes.length === 1 &&
      (parentNode.isCon() || parentNode.isMonitor()) &&
      !(parentNode.isTabbed() || parentNode.isStacked())
    ) {
      if (!windowActor.splitBorder) {
        const splitBorder = new St.Bin({ style_class: "window-split-border" });
        global.window_group.add_child(splitBorder);
        windowActor.splitBorder = splitBorder;
      }
      const splitBorder = windowActor.splitBorder;
      splitBorder.remove_style_class_name("window-split-vertical");
      splitBorder.remove_style_class_name("window-split-horizontal");
      if (parentNode.isVSplit()) splitBorder.add_style_class_name("window-split-vertical");
      else if (parentNode.isHSplit()) splitBorder.add_style_class_name("window-split-horizontal");
      borders.push(splitBorder);
    }

    const rect = metaWindow.get_frame_rect();
    borders.forEach((border) => {
      border.set_size(rect.width + inset * 2, rect.height + inset * 2);
      border.set_position(rect.x - inset, rect.y - inset);
      if (metaWindow.appears_focused && !metaWindow.minimized) border.show();
      if (global.window_group && global.window_group.contains(border)) {
        global.window_group.remove_child(border);
        global.window_group.insert_child_below(border, metaWindow.get_compositor_private());
      }
    });
  }

  updateBorderLayout() {
    if (!this.bordersEnabled()) return;
    this.hideWindowBorders();
    this.showWindowBorders();
  }
}
