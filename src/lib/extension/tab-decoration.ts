/*
 * Tab / container decoration presentation for tree Nodes.
 *
 * St/Clutter construction lives here — not in the pure structure module (tree.ts).
 * Node keeps optional `tab` / `decoration` actor refs; create/destroy goes through these helpers.
 *
 * @see codebase-review.md F5 Stage 7, B5-1
 */

import Clutter from "gi://Clutter";
import St from "gi://St";

import * as Utils from "./utils.js";
import type { Node } from "./tree.js";

export function ensureWindowTab(node: Node<any>): void {
  if (node.tab || !node.isWindow()) return;

  const tabContents = new St.BoxLayout({
    style_class: "window-tabbed-tab",
    x_expand: true,
  });
  // Window tracker may not resolve an app for a dying window
  const app = node.app;
  if (!app) return;
  const labelText = getNodeTitle(node);
  const metaWin = node.nodeValue;
  const titleButton = new St.Button({
    x_expand: true,
    label: `${labelText}`,
  });
  const iconBin = new St.Button({
    style_class: "window-tabbed-tab-icon",
  });
  const icon = app.create_icon_texture(24 * Utils.dpi());
  iconBin.child = icon;
  const closeButton = new St.Button({
    style_class: "window-tabbed-tab-close",
    child: new St.Icon({ icon_name: "window-close-symbolic" }),
  });

  tabContents.add_child(iconBin);
  tabContents.add_child(titleButton);
  tabContents.add_child(closeButton);

  const clickFn = () => {
    if (!node.parentNode) return;
    node.parentNode.childNodes.forEach((c) => {
      if (c.tab) {
        c.tab.remove_style_class_name("window-tabbed-tab-active");
        c.render();
      }
    });
    tabContents.add_style_class_name("window-tabbed-tab-active");
    metaWin.activate(global.display.get_current_time());
  };

  const closeFn = () => {
    metaWin.delete(global.get_current_time());
  };

  const middleClickCloseFn = (_: Clutter.Actor, event: Clutter.Event) => {
    if (event.get_button() === Clutter.BUTTON_MIDDLE) {
      metaWin.delete(global.get_current_time());
    }
  };

  iconBin.connect("clicked", clickFn);
  iconBin.connect("button-release-event", middleClickCloseFn);
  titleButton.connect("clicked", clickFn);
  titleButton.connect("button-release-event", middleClickCloseFn);
  closeButton.connect("clicked", closeFn);
  closeButton.connect("button-release-event", middleClickCloseFn);

  if (metaWin === global.display.get_focus_window()) {
    tabContents.add_style_class_name("window-tabbed-tab-active");
  }
  node.tab = tabContents;
}

export function ensureConDecoration(node: Node<any>): void {
  if (node.decoration) return;
  if (!node.isCon()) return;
  const decoration = new St.BoxLayout();
  (decoration as any).type = "anvil-deco";
  (decoration as any).parentNode = node;
  const globalWinGrp = global.window_group;
  decoration.style_class = "window-tabbed-bg";

  if (!globalWinGrp.contains(decoration)) {
    globalWinGrp.add_child(decoration);
  }

  decoration.hide();
  node.decoration = decoration;
}

export function destroyConDecoration(node: Node<any>): void {
  if (!node.decoration) return;
  node.decoration.hide();
  node.decoration.destroy_all_children();
  node.decoration.destroy();
  node.decoration = null;
}

export function refreshTabTitle(node: Node<any>): void {
  if (node.tab === null || node.tab === undefined) return;
  const titleLabel = node.tab.get_child_at_index(1);
  if (titleLabel) {
    const title = getNodeTitle(node);
    if (title) (titleLabel as St.Button).label = title;
  }
}

function getNodeTitle(node: Node<any>): string | null {
  if (node.isWindow()) {
    return node.nodeValue.title ? node.nodeValue.title : node.app!.get_name();
  }
  return null;
}
