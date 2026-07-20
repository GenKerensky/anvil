#!/usr/bin/gjs -m

/* global ARGV */

import Gdk from "gi://Gdk?version=4.0";
import Gio from "gi://Gio";
import Gtk from "gi://Gtk?version=4.0";

const iconRoot = ARGV[0];
if (!iconRoot) throw new Error("preferences icon root argument is required");

Gtk.init();
const display = Gdk.Display.get_default();
if (!display) throw new Error("GTK did not connect to the nested display");

const iconTheme = Gtk.IconTheme.get_for_display(display);
iconTheme.add_search_path(iconRoot);

const packagedIcons = [
  {
    name: "org.gnome.shell.extensions.anvil-symbolic",
    path: "hicolor/symbolic/apps/org.gnome.shell.extensions.anvil-symbolic.svg",
    flags: Gtk.IconLookupFlags.FORCE_SYMBOLIC,
  },
  {
    name: "anvil-grid-symbolic",
    path: "hicolor/scalable/actions/anvil-grid-symbolic.svg",
    flags: Gtk.IconLookupFlags.FORCE_SYMBOLIC,
  },
  {
    name: "org.gnome.shell.extensions.anvil-regular",
    path: "hicolor/scalable/apps/org.gnome.shell.extensions.anvil-regular.svg",
    flags: Gtk.IconLookupFlags.FORCE_REGULAR,
  },
];

const systemIcons = [
  "preferences-desktop-appearance-symbolic",
  "dialog-warning-symbolic",
  "input-keyboard-symbolic",
  "focus-windows-symbolic",
  "video-display-symbolic",
  "help-about-symbolic",
  "edit-clear-symbolic",
  "list-add-symbolic",
  "selection-mode-symbolic",
  "edit-undo-symbolic",
  "edit-delete-symbolic",
];

const removedPackagedIcons = [
  "anvil-logo-symbolic",
  "brush-symbolic",
  "bug-symbolic",
  "forge-logo-symbolic",
  "input-keyboard-symbolic",
  "view-grid-symbolic",
  "window-symbolic",
];

/**
 * @param {string} iconName
 * @param {Gtk.IconLookupFlags} flags
 */
function resolveIcon(iconName, flags) {
  if (!iconTheme.has_icon(iconName)) {
    throw new Error(`GTK could not resolve ${iconName}`);
  }
  const paintable = iconTheme.lookup_icon(iconName, null, 32, 1, Gtk.TextDirection.NONE, flags);
  const resolvedFile = paintable.get_file()?.get_path();
  if (!resolvedFile) throw new Error(`GTK did not render ${iconName}`);
}

for (const icon of packagedIcons) {
  const packagedIcon = Gio.File.new_for_path(`${iconRoot}/${icon.path}`);
  if (!packagedIcon.query_exists(null)) {
    throw new Error(`installed payload is missing ${icon.name}`);
  }
  resolveIcon(icon.name, icon.flags);
}

for (const iconName of removedPackagedIcons) {
  const packagedIcon = Gio.File.new_for_path(
    `${iconRoot}/hicolor/scalable/actions/${iconName}.svg`
  );
  if (packagedIcon.query_exists(null)) {
    throw new Error(`installed payload should not package ${iconName}`);
  }
}

for (const iconName of systemIcons) {
  resolveIcon(iconName, Gtk.IconLookupFlags.FORCE_SYMBOLIC);
}

print(
  `resolved ${packagedIcons.length} packaged and ${systemIcons.length} system preference icons`
);
