/*
 * WindowTracker — Meta window admit / destroy / pending track / reconcile.
 *
 * Sole owner of:
 *   - validity gate (which Meta windows enter the tree)
 *   - pending admit until wm-class/title/type are ready
 *   - per-window + actor lifecycle signal connects
 *   - trackWindow / windowDestroy / trackCurrentWindows
 *   - window-created / map reconcile loop source
 *
 * Geometry apply stays on TilingRender; float rules on RulesEngine.
 * UI / render / position-size handlers are host callbacks (no concrete runtime import).
 *
 * Residual Meta connects still on AnvilRuntime (not Stage 4): grab-op, settings,
 * overview, workspace manager, minimize/unminimize.
 *
 * @see .agents/rules/architecture.md rule 2
 */

import GLib from "gi://GLib";
import Gio from "gi://Gio";
import Meta from "gi://Meta";

import { Logger } from "../shared/logger.js";
import * as Utils from "./utils.js";
import { NODE_TYPES, type Node, type Tree } from "./tree.js";
import { safeRaise, safeFocus, safeActivate } from "./mutter-safe.js";
import { WINDOW_MODES, INVALID_WINDOW_TYPES } from "./window/constants.js";
import type { AnvilMetaWindow, AnvilWindowActor } from "./window/types.js";
import type { PointerFocusSource } from "./pointer-policy.js";
import type { EventSchedulerPort } from "./event-scheduler.js";
import type { BorderRefreshMode } from "./render-scheduler.js";

export interface WindowTrackerHost {
  readonly coreTilingEngine: boolean;
  readonly tree: Tree;
  readonly focusMetaWindow: Meta.Window | null;
  readonly prefsTitle: string;
  readonly windowsAllWorkspaces: Meta.Window[];
  readonly settings: Gio.Settings;

  isFloatingExempt(w: Meta.Window): boolean;
  isActiveWindowWorkspaceTiled(w: Meta.Window): boolean;
  floatingWindow(node: Node): boolean;
  findNodeWindowByActor(actor: AnvilWindowActor): Node | null;

  reloadTree(from: string): void;
  updateMetaWorkspaceMonitor(from: string, monitor: number | null, metaWindow: Meta.Window): void;
  updateMetaPositionSize(metaWindow: Meta.Window, from: string): void;

  renderTree(from: string, force?: boolean, borderRefresh?: BorderRefreshMode): void;
  readonly scheduler: EventSchedulerPort;
  unfreezeRender(): void;
  registerWindowDecoration(metaWindow: Meta.Window, actor: AnvilWindowActor): void;
  unregisterWindowDecoration(metaWindow: Meta.Window, actorDestroyed?: boolean): void;
  updateBorderLayout(): void;
  setActiveWindowDecoration(nextWindow: Meta.Window | null): void;
  reconcileWindowDecoration(metaWindow: Meta.Window): void;
  reconcileActiveWindowDecoration(): void;
  updateDecorationLayout(): void;
  updateStackedFocus(focusNodeWindow: Node | null | undefined): void;
  updateTabbedFocus(focusNodeWindow: Node | null | undefined): void;
  notifyFocusChanged(node: Node | null, source: PointerFocusSource): void;
  moveCenter(metaWindow: Meta.Window): void;
  removeFloatOverride(metaWindow: Meta.Window, withWmId: boolean): void;
  trackCurrentMonWs(): void;
  /** LayoutEngine.autoSplitFromFocus — no command re-entry. */
  autoSplitFromFocus(): boolean;
  /** LayoutEngine.resetTiledSiblingPercent — preserve float-independent sizing. */
  resetTiledSiblingPercent(parentNode: Node | null): void;
  observePortableWindow(metaWindow: Meta.Window): void;
  observePortableFrame(metaWindow: Meta.Window): void;
  observePortableFocus(metaWindow: Meta.Window | null): void;
  withdrawPortableWindow(metaWindow: Meta.Window): void;
}

/** Reconcile backoff (B4-2): start at 16ms, double until max; stop when stable or budget. */
const RECONCILE_INITIAL_MS = 16;
const RECONCILE_MAX_MS = 256;
const RECONCILE_MAX_DURATION_MS = 2000;
const RECONCILE_STABLE_TICKS = 2;

export class WindowTracker {
  private _host: WindowTrackerHost;
  private _windowReconcileSrcId = 0;
  private readonly _trackedWindows = new WeakSet<Meta.Window>();
  private readonly _pendingAdmissionUnmaximize = new WeakSet<Meta.Window>();

  constructor(host: WindowTrackerHost) {
    this._host = host;
  }

  /** Cancel reconcile loop (call from extension disable). */
  dispose() {
    if (this._windowReconcileSrcId) {
      GLib.Source.remove(this._windowReconcileSrcId);
      this._windowReconcileSrcId = 0;
    }

    // Per-window cleanup: disconnect signals, clear pending, clean actor signals
    const allWindows = this._host.windowsAllWorkspaces;
    if (allWindows) {
      for (const metaWindowRaw of allWindows) {
        const metaWindow = metaWindowRaw as AnvilMetaWindow;
        if (metaWindow.windowSignals !== undefined) {
          for (const windowSignal of metaWindow.windowSignals) {
            metaWindow.disconnect(windowSignal);
          }
          metaWindow.windowSignals.length = 0;
          metaWindow.windowSignals = undefined;
        }

        this.clearPendingWindowSignals(metaWindow);

        const windowActor = metaWindow.get_compositor_private() as AnvilWindowActor | null;
        if (windowActor && windowActor.actorSignals) {
          for (const actorSignal of windowActor.actorSignals) {
            windowActor.disconnect(actorSignal);
          }
          windowActor.actorSignals.length = 0;
          windowActor.actorSignals = undefined;
        }
      }
    }
  }

  validWindow(metaWindow: Meta.Window) {
    // Wayland clipboard/paste helpers (wl-clipboard, 1×1 stubs) must not enter the tree.
    if (Utils.isEphemeralHelperWindow(metaWindow)) {
      return false;
    }

    // Bug #309, #322 fix: Filter out XWayland Video Bridge and ddterm windows
    // Ported from jcrussell/forge
    const wmClass = metaWindow.get_wm_class();
    if (wmClass && wmClass.toLowerCase().includes("xwaylandvideobridge")) {
      return false;
    }
    if (wmClass && wmClass.toLowerCase().includes("ddterm")) {
      return false;
    }

    // Bug #351 fix: Filter out invalid window types (browser popups, tooltips, etc.)
    // Ported from jcrussell/forge
    const windowType = metaWindow.get_window_type();
    if (INVALID_WINDOW_TYPES.has(windowType)) return false;
    return (
      windowType === Meta.WindowType.NORMAL ||
      windowType === Meta.WindowType.MODAL_DIALOG ||
      windowType === Meta.WindowType.DIALOG
    );
  }

  clearPendingWindowSignals(metaWindow: AnvilMetaWindow) {
    if (metaWindow.pendingWindowSignals) {
      for (const signal of metaWindow.pendingWindowSignals) {
        metaWindow.disconnect(signal);
      }
      metaWindow.pendingWindowSignals.length = 0;
      metaWindow.pendingWindowSignals = undefined;
    }

    const windowActor = metaWindow.get_compositor_private() as AnvilWindowActor | null;
    if (windowActor && metaWindow.pendingActorSignals) {
      for (const signal of metaWindow.pendingActorSignals) {
        windowActor.disconnect(signal);
      }
    }
    if (metaWindow.pendingActorSignals) {
      metaWindow.pendingActorSignals.length = 0;
      metaWindow.pendingActorSignals = undefined;
    }
  }

  /**
   * Single admit entry (B4-5): all Meta paths (window-created, map, workspace
   * window-added) call this. Tracks when ready and schedules reconcile.
   */
  admitWindow(
    display: Meta.Display,
    metaWindow: Meta.Window,
    options?: { afterTrack?: () => void; scheduleReconcile?: boolean }
  ) {
    this.trackWhenReady(display, metaWindow, options?.afterTrack);
    if (options?.scheduleReconcile !== false) {
      this.scheduleReconcile();
    }
  }

  trackWhenReady(display: Meta.Display, metaWindow: Meta.Window, afterTrack?: () => void) {
    const host = this._host;
    if (this._trackedWindows.has(metaWindow) || host.tree.findNode(metaWindow)) {
      if (host.coreTilingEngine) {
        this.trackCoreActor(metaWindow);
      } else {
        this.trackLegacyActor(metaWindow);
        this._scheduleAdmissionUnmaximize(metaWindow);
      }
      this.clearPendingWindowSignals(metaWindow as AnvilMetaWindow);
      return;
    }

    if (this.validWindow(metaWindow)) {
      this.clearPendingWindowSignals(metaWindow as AnvilMetaWindow);
      this.trackWindow(display, metaWindow);
      afterTrack?.();
      return;
    }

    const anvilMetaWin = metaWindow as AnvilMetaWindow;
    if (anvilMetaWin.pendingWindowSignals) return;

    const retry = () => {
      this.trackWhenReady(display, metaWindow, afterTrack);
    };

    anvilMetaWin.pendingWindowSignals = [
      metaWindow.connect("notify::wm-class", retry),
      metaWindow.connect("notify::title", retry),
      metaWindow.connect("notify::window-type", retry),
      metaWindow.connect("workspace-changed", retry),
      metaWindow.connect("unmanaged", () => this.clearPendingWindowSignals(anvilMetaWin)),
    ];

    const windowActor = metaWindow.get_compositor_private() as AnvilWindowActor | null;
    if (windowActor) {
      anvilMetaWin.pendingActorSignals = [windowActor.connect("first-frame", retry)];
    }
  }

  private _unmaximizeWindow(metaWindow: Meta.Window) {
    try {
      // GNOME 49+
      metaWindow.set_unmaximize_flags(Meta.MaximizeFlags.BOTH);
      metaWindow.unmaximize();
    } catch {
      // pre-49 fallback
      (metaWindow as any).unmaximize(Meta.MaximizeFlags.HORIZONTAL);
      (metaWindow as any).unmaximize(Meta.MaximizeFlags.VERTICAL);
      (metaWindow as any).unmaximize(Meta.MaximizeFlags.BOTH);
    }
  }

  /**
   * `Meta.Workspace::window-added` fires while X11 windows are still inside
   * Mutter construction. Calling unmaximize from that signal can reach the
   * compositor before its window actor exists. Return to Mutter first, then
   * apply the admission effect only if the window is still tracked and mapped.
   */
  private _scheduleAdmissionUnmaximize(metaWindow: Meta.Window) {
    if (this._pendingAdmissionUnmaximize.has(metaWindow)) return;
    this._pendingAdmissionUnmaximize.add(metaWindow);
    this._host.scheduler.enqueue(
      {
        name: `admission-unmaximize:${metaWindow.get_id()}`,
        callback: () => {
          this._pendingAdmissionUnmaximize.delete(metaWindow);
          if (!this._trackedWindows.has(metaWindow) && !this._host.tree.findNode(metaWindow))
            return;
          if (!metaWindow.get_compositor_private()) return;
          this._unmaximizeWindow(metaWindow);
        },
      },
      0
    );
  }

  trackMappedActor(
    actor:
      | (AnvilWindowActor & {
          meta_window?: Meta.Window | null;
          get_meta_window?: () => Meta.Window | null;
        })
      | null
  ) {
    const metaWindow = actor?.meta_window ?? actor?.get_meta_window?.();
    if (metaWindow) {
      this.admitWindow(global.display, metaWindow);
    } else {
      this.scheduleReconcile();
    }
  }

  /**
   * Schedule window admit reconcile with exponential backoff (B4-2).
   * Stops early when consecutive ticks admit zero windows, or after max duration.
   * Re-entrant schedule while a loop is active is a no-op (loop already covers admissions).
   */
  scheduleReconcile() {
    if (this._windowReconcileSrcId) return;

    let intervalMs = RECONCILE_INITIAL_MS;
    let stableTicks = 0;
    const startedAt = Date.now();

    const arm = () => {
      this._windowReconcileSrcId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, intervalMs, () => {
        const admitted = this.reconcileCurrentWindows("window-reconcile");
        if (admitted > 0) {
          stableTicks = 0;
          intervalMs = RECONCILE_INITIAL_MS;
        } else {
          stableTicks++;
          intervalMs = Math.min(intervalMs * 2, RECONCILE_MAX_MS);
        }

        const elapsedMs = Date.now() - startedAt;
        if (stableTicks >= RECONCILE_STABLE_TICKS || elapsedMs >= RECONCILE_MAX_DURATION_MS) {
          this._windowReconcileSrcId = 0;
          return false;
        }

        // Reschedule with new interval (GLib timeout_add interval is fixed per source).
        this._windowReconcileSrcId = 0;
        arm();
        return false;
      });
    };
    arm();
  }

  private _currentWindowCandidates() {
    const host = this._host;
    const byId = new Map<number, Meta.Window>();
    for (const metaWindow of host.windowsAllWorkspaces) {
      byId.set(metaWindow.get_id(), metaWindow);
    }

    const actors = global.get_window_actors?.() ?? [];
    for (const actor of actors as Array<
      AnvilWindowActor & {
        meta_window?: Meta.Window | null;
        get_meta_window?: () => Meta.Window | null;
      }
    >) {
      const metaWindow = actor.meta_window ?? actor.get_meta_window?.();
      if (metaWindow) byId.set(metaWindow.get_id(), metaWindow);
    }

    return [...byId.values()].sort((w1, w2) => {
      return w1.get_stable_sequence() - w2.get_stable_sequence();
    });
  }

  /**
   * Admit any valid windows not yet in the tree (also used by unit tests).
   * @returns number of windows newly tracked this pass
   */
  reconcileCurrentWindows(from: string): number {
    const host = this._host;
    let admitted = 0;
    for (const metaWindow of this._currentWindowCandidates()) {
      if (
        this._trackedWindows.has(metaWindow) ||
        host.tree.findNode(metaWindow) ||
        !this.validWindow(metaWindow)
      )
        continue;

      this.trackWindow(global.display, metaWindow);
      host.updateMetaWorkspaceMonitor(from, metaWindow.get_monitor(), metaWindow);
      admitted++;
    }
    return admitted;
  }

  /**
   * Track meta/mutter windows and append them to the tree.
   * Windows can be attached on any of the following Node Types:
   * MONITOR, CONTAINER
   */
  trackWindow(_display: Meta.Display, metaWindow: Meta.Window) {
    const host = this._host;
    // Make window types configurable
    if (this.validWindow(metaWindow)) {
      host.observePortableWindow(metaWindow);
      if (host.coreTilingEngine) {
        this.trackCoreWindow(metaWindow);
        return;
      }
      const initialMode =
        host.isFloatingExempt(metaWindow) || !host.isActiveWindowWorkspaceTiled(metaWindow)
          ? WINDOW_MODES.FLOAT
          : WINDOW_MODES.TILE;
      if (initialMode === WINDOW_MODES.TILE) {
        host.autoSplitFromFocus();
      }
      const existNodeWindow = host.tree.findNode(metaWindow);
      Logger.debug(`Meta Window ${metaWindow.get_title()} ${metaWindow.get_window_type()}`);
      if (!existNodeWindow) {
        let attachTarget;

        const activeMonitor = global.display.get_current_monitor();
        const activeWorkspace = global.display.get_workspace_manager().get_active_workspace_index();
        const metaMonWs = `mo${activeMonitor}ws${activeWorkspace}`;

        // Check if the active monitor / workspace has windows
        const metaMonWsNode = host.tree.findNode(metaMonWs);
        if (!metaMonWsNode) {
          // Reload the tree as a last resort
          host.reloadTree("no-meta-monws");
          return;
        }

        const windowNodes = metaMonWsNode.getNodeByType(NODE_TYPES.WINDOW);
        const hasWindows = windowNodes.length > 0;

        attachTarget = host.tree.attachNode;
        attachTarget = attachTarget ? host.tree.findNode(attachTarget.nodeValue) : null;

        if (!attachTarget) {
          attachTarget = metaMonWsNode;
        } else {
          if (hasWindows) {
            if (attachTarget && metaMonWsNode.contains(attachTarget)) {
              // Use the attach target
            } else {
              // Find the first window
              attachTarget = windowNodes[0];
            }
          } else {
            attachTarget = metaMonWsNode;
          }
        }

        const nodeWindow = host.tree.createNode(
          attachTarget.nodeValue,
          NODE_TYPES.WINDOW,
          metaWindow,
          initialMode
        );
        this._trackedWindows.add(metaWindow);

        const anvilMetaWin = metaWindow as AnvilMetaWindow;
        this.clearPendingWindowSignals(anvilMetaWin);
        anvilMetaWin.firstRender = true;
        const windowActor = metaWindow.get_compositor_private() as AnvilWindowActor | null;

        if (!anvilMetaWin.windowSignals) {
          const windowSignals = [
            metaWindow.connect("position-changed", (_metaWindow: Meta.Window) => {
              const from = "position-changed";
              host.observePortableFrame(_metaWindow);
              host.updateMetaPositionSize(_metaWindow, from);
              host.reconcileWindowDecoration(_metaWindow);
            }),
            metaWindow.connect("size-changed", (_metaWindow: Meta.Window) => {
              const from = "size-changed";
              host.observePortableFrame(_metaWindow);
              host.updateMetaPositionSize(_metaWindow, from);
              host.reconcileWindowDecoration(_metaWindow);
            }),
            // Re-classify on property changes so late-arriving metadata (for
            // Inkscape, Brave, etc.) causes a re-render + processFloats.
            metaWindow.connect("notify::wm-class", () => {
              host.observePortableWindow(metaWindow);
              host.renderTree("wm-class-notify", true);
            }),
            metaWindow.connect("notify::title", () => {
              host.observePortableWindow(metaWindow);
              host.renderTree("title-notify", true);
            }),
            metaWindow.connect("notify::minimized", () => {
              host.observePortableWindow(metaWindow);
              host.reconcileWindowDecoration(metaWindow);
              host.renderTree("minimized-notify", true);
            }),
            metaWindow.connect("notify::fullscreen", () => {
              host.observePortableWindow(metaWindow);
              host.reconcileWindowDecoration(metaWindow);
              host.renderTree("fullscreen-notify", true);
            }),
            metaWindow.connect("unmanaged", (_metaWindow: Meta.Window) => {
              // Xwayland does not reliably keep its compositor actor alive
              // long enough for the actor's destroy signal to own teardown.
              // Meta.Window::unmanaged is the authoritative withdrawal edge.
              this.windowDestroy(windowActor, _metaWindow);
            }),
            metaWindow.connect("focus", (_metaWindowFocus: Meta.Window) => {
              host.observePortableFocus(_metaWindowFocus);
              if (Utils.isEphemeralHelperWindow(_metaWindowFocus)) {
                host.setActiveWindowDecoration(null);
                return;
              }
              host.setActiveWindowDecoration(_metaWindowFocus);
              host.scheduler.enqueue({
                name: "focus-update",
                callback: () => {
                  host.unfreezeRender();
                  host.updateDecorationLayout();
                  host.updateStackedFocus(undefined);
                  host.updateTabbedFocus(undefined);
                  host.reconcileActiveWindowDecoration();
                  const focusNodeWindow = host.tree.findNode(host.focusMetaWindow);
                  host.notifyFocusChanged(focusNodeWindow, "signal");
                },
              });
              const focusNodeWindow = host.tree.findNode(host.focusMetaWindow);
              if (focusNodeWindow) {
                // handle the attach node
                host.tree.attachNode = focusNodeWindow._parent;
                if (host.floatingWindow(focusNodeWindow)) {
                  host.scheduler.enqueue({
                    name: "raise-float",
                    callback: () => {
                      host.renderTree("raise-float-queue", false, "skip");
                    },
                  });
                }
                host.tree.attachNode = focusNodeWindow;
              }
              host.renderTree("focus", true, "skip");
            }),
            metaWindow.connect("workspace-changed", (_metaWindow: Meta.Window) => {
              host.observePortableWindow(_metaWindow);
              host.updateMetaWorkspaceMonitor("metawindow-workspace-changed", null, _metaWindow);
              host.reconcileWindowDecoration(_metaWindow);
              host.trackCurrentMonWs();
            }),
          ];
          anvilMetaWin.windowSignals = windowSignals;
        }

        this.trackLegacyActor(metaWindow);

        this.postProcessWindow(nodeWindow as Node | null);
        this._scheduleAdmissionUnmaximize(metaWindow);
        host.renderTree("window-create", true);

        if (nodeWindow?.mode === WINDOW_MODES.TILE) {
          host.resetTiledSiblingPercent(nodeWindow.parentNode);
        }
      }
    }
  }

  private trackLegacyActor(metaWindow: Meta.Window): void {
    const host = this._host;
    const windowActor = metaWindow.get_compositor_private() as AnvilWindowActor | null;
    if (!windowActor) return;

    host.registerWindowDecoration(metaWindow, windowActor);
    if (windowActor.actorSignals) return;

    windowActor.actorSignals = [
      windowActor.connect("destroy", (actor: AnvilWindowActor) => {
        this.windowDestroy(actor, metaWindow, true);
      }),
      // First-frame is when slow and Xwayland clients expose their final
      // surface and metadata. Re-register idempotently so masks that could not
      // attach at map time are reconciled against the real surface actor.
      windowActor.connect("first-frame", () => {
        host.registerWindowDecoration(metaWindow, windowActor);
        host.renderTree("first-frame-reclassify", true);
      }),
    ];
  }

  private trackCoreWindow(metaWindow: Meta.Window): void {
    if (this._trackedWindows.has(metaWindow)) return;
    const host = this._host;
    const anvilMetaWin = metaWindow as AnvilMetaWindow;
    this.clearPendingWindowSignals(anvilMetaWin);
    this._trackedWindows.add(metaWindow);
    const updateBorder = () => {
      const actor = metaWindow.get_compositor_private() as AnvilWindowActor | null;
      if (actor) host.registerWindowDecoration(metaWindow, actor);
    };

    if (!anvilMetaWin.windowSignals) {
      anvilMetaWin.windowSignals = [
        metaWindow.connect("position-changed", (_metaWindow: Meta.Window) => {
          host.observePortableFrame(_metaWindow);
          updateBorder();
        }),
        metaWindow.connect("size-changed", (_metaWindow: Meta.Window) => {
          host.observePortableFrame(_metaWindow);
          updateBorder();
        }),
        metaWindow.connect("notify::wm-class", () => host.observePortableWindow(metaWindow)),
        metaWindow.connect("notify::title", () => host.observePortableWindow(metaWindow)),
        metaWindow.connect("notify::minimized", () => {
          host.observePortableWindow(metaWindow);
          updateBorder();
        }),
        metaWindow.connect("notify::fullscreen", () => {
          host.observePortableWindow(metaWindow);
          updateBorder();
        }),
        metaWindow.connect("focus", (_metaWindow: Meta.Window) => {
          host.observePortableFocus(_metaWindow);
          host.setActiveWindowDecoration(
            Utils.isEphemeralHelperWindow(_metaWindow) ? null : _metaWindow
          );
        }),
        metaWindow.connect("workspace-changed", (_metaWindow: Meta.Window) => {
          host.observePortableWindow(_metaWindow);
          host.reconcileWindowDecoration(_metaWindow);
        }),
        metaWindow.connect("unmanaged", (_metaWindow: Meta.Window) => {
          this._trackedWindows.delete(_metaWindow);
          host.withdrawPortableWindow(_metaWindow);
          host.unregisterWindowDecoration(_metaWindow);
        }),
      ];
    }

    this.trackCoreActor(metaWindow);
  }

  private trackCoreActor(metaWindow: Meta.Window): void {
    const host = this._host;
    const windowActor = metaWindow.get_compositor_private() as AnvilWindowActor | null;
    if (windowActor && !windowActor.actorSignals) {
      host.registerWindowDecoration(metaWindow, windowActor);
      windowActor.actorSignals = [
        windowActor.connect("destroy", () => {
          this._trackedWindows.delete(metaWindow);
          host.withdrawPortableWindow(metaWindow);
          host.unregisterWindowDecoration(metaWindow, true);
        }),
        windowActor.connect("first-frame", () => {
          host.observePortableWindow(metaWindow);
          host.registerWindowDecoration(metaWindow, windowActor);
        }),
      ];
    }
  }

  postProcessWindow(nodeWindow: Node | null) {
    if (!nodeWindow) return;
    const host = this._host;
    const metaWindow = nodeWindow.nodeValue as Meta.Window;
    if (metaWindow) {
      if (Utils.isPreferencesWindow(metaWindow, host.prefsTitle)) {
        metaWindow
          .get_workspace()
          .activate_with_focus(metaWindow, global.display.get_current_time());
        host.moveCenter(metaWindow);
      } else {
        host.notifyFocusChanged(nodeWindow, "window-create");
      }
    }
  }

  trackCurrentWindows() {
    const host = this._host;
    host.tree.attachNode = null;
    const windowsAll = host.windowsAllWorkspaces;
    for (let i = 0; i < windowsAll.length; i++) {
      const metaWindow = windowsAll[i];
      this.trackWindow(global.display, metaWindow);
      // This updates and handles dynamic workspaces
      host.updateMetaWorkspaceMonitor(
        "track-current-windows",
        metaWindow.get_monitor(),
        metaWindow
      );
    }
    host.updateDecorationLayout();
  }

  /**
   * Destroy pipeline (B4-7), ordered:
   *   1. strip border actors
   *   2. detach node from tree + float override
   *   3. restore focus if needed
   *   4. update attachNode
   *   5. single render (no dual quick + queued pass)
   */
  windowDestroy(
    actor: AnvilWindowActor | null,
    knownMetaWindow?: Meta.Window,
    actorDestroyed = false
  ) {
    const host = this._host;
    if (host.coreTilingEngine) {
      const metaWindow = knownMetaWindow;
      if (metaWindow) {
        this._trackedWindows.delete(metaWindow);
        host.withdrawPortableWindow(metaWindow);
        host.unregisterWindowDecoration(metaWindow, actorDestroyed);
      }
      return;
    }
    const nodeWindow =
      (knownMetaWindow ? host.tree.findNode(knownMetaWindow) : null) ??
      (actor ? host.findNodeWindowByActor(actor) : null);
    const metaWindow = (nodeWindow?.nodeValue ?? knownMetaWindow) as Meta.Window | undefined;
    if (metaWindow) {
      this._trackedWindows.delete(metaWindow);
      host.withdrawPortableWindow(metaWindow);
    }

    // 1. Border actors
    if (metaWindow) host.unregisterWindowDecoration(metaWindow, actorDestroyed);

    const hadFocus = !!metaWindow && host.focusMetaWindow === metaWindow;

    let needRelayout = false;
    if (nodeWindow?.isWindow()) {
      const focusRestoreParent = nodeWindow.parentNode;
      // 2. Detach
      const skipRelayout =
        nodeWindow.isFloat() || (!!metaWindow && Utils.isEphemeralHelperWindow(metaWindow));
      host.tree.removeNode(nodeWindow);
      needRelayout = !skipRelayout;
      host.removeFloatOverride(nodeWindow.nodeValue as Meta.Window, true);

      // 3. Focus restore (#258)
      if (hadFocus && host.settings.get_boolean("tiling-mode-enabled")) {
        this._restoreFocusAfterWindowClosed(focusRestoreParent, nodeWindow);
      }
    }

    // 4. attachNode for next create
    const focusNodeWindow = host.tree.findNode(host.focusMetaWindow);
    if (focusNodeWindow) {
      host.tree.attachNode = focusNodeWindow.parentNode!;
    }

    // 5. One render pass
    if (needRelayout) {
      host.renderTree("window-destroy", true);
    }
  }

  /**
   * Restore focus to another window after one is closed (#258)
   * Ported from jcrussell/forge
   */
  private _restoreFocusAfterWindowClosed(parent: Node | null, closedNodeWindow: Node) {
    if (!parent) return;
    // Try to find a sibling window in the same container
    const siblings = parent.childNodes.filter(
      (node: Node) => node.isWindow() && node !== closedNodeWindow && node.nodeValue
    );

    if (siblings.length > 0) {
      // Focus the first available sibling
      const targetWindow = siblings[0].nodeValue as Meta.Window;
      if (targetWindow && !targetWindow.minimized) {
        safeRaise(targetWindow);
        safeFocus(targetWindow, global.display.get_current_time());
        safeActivate(targetWindow, global.display.get_current_time());
        return;
      }
    }

    // If no siblings, try to find any window on the current workspace
    const wsManager = global.display.get_workspace_manager();
    const currentWs = wsManager.get_active_workspace();
    const workspaceWindows = currentWs
      .list_windows()
      .filter((w: Meta.Window) => !w.minimized && w.get_window_type() === Meta.WindowType.NORMAL);

    if (workspaceWindows.length > 0) {
      safeRaise(workspaceWindows[0]);
      safeFocus(workspaceWindows[0], global.display.get_current_time());
      safeActivate(workspaceWindows[0], global.display.get_current_time());
    }
  }

  /**
   * Connect workspace window-added for admit through TreeHost.
   */
  onWorkspaceWindowAdded(metaWindow: Meta.Window) {
    this.admitWindow(global.display, metaWindow, {
      afterTrack: () => {
        if (this.validWindow(metaWindow)) {
          this._host.updateMetaWorkspaceMonitor(
            "window-added",
            metaWindow.get_monitor(),
            metaWindow
          );
        }
      },
    });
  }

  onWindowCreated(display: Meta.Display, metaWindow: Meta.Window) {
    this.admitWindow(display, metaWindow);
  }
}
