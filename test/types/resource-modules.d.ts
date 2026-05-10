// @girs/gnome-shell provides a declaration for resource:///org/gnome/shell/misc/config.js
// but NOT for the uppercase-Shell Extensions gresource path used by preferences code.
// This file fills that gap.
declare module "resource:///org/gnome/Shell/Extensions/js/misc/config.js" {
  export * from "@girs/gnome-shell/misc/config";
}
