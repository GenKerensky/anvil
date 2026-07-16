/**
 * Production Tree presentation — sole owner of Shell actors associated with legacy Tree nodes.
 * Tree topology remains actor-free; this registry is wired by AnvilRuntime.
 */

import Clutter from "gi://Clutter";
import Meta from "gi://Meta";
import Shell from "gi://Shell";
import St from "gi://St";
import type ShellNS from "@girs/shell-18";

import * as Utils from "./utils.js";
import type { Node, Tree } from "./tree.js";
import type { AnvilWindowActor } from "./window/types.js";

type PresentationRecord = {
  actor: Clutter.Actor | null;
  tab: St.BoxLayout | null;
  decoration: St.BoxLayout | null;
  app: ShellNS.App | null;
};

export interface TreePresentationPort {
  ensure(node: Node): void;
  remove(node: Node): void;
  isRenderable(node: Node): boolean;
  setRect(node: Node, rect: { x: number; y: number; width: number; height: number }): void;
  clearDecoration(node: Node): void;
  hideDecoration(node: Node): void;
  showDecorationBelow(node: Node, window: Meta.Window): void;
  layoutTabbedDecoration(
    container: Node,
    child: Node,
    geometry: { x: number; y: number; width: number; height: number; visible: boolean }
  ): void;
  topBorderWidth(node: Node): number;
  refreshTabTitle(node: Node): void;
  syncActiveTab(node: Node | null): void;
  detachTab(node: Node): void;
  findWindowNodeByActor(tree: Tree, actor: Clutter.Actor): Node | null;
  destroy(): void;
}

export class TreePresentation implements TreePresentationPort {
  private readonly _records = new Map<Node, PresentationRecord>();
  private _activeTab: St.Widget | null = null;

  ensure(node: Node): void {
    if (this._records.has(node)) return;
    const record: PresentationRecord = { actor: null, tab: null, decoration: null, app: null };
    this._records.set(node, record);

    if (node.isWindow()) {
      const window = node.nodeValue as Meta.Window;
      record.actor = window.get_compositor_private();
      record.app = Shell.WindowTracker.get_default().get_window_app(window) as ShellNS.App | null;
      if (record.app) record.tab = this._createWindowTab(node, record.app);
      if (window === global.display.get_focus_window()) this.syncActiveTab(node);
      return;
    }

    if (node.isCon()) {
      const decoration = new St.BoxLayout({ style_class: "window-tabbed-bg" });
      decoration.hide();
      global.window_group.add_child(decoration);
      record.actor = decoration;
      record.decoration = decoration;
      return;
    }

    const styleClass = node.isWorkspace() ? "workspace-actor-bg" : undefined;
    const actor = new St.Bin(styleClass ? { style_class: styleClass } : undefined);
    global.window_group.add_child(actor);
    record.actor = actor;
  }

  remove(node: Node): void {
    const record = this._records.get(node);
    if (!record) return;
    if (this._activeTab === record.tab) this.syncActiveTab(null);
    if (record.tab) {
      const parent = record.tab.get_parent();
      if (parent) parent.remove_child(record.tab);
      record.tab.destroy();
    }
    if (record.actor && !node.isWindow()) {
      if (global.window_group.contains(record.actor))
        global.window_group.remove_child(record.actor);
      record.actor.destroy();
    }
    this._records.delete(node);
  }

  private _actor(node: Node): Clutter.Actor | null {
    const record = this._records.get(node);
    if (!record) return null;
    if (node.isWindow()) {
      try {
        // Mutter owns window actors and may dispose one before WindowTracker removes
        // the corresponding structural node. Never retain a compositor actor across
        // calls; ask Meta.Window for the current mapped actor instead.
        record.actor = (node.nodeValue as Meta.Window).get_compositor_private();
      } catch {
        record.actor = null;
      }
    }
    return record.actor;
  }

  isRenderable(node: Node): boolean {
    if (!node.isWindow()) return true;
    try {
      const actor = this._actor(node);
      if (!actor) return false;
      actor.get_name();
      return true;
    } catch {
      return false;
    }
  }

  setRect(node: Node, rect: { x: number; y: number; width: number; height: number }): void {
    if (node.isWindow()) return;
    const actor = this._actor(node);
    actor?.set_size(rect.width, rect.height);
    actor?.set_position(rect.x, rect.y);
  }

  clearDecoration(node: Node): void {
    const decoration = this._records.get(node)?.decoration;
    if (!decoration) return;
    for (const child of decoration.get_children()) decoration.remove_child(child);
  }

  hideDecoration(node: Node): void {
    this._records.get(node)?.decoration?.hide();
  }

  showDecorationBelow(node: Node, window: Meta.Window): void {
    const decoration = this._records.get(node)?.decoration;
    if (!decoration) return;
    decoration.show();
    if (global.window_group.contains(decoration)) global.window_group.remove_child(decoration);
    global.window_group.insert_child_below(decoration, window.get_compositor_private());
  }

  layoutTabbedDecoration(
    container: Node,
    child: Node,
    geometry: { x: number; y: number; width: number; height: number; visible: boolean }
  ): void {
    const decoration = this._records.get(container)?.decoration;
    const tab = this._records.get(child)?.tab;
    if (!decoration) return;
    decoration.set_size(geometry.width, geometry.height);
    decoration.set_position(geometry.x, geometry.y);
    if (geometry.visible) decoration.show();
    else decoration.hide();
    if (tab && !decoration.contains(tab)) {
      try {
        decoration.add_child(tab);
      } catch {
        // A tab may be disposed between layout and presentation reconciliation.
      }
    }
  }

  topBorderWidth(node: Node): number {
    try {
      const actor = this._actor(node) as AnvilWindowActor | null;
      return actor?.border?.get_theme_node().get_border_width(St.Side.TOP) ?? 0;
    } catch {
      return 0;
    }
  }

  refreshTabTitle(node: Node): void {
    const tab = this._records.get(node)?.tab;
    const titleLabel = tab?.get_child_at_index(1);
    if (!titleLabel || !node.isWindow()) return;
    const record = this._records.get(node)!;
    const window = node.nodeValue as Meta.Window;
    (titleLabel as St.Button).label = window.title || record.app?.get_name() || "";
  }

  syncActiveTab(node: Node | null): void {
    const next = node?.parentNode?.isTabbed() ? this._records.get(node)?.tab ?? null : null;
    if (this._activeTab === next) return;
    try {
      this._activeTab?.remove_style_class_name("window-tabbed-tab-active");
    } catch {
      // The old tab can disappear with its window before focus reconciliation.
    }
    this._activeTab = next;
    this._activeTab?.add_style_class_name("window-tabbed-tab-active");
  }

  detachTab(node: Node): void {
    const tab = this._records.get(node)?.tab;
    const parent = tab?.get_parent();
    if (tab && parent) parent.remove_child(tab);
  }

  findWindowNodeByActor(tree: Tree, actor: Clutter.Actor): Node | null {
    return tree.nodeWindows.find((node) => this._actor(node) === actor) ?? null;
  }

  destroy(): void {
    this.syncActiveTab(null);
    for (const node of [...this._records.keys()]) this.remove(node);
  }

  private _createWindowTab(node: Node, app: ShellNS.App): St.BoxLayout {
    const window = node.nodeValue as Meta.Window;
    const tab = new St.BoxLayout({ style_class: "window-tabbed-tab", x_expand: true });
    const iconButton = new St.Button({ style_class: "window-tabbed-tab-icon" });
    iconButton.child = app.create_icon_texture(24 * Utils.dpi());
    const titleButton = new St.Button({ x_expand: true, label: window.title || app.get_name() });
    const closeButton = new St.Button({
      style_class: "window-tabbed-tab-close",
      child: new St.Icon({ icon_name: "window-close-symbolic" }),
    });
    tab.add_child(iconButton);
    tab.add_child(titleButton);
    tab.add_child(closeButton);

    const activate = () => {
      this.syncActiveTab(node);
      window.activate(global.display.get_current_time());
    };
    const close = () => window.delete(global.get_current_time());
    const middleClose = (_actor: Clutter.Actor, event: Clutter.Event) => {
      if (event.get_button() === Clutter.BUTTON_MIDDLE) close();
    };
    iconButton.connect("clicked", activate);
    iconButton.connect("button-release-event", middleClose);
    titleButton.connect("clicked", activate);
    titleButton.connect("button-release-event", middleClose);
    closeButton.connect("clicked", close);
    closeButton.connect("button-release-event", middleClose);
    return tab;
  }
}

/** Sole owner of the legacy drag-preview actor. */
export class DragPreviewPresenter {
  private _actor: St.Bin | null = null;

  show(className: string, rect: { x: number; y: number; width: number; height: number }): void {
    if (!this._actor) {
      this._actor = new St.Bin();
      global.window_group.add_child(this._actor);
    }
    this._actor.set_style_class_name(className);
    this._actor.set_position(rect.x, rect.y);
    this._actor.set_size(rect.width, rect.height);
    this._actor.show();
  }

  hide(): void {
    this._actor?.hide();
  }

  destroy(): void {
    if (!this._actor) return;
    if (global.window_group.contains(this._actor)) global.window_group.remove_child(this._actor);
    this._actor.destroy();
    this._actor = null;
  }
}
