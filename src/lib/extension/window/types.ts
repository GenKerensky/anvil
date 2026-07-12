import Clutter from "gi://Clutter";
import Meta from "gi://Meta";
import St from "gi://St";

export type AnvilExtension = import("../../../extension.js").default;

// Runtime-monkey-patched Meta types — these properties are set by anvil at runtime
// and are not present in @girs type declarations.
export type AnvilMetaWindow = Meta.Window & {
  windowSignals?: number[];
  pendingWindowSignals?: number[];
  pendingActorSignals?: number[];
  firstRender?: boolean;
  /** @deprecated pre-GNOME 49 fallback, removed from @girs types */
  get_maximized(): number;
};
export type AnvilWindowActor = Clutter.Actor & {
  readonly meta_window?: Meta.Window | null;
  get_meta_window?(): Meta.Window | null;
  actorSignals?: number[];
  border?: St.Bin;
  splitBorder?: St.Bin;
};
export type AnvilMetaWorkspace = Meta.Workspace & {
  workspaceSignals?: number[];
};
