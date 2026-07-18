/**
 * BorderController — lifecycle owner for window decoration actors.
 *
 * Focus and split hints are singletons moved between windows. Rounded masks
 * remove the source shadow plate, then one per-window Clutter child paints the
 * replacement shadow below the surface. Parenting the shadow to its compositor
 * actor gives it the same workspace visibility and lifetime. Focus and split
 * hints stay in a contiguous chain above that compositor actor so its shadow
 * cannot dim their strokes. All state application is idempotent.
 */

import Gio from "gi://Gio";
import Meta from "gi://Meta";
import St from "gi://St";
import Clutter from "gi://Clutter";

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

interface DecorationRecord {
  readonly window: Meta.Window;
  readonly actor: AnvilWindowActor;
  maskTarget: Clutter.Actor | null;
  maskTargetDestroyId: number | null;
  shadow: St.Bin | null;
}

export interface BorderControllerHost {
  readonly tree: Tree;
  readonly settings: Gio.Settings;
  readonly focusMetaWindow: Meta.Window | null;
  findNodeWindow(metaWindow: Meta.Window): Node | null;
}

export class BorderController {
  private readonly _records = new Map<Meta.Window, DecorationRecord>();
  private _activeWindow: Meta.Window | null = null;
  private _focusBorder: St.Bin | null = null;
  private _splitBorder: St.Bin | null = null;
  private _focusOwner: AnvilWindowActor | null = null;
  private _splitOwner: AnvilWindowActor | null = null;
  private _maskFailureLogged = false;

  constructor(private readonly _host: BorderControllerHost) {}

  bordersEnabled(): boolean {
    const settings = this._host.settings;
    return (
      settings.get_boolean("focus-border-toggle") || settings.get_boolean("split-border-toggle")
    );
  }

  registerWindow(metaWindow: Meta.Window, actor: AnvilWindowActor): void {
    const existing = this._records.get(metaWindow);
    if (existing?.actor === actor) {
      this.reconcileWindow(metaWindow);
      if (this._host.focusMetaWindow === metaWindow) this.setActiveWindow(metaWindow);
      return;
    }
    if (existing) this.unregisterWindow(metaWindow);

    this._records.set(metaWindow, {
      window: metaWindow,
      actor,
      maskTarget: null,
      maskTargetDestroyId: null,
      shadow: null,
    });
    this.reconcileWindow(metaWindow);
    if (this._host.focusMetaWindow === metaWindow) this.setActiveWindow(metaWindow);
  }

  unregisterWindow(metaWindow: Meta.Window, actorDestroyed = false): void {
    const record = this._records.get(metaWindow);
    if (!record) return;
    this._records.delete(metaWindow);
    if (this._activeWindow === metaWindow) {
      if (actorDestroyed) {
        this._activeWindow = null;
        this._setVisible(this._focusBorder, false);
        this._setVisible(this._splitBorder, false);
        this._focusOwner = null;
        this._splitOwner = null;
      } else {
        this.setActiveWindow(null);
      }
    }
    this._destroyWindowShadow(record, actorDestroyed);
    // Mutter has already disposed the surface and its effects by the actor's
    // destroy signal. The earlier `unmanaged` path performs explicit removal;
    // touching either GObject here would itself trigger a GJS critical.
    if (actorDestroyed) {
      record.maskTarget = null;
      record.maskTargetDestroyId = null;
      return;
    }
    this._detachMaskTarget(record);
    record.actor.border = undefined;
    record.actor.splitBorder = undefined;
  }

  setActiveWindow(nextWindow: Meta.Window | null): void {
    const next = nextWindow && this._records.has(nextWindow) ? nextWindow : null;
    const previous = this._activeWindow;
    if (previous === next) return;

    if (previous) {
      const previousRecord = this._records.get(previous);
      this._detachSingletons(previousRecord?.actor);
      if (previousRecord) {
        this._reconcileWindowShadow(previousRecord, this._isDrawable(previousRecord.window), false);
      }
    }
    this._activeWindow = next;
    if (next) this.reconcileActiveWindow();
    else this._hideSingletonHints();
  }

  reconcileWindow(metaWindow: Meta.Window): void {
    const record = this._records.get(metaWindow);
    if (!record) return;
    const active = metaWindow === this._activeWindow;
    const drawable = this._isDrawable(metaWindow);

    this._reconcileMask(record, drawable);
    this._reconcileWindowShadow(record, drawable, active);
    if (active) this._reconcileSingletonHints(record, drawable);
    this._reconcileStack(record, active);
  }

  reconcileActiveWindow(): void {
    if (!this._activeWindow) {
      this._hideSingletonHints();
      return;
    }
    const record = this._records.get(this._activeWindow);
    if (!record) {
      this._hideSingletonHints();
      return;
    }
    this._reconcileWindowShadow(record, this._isDrawable(record.window), true);
    this._reconcileSingletonHints(record, this._isDrawable(record.window));
    this._reconcileStack(record, true);
  }

  reconcileAll(): void {
    const focused = this._host.focusMetaWindow;
    if (focused !== this._activeWindow) this.setActiveWindow(focused);
    for (const metaWindow of this._records.keys()) this.reconcileWindow(metaWindow);
  }

  suspendAll(): void {
    this._hideSingletonHints();
    for (const record of this._records.values()) {
      this._removeWindowMask(record);
      this._setVisible(record.shadow, false);
    }
  }

  destroy(): void {
    this._activeWindow = null;
    for (const record of [...this._records.values()]) this.unregisterWindow(record.window);
    if (this._focusBorder) this._removeActor(this._focusBorder);
    if (this._splitBorder) this._removeActor(this._splitBorder);
    this._focusBorder = null;
    this._splitBorder = null;
    this._focusOwner = null;
    this._splitOwner = null;
  }

  private _reconcileMask(record: DecorationRecord, drawable: boolean): void {
    const target = this._getWindowSurfaceActor(record);
    if (record.maskTarget !== target) {
      this._detachMaskTarget(record);
      record.maskTarget = target;
      if (target) {
        record.maskTargetDestroyId = target.connect("destroy", () => {
          if (record.maskTarget !== target) return;
          record.maskTarget = null;
          record.maskTargetDestroyId = null;
        });
      }
    }
    if (!drawable || !target) {
      this._removeWindowMask(record);
      return;
    }
    try {
      let effect = target.get_effect(WINDOW_MASK_EFFECT_NAME) as WindowCornerMaskEffect | null;
      if (!effect) {
        effect = new WindowCornerMaskEffect();
        target.add_effect_with_name(WINDOW_MASK_EFFECT_NAME, effect);
      }
      const themeNode = this._ensureFocusBorder().get_theme_node();
      const radius = deriveWindowMaskRadius(
        themeNode.get_border_radius(St.Corner.TOPLEFT),
        DEFAULT_BORDER_INSET
      );
      effect.update(
        getWindowMaskBounds(record.window.get_frame_rect(), record.window.get_buffer_rect()),
        radius
      );
    } catch (error) {
      this._removeWindowMask(record);
      if (!this._maskFailureLogged) {
        Logger.warn(`window corner mask unavailable: ${error}`);
        this._maskFailureLogged = true;
      }
    }
  }

  private _reconcileSingletonHints(record: DecorationRecord, drawable: boolean): void {
    const metaWindow = record.window;
    const nodeWindow = this._host.findNodeWindow(metaWindow);
    if (!drawable) {
      this._hideSingletonHints();
      return;
    }

    if (!nodeWindow) {
      const focusBorder = this._ensureFocusBorder();
      if (this._host.settings.get_boolean("focus-border-toggle")) {
        this._setStyle(focusBorder, "window-tiled-border");
        this._setFrameGeometry(focusBorder, metaWindow.get_frame_rect());
        this._setVisible(focusBorder, true);
        this._setFocusOwner(record.actor);
      } else {
        this._setVisible(focusBorder, false);
        this._setFocusOwner(null);
      }
      if (this._splitBorder) this._setVisible(this._splitBorder, false);
      this._setSplitOwner(null);
      return;
    }

    const parentNode = nodeWindow.parentNode!;
    const floating = nodeWindow.isFloat();
    const settings = this._host.settings;
    const focusBorder = this._ensureFocusBorder();
    const focusEnabled = settings.get_boolean("focus-border-toggle");
    const tilingEnabled = settings.get_boolean("tiling-mode-enabled");
    const monitorNode = this._host.tree.findParent(nodeWindow, NODE_TYPES.MONITOR);
    const tiledOnMonitor = monitorNode
      ? monitorNode
          .getNodeByMode(WINDOW_MODES.TILE)
          .filter((node: Node) => node.isWindow() && !node.nodeValue.minimized)
      : [];
    const hideSingle =
      settings.get_boolean("focus-border-hidden-on-single") &&
      tiledOnMonitor.length === 1 &&
      global.display.get_n_monitors() === 1 &&
      !floating;

    if (focusEnabled && !hideSingle) {
      let style = "window-tiled-border";
      if (!tilingEnabled || floating) style = "window-floated-border";
      else if (parentNode.isStacked()) style = "window-stacked-border";
      else if (parentNode.isTabbed()) style = "window-tabbed-border";
      this._setStyle(focusBorder, style);
      this._setFrameGeometry(focusBorder, metaWindow.get_frame_rect());
      this._setVisible(focusBorder, true);
      this._setFocusOwner(record.actor);
    } else {
      this._setVisible(focusBorder, false);
      this._setFocusOwner(null);
    }

    const splitBorder = this._ensureSplitBorder();
    const showSplit =
      settings.get_boolean("split-border-toggle") &&
      focusEnabled &&
      tilingEnabled &&
      !floating &&
      parentNode.childNodes.length === 1 &&
      (parentNode.isCon() || parentNode.isMonitor()) &&
      !(parentNode.isTabbed() || parentNode.isStacked());
    if (showSplit) {
      const splitStyle = parentNode.isVSplit()
        ? "window-split-border window-split-vertical"
        : "window-split-border window-split-horizontal";
      this._setStyle(splitBorder, splitStyle);
      this._setFrameGeometry(splitBorder, metaWindow.get_frame_rect());
      this._setVisible(splitBorder, true);
      this._setSplitOwner(record.actor);
    } else {
      this._setVisible(splitBorder, false);
      this._setSplitOwner(null);
    }
  }

  private _reconcileWindowShadow(
    record: DecorationRecord,
    drawable: boolean,
    active: boolean
  ): void {
    const surface = record.maskTarget;
    if (!drawable || !surface) {
      this._setVisible(record.shadow, false);
      return;
    }
    if (!record.shadow) {
      record.shadow = new St.Bin({ style_class: "window-unfocused-shadow" });
      record.actor.cornerShadow = record.shadow;
      record.actor.add_child(record.shadow);
    }
    this._setStyle(record.shadow, active ? "window-focused-shadow" : "window-unfocused-shadow");
    this._setWindowLocalFrameGeometry(
      record.shadow,
      record.window.get_frame_rect(),
      record.window.get_buffer_rect()
    );
    this._setVisible(record.shadow, true);
    record.actor.set_child_below_sibling(record.shadow, surface);
  }

  private _ensureFocusBorder(): St.Bin {
    if (!this._focusBorder) {
      this._focusBorder = new St.Bin({ style_class: "window-tiled-border" });
      this._focusBorder.hide();
      global.window_group?.add_child(this._focusBorder);
    }
    return this._focusBorder;
  }

  private _ensureSplitBorder(): St.Bin {
    if (!this._splitBorder) {
      this._splitBorder = new St.Bin({ style_class: "window-split-border" });
      this._splitBorder.hide();
      global.window_group?.add_child(this._splitBorder);
    }
    return this._splitBorder;
  }

  private _hideSingletonHints(): void {
    if (this._focusBorder) this._setVisible(this._focusBorder, false);
    if (this._splitBorder) this._setVisible(this._splitBorder, false);
    this._setFocusOwner(null);
    this._setSplitOwner(null);
  }

  private _detachSingletons(actor: AnvilWindowActor | undefined): void {
    if (!actor) return;
    if (actor === this._focusOwner) this._setFocusOwner(null);
    if (actor === this._splitOwner) this._setSplitOwner(null);
  }

  private _setFocusOwner(actor: AnvilWindowActor | null): void {
    if (this._focusOwner === actor) return;
    if (this._focusOwner?.border === this._focusBorder) this._focusOwner.border = undefined;
    this._focusOwner = actor;
    if (actor && this._focusBorder) actor.border = this._focusBorder;
  }

  private _setSplitOwner(actor: AnvilWindowActor | null): void {
    if (this._splitOwner === actor) return;
    if (this._splitOwner?.splitBorder === this._splitBorder) {
      this._splitOwner.splitBorder = undefined;
    }
    this._splitOwner = actor;
    if (actor && this._splitBorder) actor.splitBorder = this._splitBorder;
  }

  private _reconcileStack(record: DecorationRecord, active: boolean): void {
    let sibling: Clutter.Actor = record.actor;
    const actors = active ? [this._splitBorder, this._focusBorder] : [];
    for (const actor of actors) {
      if (!actor?.visible) continue;
      this._stackAbove(actor, sibling);
      sibling = actor;
    }
  }

  private _setFrameGeometry(
    actor: St.Bin,
    rect: { x: number; y: number; width: number; height: number }
  ): void {
    const width = rect.width + DEFAULT_BORDER_INSET * 2;
    const height = rect.height + DEFAULT_BORDER_INSET * 2;
    const x = rect.x - DEFAULT_BORDER_INSET;
    const y = rect.y - DEFAULT_BORDER_INSET;
    if (actor.width !== width || actor.height !== height) actor.set_size(width, height);
    if (actor.x !== x || actor.y !== y) actor.set_position(x, y);
  }

  private _setWindowLocalFrameGeometry(
    actor: St.Bin,
    frame: { x: number; y: number; width: number; height: number },
    buffer: { x: number; y: number }
  ): void {
    const width = frame.width + DEFAULT_BORDER_INSET * 2;
    const height = frame.height + DEFAULT_BORDER_INSET * 2;
    const x = frame.x - buffer.x - DEFAULT_BORDER_INSET;
    const y = frame.y - buffer.y - DEFAULT_BORDER_INSET;
    if (actor.width !== width || actor.height !== height) actor.set_size(width, height);
    if (actor.x !== x || actor.y !== y) actor.set_position(x, y);
  }

  private _setStyle(actor: St.Widget, style: string): void {
    if (actor.style_class !== style) actor.set_style_class_name(style);
  }

  private _setVisible(actor: Clutter.Actor | null, visible: boolean): void {
    if (!actor) return;
    if (actor.visible === visible) return;
    if (visible) actor.show();
    else actor.hide();
  }

  private _stackAbove(actor: Clutter.Actor, sibling: Clutter.Actor): void {
    if (!global.window_group?.contains(actor)) return;
    if (actor.get_previous_sibling?.() === sibling) return;
    global.window_group.set_child_above_sibling(actor, sibling);
  }

  private _removeWindowMask(record: DecorationRecord): void {
    if (record.maskTarget?.get_effect(WINDOW_MASK_EFFECT_NAME)) {
      record.maskTarget.remove_effect_by_name(WINDOW_MASK_EFFECT_NAME);
    }
  }

  private _detachMaskTarget(record: DecorationRecord): void {
    this._removeWindowMask(record);
    if (record.maskTarget && record.maskTargetDestroyId !== null) {
      record.maskTarget.disconnect(record.maskTargetDestroyId);
    }
    record.maskTarget = null;
    record.maskTargetDestroyId = null;
  }

  private _destroyWindowShadow(record: DecorationRecord, actorDestroyed: boolean): void {
    const shadow = record.shadow;
    if (!shadow) return;
    record.shadow = null;
    // A shadow child is destroyed with its compositor actor. Avoid touching
    // either disposed GObject from the actor's destroy callback.
    if (actorDestroyed) return;
    if (record.actor.cornerShadow === shadow) {
      record.actor.cornerShadow = undefined;
    }
    this._removeActor(shadow);
  }

  private _getWindowSurfaceActor(record: DecorationRecord): Clutter.Actor | null {
    // Meta.WindowActor.get_texture() returns Meta.ShapedTexture (Clutter.Content),
    // which cannot own a Clutter.Effect. Mutter's non-shadow child is the
    // surface actor. Its mask removes source shadow pixels before the rounded
    // child shadow is painted. Fail open if that scene-graph contract no longer
    // yields a Clutter actor.
    const target =
      record.actor.get_children?.().find((child) => child !== record.shadow) ??
      record.actor.get_first_child?.() ??
      null;
    return target instanceof Clutter.Actor ? target : null;
  }

  private _removeActor(actor: Clutter.Actor): void {
    const parent =
      actor.get_parent?.() ?? (actor as Clutter.Actor & { _parent?: Clutter.Actor })._parent;
    if (parent && "remove_child" in parent) parent.remove_child(actor);
    this._setVisible(actor, false);
    actor.destroy();
  }

  private _isMaximized(metaWindow: Meta.Window): boolean {
    try {
      return metaWindow.is_maximized();
    } catch {
      return (metaWindow as AnvilMetaWindow).get_maximized() !== 0;
    }
  }

  private _isDrawable(metaWindow: Meta.Window): boolean {
    const showing = metaWindow.showing_on_its_workspace?.() ?? true;
    return (
      showing &&
      !metaWindow.minimized &&
      shouldMaskWindow({
        hintsEnabled: this.bordersEnabled(),
        maximized: this._isMaximized(metaWindow),
        fullscreen: metaWindow.is_fullscreen(),
      })
    );
  }
}
