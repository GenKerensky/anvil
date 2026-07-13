/**
 * BorderController — focus / split border actors (B7-2).
 *
 * Owns create/hide/show/update of tiled focus borders and split hints.
 * AnvilRuntime wires this owner behind its private composition seam.
 */

import Gio from "gi://Gio";
import Meta from "gi://Meta";
import St from "gi://St";

import { Logger } from "../shared/logger.js";
import { NODE_TYPES, type Node, type Tree } from "./tree.js";
import { WINDOW_MODES } from "./window/constants.js";
import { WindowCornerMaskEffect } from "./window-corner-mask-effect.js";
import {
  deriveWindowMaskRadius,
  getWindowMaskBounds,
  shouldMaskWindow,
} from "./window-corner-mask.js";
import type { AnvilMetaWindow, AnvilWindowActor } from "./window/types.js";

const WINDOW_MASK_EFFECT_NAME = "anvil-window-corner-mask";
const DEFAULT_BORDER_INSET = 3;

export interface BorderControllerHost {
  readonly tree: Tree;
  readonly settings: Gio.Settings;
  readonly focusMetaWindow: Meta.Window | null;
  findNodeWindow(metaWindow: Meta.Window): Node<any> | null;
}

export class BorderController {
  private _host: BorderControllerHost;
  private _maskFailureLogged = false;
  private readonly _windowActors = new Set<AnvilWindowActor>();

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
    if (!windowActor) return;
    this._windowActors.add(windowActor);
    if (!this.bordersEnabled()) return;
    if (!windowActor.border) {
      const border = new St.Bin({ style_class: "window-tiled-border" });
      if (global.window_group) global.window_group.add_child(border);
      windowActor.border = border;
      border.show();
    }
    if (!windowActor.cornerShadow) {
      const shadow = new St.Bin({ style_class: "window-unfocused-shadow" });
      if (global.window_group) global.window_group.insert_child_below(shadow, windowActor);
      windowActor.cornerShadow = shadow;
    }
    this.updateWindowMask(windowActor);
    this.updateWindowShadow(windowActor);
    this.updateWindowBorderVisibility(windowActor);
  }

  ensureAllBorderActors() {
    this._windowActors.forEach((actor) => this.ensureBorderActors(actor));
  }

  destroyAllBorderActors() {
    this._windowActors.forEach((actor) => this._removeBorderActors(actor));
  }

  destroyWindowActors(actor: AnvilWindowActor) {
    this._removeBorderActors(actor);
    this._windowActors.delete(actor);
  }

  private _removeBorderActors(actor: AnvilWindowActor) {
    this.removeWindowMask(actor);
    if (actor.border) {
      if (global.window_group) global.window_group.remove_child(actor.border);
      actor.border.hide();
      actor.border = undefined;
    }
    if (actor.cornerShadow) {
      if (global.window_group) global.window_group.remove_child(actor.cornerShadow);
      actor.cornerShadow.hide();
      actor.cornerShadow = undefined;
    }
    if (actor.splitBorder) {
      if (global.window_group) global.window_group.remove_child(actor.splitBorder);
      actor.splitBorder.hide();
      actor.splitBorder = undefined;
    }
  }

  updateWindowMask(actor: AnvilWindowActor) {
    const metaWindow = actor.get_meta_window?.() ?? actor.meta_window ?? null;
    if (!metaWindow) return;

    const maximized = this._isMaximized(metaWindow);
    const fullscreen = metaWindow.is_fullscreen();
    if (!shouldMaskWindow({ hintsEnabled: this.bordersEnabled(), maximized, fullscreen })) {
      actor.remove_effect_by_name(WINDOW_MASK_EFFECT_NAME);
      return;
    }

    try {
      let effect = actor.get_effect(WINDOW_MASK_EFFECT_NAME) as WindowCornerMaskEffect | null;
      if (!effect) {
        effect = new WindowCornerMaskEffect();
        actor.add_effect_with_name(WINDOW_MASK_EFFECT_NAME, effect);
      }

      const themeNode = actor.border?.get_theme_node();
      if (!themeNode) return;
      // ThemeNode measurements already include the theme scale factor and use the same
      // physical-pixel coordinate space as Clutter actor sizes.
      const borderRadius = themeNode.get_border_radius(St.Corner.TOPLEFT);
      const radius = deriveWindowMaskRadius(borderRadius, DEFAULT_BORDER_INSET);
      effect.update(
        getWindowMaskBounds(metaWindow.get_frame_rect(), metaWindow.get_buffer_rect()),
        radius
      );
    } catch (error) {
      actor.remove_effect_by_name(WINDOW_MASK_EFFECT_NAME);
      if (!this._maskFailureLogged) {
        Logger.warn(`window corner mask unavailable: ${error}`);
        this._maskFailureLogged = true;
      }
    }
  }

  removeWindowMask(actor: AnvilWindowActor) {
    actor.remove_effect_by_name?.(WINDOW_MASK_EFFECT_NAME);
  }

  updateWindowShadow(actor: AnvilWindowActor) {
    const shadow = actor.cornerShadow;
    const metaWindow = actor.get_meta_window?.() ?? actor.meta_window ?? null;
    if (!shadow || !metaWindow) return;

    const showShadow = shouldMaskWindow({
      hintsEnabled: this.bordersEnabled(),
      maximized: this._isMaximized(metaWindow),
      fullscreen: metaWindow.is_fullscreen(),
    });
    if (!showShadow) {
      shadow.hide();
      return;
    }

    shadow.set_style_class_name(
      this._appearsFocused(metaWindow) ? "window-focused-shadow" : "window-unfocused-shadow"
    );
    const rect = metaWindow.get_frame_rect();
    shadow.set_size(rect.width + DEFAULT_BORDER_INSET * 2, rect.height + DEFAULT_BORDER_INSET * 2);
    shadow.set_position(rect.x - DEFAULT_BORDER_INSET, rect.y - DEFAULT_BORDER_INSET);
    shadow.show();

    if (global.window_group?.contains(shadow)) {
      global.window_group.remove_child(shadow);
      global.window_group.insert_child_below(shadow, actor);
    }
  }

  private updateWindowBorderVisibility(actor: AnvilWindowActor) {
    const border = actor.border;
    const metaWindow = actor.get_meta_window?.() ?? actor.meta_window ?? null;
    if (!border || !metaWindow) return;
    const visible =
      this._host.settings.get_boolean("focus-border-toggle") &&
      !this._isMaximized(metaWindow) &&
      !metaWindow.is_fullscreen();
    if (visible) border.show();
    else border.hide();
  }

  private _isMaximized(metaWindow: Meta.Window): boolean {
    try {
      return metaWindow.is_maximized();
    } catch {
      return (metaWindow as AnvilMetaWindow).get_maximized() !== 0;
    }
  }

  private _appearsFocused(metaWindow: Meta.Window): boolean {
    const value = metaWindow.appears_focused as boolean | (() => boolean);
    return typeof value === "function" ? value.call(metaWindow) : value;
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
    const maximized = () => this._isMaximized(metaWindow) || metaWindow.is_fullscreen();
    const monitorCount = global.display.get_n_monitors();
    const inset = DEFAULT_BORDER_INSET;
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
      if (!maximized()) {
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
    this.ensureAllBorderActors();
    this.hideWindowBorders();
    this.showWindowBorders();
  }
}
