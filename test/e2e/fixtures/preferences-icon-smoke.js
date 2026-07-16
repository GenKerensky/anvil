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

const iconNames = [
  "anvil-logo-symbolic",
  "brush-symbolic",
  "bug-symbolic",
  "input-keyboard-symbolic",
  "view-grid-symbolic",
  "window-symbolic",
];

for (const iconName of iconNames) {
  const packagedIcon = Gio.File.new_for_path(
    `${iconRoot}/hicolor/scalable/actions/${iconName}.svg`
  );
  if (!packagedIcon.query_exists(null)) {
    throw new Error(`installed payload is missing ${iconName}`);
  }
  if (!iconTheme.has_icon(iconName)) {
    throw new Error(`GTK could not resolve ${iconName}`);
  }
  const paintable = iconTheme.lookup_icon(
    iconName,
    null,
    32,
    1,
    Gtk.TextDirection.NONE,
    Gtk.IconLookupFlags.FORCE_SYMBOLIC
  );
  const resolvedFile = paintable.get_file()?.get_path();
  if (!resolvedFile) throw new Error(`GTK did not render ${iconName}`);
}

print(`resolved ${iconNames.length} installed preference icons`);
