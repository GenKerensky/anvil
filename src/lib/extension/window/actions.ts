/**
 * Typed user actions for WindowManager.command().
 *
 * All keybindings, tests, and internal command re-entry must build AnvilAction
 * values. Dispatch is via the in-WM handler registry — do not add a mega-switch.
 *
 * @see .agents/rules/architecture.md (rule 3: commands are data)
 */

/** Float / tile toggle family (shared payload for rect placement). */
export type FloatAction = {
  name: "FloatToggle" | "FloatClassToggle" | "FloatNonPersistentToggle";
  /** Optional mode hint; runtime accepts both "float" and WINDOW_MODES values. */
  mode?: string;
  x?: number | string;
  y?: number | string;
  width?: number | string;
  height?: number | string;
};

export type DirectionAction = {
  name: "Move" | "Focus" | "Swap";
  /** Direction string; resolveDirection uppercases (e.g. "Left" / "LEFT"). */
  direction: string;
};

export type SplitAction = {
  name: "Split";
  orientation?: string;
};

export type GapSizeAction = {
  name: "GapSize";
  amount: number;
};

export type SnapLayoutMoveAction = {
  name: "SnapLayoutMove";
  direction: string;
  /** Fraction of workarea for LEFT/RIGHT snaps; omitted for CENTER. */
  amount?: number;
};

export type WindowResizeAction = {
  name: "WindowResizeLeft" | "WindowResizeRight" | "WindowResizeTop" | "WindowResizeBottom";
  amount: number;
};

export type NamelessAction = {
  name:
    | "LayoutToggle"
    | "LayoutStackedToggle"
    | "LayoutTabbedToggle"
    | "ShowTabDecorationToggle"
    | "FocusBorderToggle"
    | "TilingModeToggle"
    | "WorkspaceActiveTileToggle"
    | "WindowClose"
    | "PrefsOpen"
    | "CancelOperation"
    | "WindowSwapLastActive";
};

/**
 * Discriminated union of all commands accepted by WindowManager.command().
 * Extend this union when adding a handler — do not pass untyped objects.
 */
export type AnvilAction =
  | FloatAction
  | DirectionAction
  | SplitAction
  | GapSizeAction
  | SnapLayoutMoveAction
  | WindowResizeAction
  | NamelessAction;

export type AnvilActionName = AnvilAction["name"];
