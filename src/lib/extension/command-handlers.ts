/**
 * Command handler implementations — Stage 2 extraction.
 *
 * `createCommandHandlers(host)` returns a `CommandBusHost` whose handler
 * methods are module-level functions behind the factory closure. The host is
 * intentionally wide (C1 accepted seam): command dispatch fans out everywhere.
 *
 * Ownership/lifecycle rules: `.agents/rules/architecture.md` (§2 one owner per
 * state, §3 commands are data). Extraction rationale: `.agents/memory/decisions.md`.
 */

import Meta from "gi://Meta";
import Gio from "gi://Gio";

import { safeRaise, safeActivate } from "./mutter-safe.js";
import * as Utils from "./utils.js";
import { computeSnapLayout } from "./snap-layout.js";
import { Tree, Node, LAYOUT_TYPES, ORIENTATION_TYPES, NODE_TYPES, type RectLike } from "./tree.js";
import { WINDOW_MODES } from "./window/constants.js";
import type { PointerFocusSource } from "./pointer-policy.js";
import type { LayoutEngine } from "./layout-engine.js";
import type { FocusController } from "./focus-controller.js";
import type { TilingRender } from "./tiling-render.js";
import type { RulesEngine } from "./rules-engine.js";
import type { AnvilExtension } from "./window/types.js";
import type {
  FloatAction,
  DirectionAction,
  SplitAction,
  GapSizeAction,
  SnapLayoutMoveAction,
  WindowResizeAction,
} from "./window/actions.js";
import type { CommandBusHost } from "./command-bus.js";
import type { EventSchedulerPort } from "./event-scheduler.js";

/** Host surface consumed by the command-handlers factory (C1 accepted wide seam). */
export interface CommandHandlerHost {
  readonly tree: Tree;
  readonly focusMetaWindow: Meta.Window | null;
  readonly settings: Gio.Settings;
  readonly ext: AnvilExtension;
  readonly layoutEngine: LayoutEngine;
  readonly focusController: FocusController;
  readonly tilingRender: TilingRender;
  readonly rulesEngine: RulesEngine;
  readonly scheduler: EventSchedulerPort;
  readonly prefsTitle: string;

  findNodeWindow(w: Meta.Window): Node | null;
  move(w: Meta.Window, rect: RectLike): void;
  moveCenter(w: Meta.Window): void;
  renderTree(from: string, force?: boolean): void;
  notifyFocusChanged(node: Node | null, source: PointerFocusSource): void;
  updateStackedFocus(n: Node | null | undefined): void;
  updateTabbedFocus(n: Node | null | undefined): void;
  isActiveWindowWorkspaceTiled(w: Meta.Window): boolean;
  isFloatingExempt(w: Meta.Window | null): boolean;
  floatWorkspace(i: number): void;
  unfloatWorkspace(i: number): void;
  floatAllWindows(): void;
  unfloatAllWindows(): void;
  addFloatOverride(w: Meta.Window, withWmId: boolean): void;
  removeFloatOverride(w: Meta.Window, withWmId: boolean): void;
  // NOTE: float-mode toggle and grab resize are same-module helpers
  // (toggleFloatingMode / resize below); handlers call those directly instead
  // of routing through the host and back (review S6 middle-man cycle).

  // Narrow grab surface (C4)
  beginGrab(metaWindow: Meta.Window, grabOp: Meta.GrabOp): void;
  endGrab(metaWindow: Meta.Window, grabOp: Meta.GrabOp): void;
  setCancelGrab(v: boolean): void;

  // Freeze caller (C2) — only unfreeze is needed from handlers.
  unfreezeRender(): void;
}

// --- Module-level handler functions

function handleFloat(host: CommandHandlerHost, action: FloatAction) {
  const focusWindow = host.focusMetaWindow;
  const focusNodeWindow = host.findNodeWindow(focusWindow!);

  // Call same-module helper directly; do not round-trip through the runtime (S6).
  toggleFloatingMode(host, action, focusWindow!);

  const rectRequest = {
    x: action.x,
    y: action.y,
    width: action.width,
    height: action.height,
  };

  const moveRect = {
    x: Utils.resolveX(rectRequest, focusWindow!),
    y: Utils.resolveY(rectRequest, focusWindow!),
    width: Utils.resolveWidth(rectRequest, focusWindow!),
    height: Utils.resolveHeight(rectRequest, focusWindow!),
  };

  host.move(focusWindow!, moveRect);

  const existParent = focusNodeWindow!.parentNode!;

  // LayoutEngine is the sole owner of sibling percents (architecture rule §2):
  // route the float-toggle percent reset through it instead of writing
  // existParent.percent directly (review S1).
  host.layoutEngine.resetPercentForFloatToggle(existParent, host.tree);
  host.renderTree("float-toggle", true);
}

function handleMove(host: CommandHandlerHost, action: DirectionAction) {
  let focusNodeWindow = host.findNodeWindow(host.focusMetaWindow!);
  host.unfreezeRender();
  const moveDirection = Utils.resolveDirection(action.direction)!;

  const prev = focusNodeWindow;
  const moved = host.layoutEngine.move(focusNodeWindow!, moveDirection);
  if (!focusNodeWindow) {
    focusNodeWindow = host.findNodeWindow(host.focusMetaWindow!);
  }
  host.scheduler.enqueue({
    name: "move",
    callback: () => {
      if (host.scheduler.pendingCount <= 0) {
        host.unfreezeRender();
        if (focusNodeWindow!.parentNode!.layout === LAYOUT_TYPES.STACKED) {
          // LayoutEngine owns the stacked reparent-to-raise (review S1).
          host.layoutEngine.raiseInStacked(focusNodeWindow!);
          safeRaise(focusNodeWindow!.nodeValue as Meta.Window);
          safeActivate(
            focusNodeWindow!.nodeValue as Meta.Window,
            global.display.get_current_time()
          );
          host.renderTree("move-stacked-queue");
        }
        if (focusNodeWindow!.parentNode!.layout === LAYOUT_TYPES.TABBED) {
          safeRaise(focusNodeWindow!.nodeValue as Meta.Window);
          safeActivate(
            focusNodeWindow!.nodeValue as Meta.Window,
            global.display.get_current_time()
          );
          if (prev) prev!.parentNode!.lastTabFocus = prev.nodeValue as Meta.Window;
          host.renderTree("move-tabbed-queue");
        }
        host.notifyFocusChanged(focusNodeWindow!, "move");
      }
    },
  });
  if (moved) {
    if (prev) prev!.parentNode!.lastTabFocus = prev.nodeValue as Meta.Window;
    host.renderTree("move-window");
  }
}

function handleFocus(host: CommandHandlerHost, action: DirectionAction) {
  let focusNodeWindow = host.findNodeWindow(host.focusMetaWindow!);
  const focusDirection = Utils.resolveDirection(action.direction)!;
  focusNodeWindow = host.focusController.focusDirection(focusNodeWindow, focusDirection);
  if (!focusNodeWindow) {
    focusNodeWindow = host.findNodeWindow(host.focusMetaWindow!);
  }
  // In headless environments (container tests), there is no pointer
  // to auto-focus the window. Explicitly activate so get_focus_window()
  // returns the correct window.
  if (focusNodeWindow) {
    const win = focusNodeWindow.nodeValue as Meta.Window;
    safeRaise(win);
    safeActivate(win, global.display.get_current_time());
  }
}

function handleSwap(host: CommandHandlerHost, action: DirectionAction) {
  const focusNodeWindow = host.findNodeWindow(host.focusMetaWindow!);
  if (!focusNodeWindow) return;
  host.unfreezeRender();
  const swapDirection = Utils.resolveDirection(action.direction)!;
  host.layoutEngine.swap(focusNodeWindow, swapDirection);
  const swapWin = focusNodeWindow.nodeValue as Meta.Window;
  safeRaise(swapWin);
  safeActivate(swapWin, global.display.get_current_time());
  host.updateTabbedFocus(focusNodeWindow);
  host.updateStackedFocus(focusNodeWindow);
  host.notifyFocusChanged(focusNodeWindow!, "swap");
  host.renderTree("swap", true);
}

function handleSplit(host: CommandHandlerHost, action: SplitAction) {
  const focusNodeWindow = host.findNodeWindow(host.focusMetaWindow!);
  if (!focusNodeWindow) return;
  const currentLayout = focusNodeWindow!.parentNode!.layout;
  if (currentLayout === LAYOUT_TYPES.STACKED || currentLayout === LAYOUT_TYPES.TABBED) {
    return;
  }
  const orientation = action.orientation
    ? action.orientation.toUpperCase()
    : ORIENTATION_TYPES.NONE;
  host.layoutEngine.split(focusNodeWindow, orientation);
  host.renderTree("split");
}

function handleLayoutToggle(host: CommandHandlerHost) {
  const focusNodeWindow = host.findNodeWindow(host.focusMetaWindow!);
  if (!focusNodeWindow) return;
  const parent = focusNodeWindow!.parentNode!;
  const currentLayout = parent.layout;
  if (currentLayout !== LAYOUT_TYPES.HSPLIT && currentLayout !== LAYOUT_TYPES.VSPLIT) {
    return;
  }
  // LayoutEngine owns the layout write + attachNode set (review S1).
  host.layoutEngine.toggleSplitLayout(parent);
  host.renderTree("layout-split-toggle");
  {
    const win = focusNodeWindow.nodeValue as Meta.Window;
    safeRaise(win);
    safeActivate(win, global.display.get_current_time());
  }
  host.notifyFocusChanged(focusNodeWindow!, "command");
}

function handleFocusBorderToggle(host: CommandHandlerHost) {
  const focusBorderEnabled = host.settings.get_boolean("focus-border-toggle");
  host.settings.set_boolean("focus-border-toggle", !focusBorderEnabled);
}

function handleTilingModeToggle(host: CommandHandlerHost) {
  const tilingModeEnabled = host.settings.get_boolean("tiling-mode-enabled");
  host.settings.set_boolean("tiling-mode-enabled", !tilingModeEnabled);
  if (tilingModeEnabled) {
    host.floatAllWindows();
  } else {
    host.unfloatAllWindows();
  }
  host.renderTree(`tiling-mode-toggle ${!tilingModeEnabled}`);
}

function handleGapSize(host: CommandHandlerHost, action: GapSizeAction) {
  let gapIncrement = host.settings.get_uint("window-gap-size-increment");
  const amount = action.amount;
  gapIncrement = gapIncrement + amount;
  if (gapIncrement < 0) gapIncrement = 0;
  if (gapIncrement > 8) gapIncrement = 8;
  host.settings.set_uint("window-gap-size-increment", gapIncrement);
}

function handleWorkspaceActiveTileToggle(host: CommandHandlerHost) {
  const activeWorkspace = global.workspace_manager.get_active_workspace_index();
  const skippedWorkspaces = host.settings.get_string("workspace-skip-tile");
  let workspaceSkipped = false;
  let skippedArr: string[] = [];
  if (skippedWorkspaces.length === 0) {
    skippedArr.push(`${activeWorkspace}`);
    host.floatWorkspace(activeWorkspace);
  } else {
    skippedArr = skippedWorkspaces.split(",");

    for (let i = 0; i < skippedArr.length; i++) {
      if (`${skippedArr[i]}` === `${activeWorkspace}`) {
        workspaceSkipped = true;
        break;
      }
    }

    if (workspaceSkipped) {
      const indexWs = skippedArr.indexOf(`${activeWorkspace}`);
      skippedArr.splice(indexWs, 1);
      host.unfloatWorkspace(activeWorkspace);
    } else {
      skippedArr.push(`${activeWorkspace}`);
      host.floatWorkspace(activeWorkspace);
    }
  }
  host.settings.set_string("workspace-skip-tile", skippedArr.toString());
  host.renderTree("workspace-toggle");
}

function handleLayoutStackedToggle(host: CommandHandlerHost) {
  const focusNodeWindow = host.findNodeWindow(host.focusMetaWindow!);
  if (!focusNodeWindow) return;
  if (!host.settings.get_boolean("stacked-tiling-mode-enabled")) return;

  if (focusNodeWindow!.parentNode!.isMonitor()) {
    host.layoutEngine.split(focusNodeWindow, ORIENTATION_TYPES.HORIZONTAL, true);
  }

  const parent = focusNodeWindow!.parentNode!;
  if (parent.layout === LAYOUT_TYPES.STACKED) {
    host.layoutEngine.setLayout(parent, host.layoutEngine.determineSplitLayout());
  } else {
    host.layoutEngine.setLayout(parent, LAYOUT_TYPES.STACKED);
    const lastChild = parent.lastChild;
    if (lastChild && lastChild.nodeType === NODE_TYPES.WINDOW) {
      (lastChild.nodeValue as Meta.Window).activate(global.display.get_current_time());
    }
  }
  host.unfreezeRender();
  host.layoutEngine.setAttachNode(parent);
  host.renderTree("layout-stacked-toggle");
}

function handleLayoutTabbedToggle(host: CommandHandlerHost) {
  const focusNodeWindow = host.findNodeWindow(host.focusMetaWindow!);
  if (!focusNodeWindow) return;
  if (!host.settings.get_boolean("tabbed-tiling-mode-enabled")) return;

  if (focusNodeWindow!.parentNode!.isMonitor()) {
    host.layoutEngine.split(focusNodeWindow, ORIENTATION_TYPES.HORIZONTAL, true);
  }

  const parent = focusNodeWindow!.parentNode!;
  if (parent.layout === LAYOUT_TYPES.TABBED) {
    host.layoutEngine.setLayout(parent, host.layoutEngine.determineSplitLayout());
  } else {
    host.layoutEngine.setLayout(parent, LAYOUT_TYPES.TABBED);
    parent.lastTabFocus = focusNodeWindow.nodeValue as Meta.Window;
  }
  host.unfreezeRender();
  host.layoutEngine.setAttachNode(parent);
  host.renderTree("layout-tabbed-toggle");
}

function handleCancelOperation(host: CommandHandlerHost) {
  const focusNodeWindow = host.findNodeWindow(host.focusMetaWindow!);
  if (focusNodeWindow?.mode === WINDOW_MODES.GRAB_TILE) {
    host.setCancelGrab(true);
  }
}

function handlePrefsOpen(host: CommandHandlerHost) {
  const existWindow = Utils.findWindowWith(host.prefsTitle, Utils.PREFERENCES_WINDOW_CLASS);
  if (existWindow && existWindow.get_workspace()) {
    existWindow.get_workspace().activate_with_focus(existWindow, global.display.get_current_time());
    host.moveCenter(existWindow);
  } else {
    host.ext.openPreferences();
  }
}

function handleWindowSwapLastActive(host: CommandHandlerHost) {
  const focusNodeWindow = host.findNodeWindow(host.focusMetaWindow!);
  if (focusNodeWindow) {
    const lastActiveWindow = global.display.get_tab_next(
      Meta.TabList.NORMAL,
      global.display.get_workspace_manager().get_active_workspace(),
      focusNodeWindow.nodeValue as Meta.Window,
      false
    );
    const lastActiveNodeWindow = host.tree.findNode(lastActiveWindow);
    host.layoutEngine.swapPairs(lastActiveNodeWindow!, focusNodeWindow);
    host.notifyFocusChanged(focusNodeWindow!, "swap");
    host.renderTree("swap-last-active");
  }
}

function handleSnapLayoutMove(host: CommandHandlerHost, action: SnapLayoutMoveAction) {
  const focusNodeWindow = host.findNodeWindow(host.focusMetaWindow!);
  if (!focusNodeWindow) return;

  const metaWindow = focusNodeWindow.nodeValue as Meta.Window;
  const workareaRect = metaWindow.get_work_area_current_monitor();
  const currentFrame = host.focusMetaWindow?.get_frame_rect() ?? null;
  const snap = computeSnapLayout(action.direction, workareaRect, action.amount, currentFrame);
  if (!snap) return;

  let rect: RectLike | { x: string | number; y: string | number; width: number; height: number } =
    snap.rect;
  if ("x" in rect && rect.x === "center" && host.focusMetaWindow) {
    rect = {
      x: Utils.resolveX(rect as { x?: string | number }, host.focusMetaWindow),
      y: Utils.resolveY(rect as { y?: string | number }, host.focusMetaWindow),
      width: rect.width,
      height: rect.height,
    };
  }
  focusNodeWindow.rect = rect as RectLike;
  if (snap.processGap) {
    focusNodeWindow.rect = host.tilingRender.processGap(focusNodeWindow) as RectLike;
  }
  if (!focusNodeWindow.isFloat()) {
    host.addFloatOverride(metaWindow, false);
  }
  host.move(metaWindow, focusNodeWindow.rect!);
  host.scheduler.enqueue({
    name: "snap-layout-move",
    callback: () => {
      host.renderTree("snap-layout-move");
    },
  });
}

function handleShowTabDecorationToggle(host: CommandHandlerHost) {
  if (!host.settings.get_boolean("tabbed-tiling-mode-enabled")) return;

  const showTabs = host.settings.get_boolean("showtab-decoration-enabled");
  host.settings.set_boolean("showtab-decoration-enabled", !showTabs);

  const focusNodeWindow = host.findNodeWindow(host.focusMetaWindow!);
  if (!focusNodeWindow) return;
  host.unfreezeRender();
  host.layoutEngine.setAttachNode(focusNodeWindow!.parentNode!);
  host.renderTree("showtab-decoration-enabled");
}

function handleWindowResize(host: CommandHandlerHost, action: WindowResizeAction) {
  const grabByDir: Record<WindowResizeAction["direction"], Meta.GrabOp> = {
    Right: Meta.GrabOp.KEYBOARD_RESIZING_E,
    Left: Meta.GrabOp.KEYBOARD_RESIZING_W,
    Top: Meta.GrabOp.KEYBOARD_RESIZING_N,
    Bottom: Meta.GrabOp.KEYBOARD_RESIZING_S,
  };
  const grabOp = grabByDir[action.direction];
  if (grabOp !== undefined) {
    // Call same-module helper directly; do not round-trip through the runtime (S6).
    resize(host, grabOp, action.amount);
  }
}

function handleWindowClose(host: CommandHandlerHost) {
  const focusWindow = host.focusMetaWindow;
  if (focusWindow) {
    focusWindow.delete(global.display.get_current_time());
  }
}

// --- Shared module-level command functions

export function toggleFloatingMode(
  host: CommandHandlerHost,
  action: FloatAction,
  metaWindow: Meta.Window
) {
  const nodeWindow = host.findNodeWindow(metaWindow);
  if (!nodeWindow || !action) return;
  if (nodeWindow.nodeType !== NODE_TYPES.WINDOW) return;

  const withWmId = action.name === "FloatToggle";
  const floatingExempt = host.isFloatingExempt(metaWindow);

  if (floatingExempt) {
    host.removeFloatOverride(metaWindow, withWmId);
    host.rulesEngine.windowProps = host.ext.configMgr.windowProps ?? host.rulesEngine.windowProps;
    if (!host.isActiveWindowWorkspaceTiled(metaWindow)) {
      nodeWindow.mode = WINDOW_MODES.FLOAT;
    } else {
      nodeWindow.mode = WINDOW_MODES.TILE;
    }
  } else {
    host.addFloatOverride(metaWindow, withWmId);
    host.rulesEngine.windowProps = host.ext.configMgr.windowProps ?? host.rulesEngine.windowProps;
    nodeWindow.mode = WINDOW_MODES.FLOAT;
  }
}

export function resize(host: CommandHandlerHost, grabOp: Meta.GrabOp, amount: number) {
  const metaWindow = host.focusMetaWindow;
  if (!metaWindow) return;
  host.beginGrab(metaWindow, grabOp);

  const rect = metaWindow.get_frame_rect();
  const direction = Utils.directionFromGrab(grabOp);

  switch (direction) {
    case Meta.MotionDirection.RIGHT:
      rect.width = rect.width + amount;
      break;
    case Meta.MotionDirection.LEFT:
      rect.width = rect.width + amount;
      rect.x = rect.x - amount;
      break;
    case Meta.MotionDirection.UP:
      rect.height = rect.height + amount;
      break;
    case Meta.MotionDirection.DOWN:
      rect.height = rect.height + amount;
      rect.y = rect.y - amount;
      break;
  }
  // Clamp the requested rect to active monitor constraints BEFORE moving.
  // The render-time clamp (enforceUltrawideSize) cannot reposition the window
  // while an active grab holds it (Mutter rejects move_resize during a grab and
  // TilingRender.apply swallows that), so the keyboard-resized window would
  // otherwise stay at the un-clamped size. Apply the same clamp at the source.
  const nodeForClamp = host.findNodeWindow(metaWindow);
  if (nodeForClamp) {
    try {
      const clamped = host.tilingRender.enforceUltrawideSize(nodeForClamp, rect);
      if (clamped) {
        rect.x = clamped.x;
        rect.y = clamped.y;
        rect.width = clamped.width;
        rect.height = clamped.height;
      }
    } catch {
      /* constraints unavailable — fall through with the raw rect */
    }
  }
  host.move(metaWindow, rect);
  host.scheduler.enqueue(
    {
      name: "manual-resize",
      callback: () => {
        if (host.scheduler.pendingCount === 0) {
          host.endGrab(metaWindow, grabOp);
        }
      },
    },
    50
  );
}

// --- Factory

/**
 * Build the CommandBusHost handler table (AnvilRuntime wires it to CommandBus). No GLib
 * sources are owned here: handlePrefsOpen calls host.ext.openPreferences(); the
 * original _prefsOpenSrcId was vestigial dead state (declared, never assigned)
 * and was removed rather than carried forward (correction to plan C8).
 */
export function createCommandHandlers(host: CommandHandlerHost): CommandBusHost {
  return {
    handleFloat: (a) => handleFloat(host, a),
    handleMove: (a) => handleMove(host, a),
    handleFocus: (a) => handleFocus(host, a),
    handleSwap: (a) => handleSwap(host, a),
    handleSplit: (a) => handleSplit(host, a),
    handleLayoutToggle: () => handleLayoutToggle(host),
    handleFocusBorderToggle: () => handleFocusBorderToggle(host),
    handleTilingModeToggle: () => handleTilingModeToggle(host),
    handleGapSize: (a) => handleGapSize(host, a),
    handleWorkspaceActiveTileToggle: () => handleWorkspaceActiveTileToggle(host),
    handleLayoutStackedToggle: () => handleLayoutStackedToggle(host),
    handleLayoutTabbedToggle: () => handleLayoutTabbedToggle(host),
    handleCancelOperation: () => handleCancelOperation(host),
    handlePrefsOpen: () => handlePrefsOpen(host),
    handleWindowSwapLastActive: () => handleWindowSwapLastActive(host),
    handleSnapLayoutMove: (a) => handleSnapLayoutMove(host, a),
    handleShowTabDecorationToggle: () => handleShowTabDecorationToggle(host),
    handleWindowResize: (a) => handleWindowResize(host, a),
    handleWindowClose: () => handleWindowClose(host),
  };
}
