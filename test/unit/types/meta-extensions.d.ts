/**
 * Type augmentations for anvil's monkey-patched properties on GObject instances.
 *
 * Anvil stores custom data on Meta.Window, Meta.WindowActor, Meta.Workspace, and
 * tree Node objects by assigning properties at runtime (e.g. `metaWindow.firstRender = true`).
 * These properties don't exist in the @girs type declarations, so we augment the
 * interfaces here to make them visible to TypeScript.
 *
 * All properties are optional (`?`) because they're only present after anvil
 * assigns them, not during GNOME Shell's normal lifecycle.
 */

declare module "gi://Meta" {
  interface Window {
    /** Signal handler IDs for window event listeners (position-changed, size-changed, etc.) */
    windowSignals?: number[];
    /** True after the first render pass for this window */
    firstRender?: boolean;
  }

  interface WindowActor {
    /** Signal handler IDs for actor event listeners (destroy, etc.) */
    actorSignals?: number[];
    /** Focus hint border St.Bin */
    border?: import("gi://St").Bin;
    /** Rounded shadow rendered below the masked window */
    cornerShadow?: import("gi://St").Bin;
    /** Split direction hint border St.Bin */
    splitBorder?: import("gi://St").Bin;
  }

  interface Workspace {
    /** Signal handler IDs for workspace event listeners */
    workspaceSignals?: number[];
  }
}
