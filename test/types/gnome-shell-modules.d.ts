/**
 * Path shims for resource:/// imports used in GJS test files.
 *
 * @girs/gnome-shell exports Shell module types at the @girs/gnome-shell
 * package path, but the GJS import uses resource:// URIs. These shims
 * redirect those URIs to the corresponding @girs declarations.
 */
declare module "resource:///org/gnome/shell/ui/main.js" {
  export * from "@girs/gnome-shell/ui/main";
}
