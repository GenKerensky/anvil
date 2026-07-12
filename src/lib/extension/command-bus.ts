/**
 * CommandBus — AnvilAction registry (B3-1, B10-2).
 *
 * Named command table (Hyprland dispatcher style). Handlers are registered by
 * name; AnvilRuntime wires host methods. Keybindings build AnvilAction values
 * and call dispatch — no mega-switch.
 *
 * @see codebase-review.md F5 Stage 1 residual, architecture rule 3
 */

import type {
  AnvilAction,
  AnvilActionName,
  DirectionAction,
  FloatAction,
  GapSizeAction,
  SnapLayoutMoveAction,
  SplitAction,
  WindowResizeAction,
} from "./window/actions.js";

/** Host surface required to implement all command handlers. */
export interface CommandBusHost {
  handleFloat(action: FloatAction): void;
  handleMove(action: DirectionAction): void;
  handleFocus(action: DirectionAction): void;
  handleSwap(action: DirectionAction): void;
  handleSplit(action: SplitAction): void;
  handleLayoutToggle(): void;
  handleFocusBorderToggle(): void;
  handleTilingModeToggle(): void;
  handleGapSize(action: GapSizeAction): void;
  handleWorkspaceActiveTileToggle(): void;
  handleLayoutStackedToggle(): void;
  handleLayoutTabbedToggle(): void;
  handleCancelOperation(): void;
  handlePrefsOpen(): void;
  handleWindowSwapLastActive(): void;
  handleSnapLayoutMove(action: SnapLayoutMoveAction): void;
  handleShowTabDecorationToggle(): void;
  handleWindowResize(action: WindowResizeAction): void;
  handleWindowClose(): void;
}

type HandlerMap = {
  [K in AnvilActionName]: (action: Extract<AnvilAction, { name: K }>) => void;
};

export class CommandBus {
  private _handlers: HandlerMap;

  constructor(host: CommandBusHost) {
    this._handlers = {
      FloatToggle: (a) => host.handleFloat(a),
      FloatClassToggle: (a) => host.handleFloat(a),
      FloatNonPersistentToggle: (a) => host.handleFloat(a),
      Move: (a) => host.handleMove(a),
      Focus: (a) => host.handleFocus(a),
      Swap: (a) => host.handleSwap(a),
      Split: (a) => host.handleSplit(a),
      LayoutToggle: () => host.handleLayoutToggle(),
      FocusBorderToggle: () => host.handleFocusBorderToggle(),
      TilingModeToggle: () => host.handleTilingModeToggle(),
      GapSize: (a) => host.handleGapSize(a),
      WorkspaceActiveTileToggle: () => host.handleWorkspaceActiveTileToggle(),
      LayoutStackedToggle: () => host.handleLayoutStackedToggle(),
      LayoutTabbedToggle: () => host.handleLayoutTabbedToggle(),
      CancelOperation: () => host.handleCancelOperation(),
      PrefsOpen: () => host.handlePrefsOpen(),
      WindowSwapLastActive: () => host.handleWindowSwapLastActive(),
      SnapLayoutMove: (a) => host.handleSnapLayoutMove(a),
      ShowTabDecorationToggle: () => host.handleShowTabDecorationToggle(),
      WindowResize: (a) => host.handleWindowResize(a),
      WindowClose: () => host.handleWindowClose(),
    };
  }

  /** Dispatch a typed AnvilAction. Unknown names are no-ops at compile time. */
  dispatch(action: AnvilAction): void {
    const name = action.name as AnvilActionName;
    const handler = this._handlers[name] as ((a: AnvilAction) => void) | undefined;
    handler?.(action);
  }

  /** Register or replace a handler (tests / extensions). */
  register<K extends AnvilActionName>(
    name: K,
    handler: (action: Extract<AnvilAction, { name: K }>) => void
  ): void {
    this._handlers[name] = handler as HandlerMap[K];
  }
}
