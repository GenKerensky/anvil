/*
 * This file is part of the Anvil extension for GNOME
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 */

import GObject from "gi://GObject";
import GLib from "gi://GLib";
import Meta from "gi://Meta";

// Gnome Shell imports

// Shared state
import { Logger } from "../shared/logger.js";
import type { WindowConfig } from "../shared/settings.js";

// App imports
import * as Utils from "./utils.js";
import { Keybindings } from "./keybindings.js";
import { Tree, Node, NODE_TYPES, RectLike } from "./tree.js";
import { PointerPolicy, type PointerFocusSource } from "./pointer-policy.js";
import { TilingRender } from "./tiling-render.js";
import { RulesEngine } from "./rules-engine.js";
import { WindowTracker } from "./window-tracker.js";
import { LayoutEngine } from "./layout-engine.js";
import { GrabResizeSession } from "./grab-resize-session.js";
import { SettingsBridge } from "./settings-bridge.js";
import { FocusController } from "./focus-controller.js";
import { BorderController } from "./border-controller.js";
import { CommandBus } from "./command-bus.js";

import { GRAB_TYPES, WINDOW_MODES } from "./window/constants.js";
import { DragDropTile } from "./drag-drop-tile.js";
import { SignalManager } from "./signal-manager.js";
import { RenderScheduler } from "./render-scheduler.js";
import type { BorderRefreshMode } from "./render-scheduler.js";
import { DecorationLayout } from "./decoration-layout.js";
import {
  createCommandHandlers,
  resize as commandResize,
  toggleFloatingMode as commandToggleFloatingMode,
  type CommandHandlerHost,
} from "./command-handlers.js";
import { WorkspaceMutations, type WorkspaceMutationsHost } from "./workspace-mutations.js";
import type { AnvilWindowActor, AnvilExtension } from "./window/types.js";
import type { AnvilAction, FloatAction } from "./window/actions.js";
import { createSessionFlags, type SessionFlagsState } from "./window/session-flags.js";
import { EventScheduler } from "./event-scheduler.js";
import { TilingShadow } from "./tiling-shadow.js";
import { GnomeIntentionApplier } from "./gnome-intention-applier.js";
import { CoreTilingEffectDriver } from "./core-tiling-effect-driver.js";
import { selectTilingEngineMode, type TilingEngineMode } from "./tiling-engine-mode.js";
import { safeRaise } from "./mutter-safe.js";
import { GnomeContainerPresenter } from "./gnome-container-presenter.js";
import { GnomePreviewPresenter } from "./gnome-preview-presenter.js";
import { computeSnapLayout } from "./snap-layout.js";
import { DragPreviewPresenter, TreePresentation } from "./tree-presentation.js";

export type AnvilRuntimeState = "disabled" | "enabling" | "enabled" | "disabling";

export interface AnvilRuntimeTestProbe {
  forceRender(reason: string): void;
  getStateJson(): string;
  getMonitorConnector(index: number): string | null;
  clearResizeHistory(): void;
  clearRuntimeFloatOverridesForClass(wmClass: string): void;
  isFloatingExempt(metaWindow: Meta.Window | null): boolean;
}

export class AnvilRuntime extends GObject.Object implements AnvilRuntimeTestProbe {
  static {
    GObject.registerClass(this);
  }

  private ext: AnvilExtension;
  /** Synced with RulesEngine / ConfigManager (same object after reload). */
  private windowProps: WindowConfig | null = null;
  private _rules: RulesEngine | null = null;

  // --- State ---
  private declare prefsTitle: string;
  private declare disabled: boolean;
  /** Grouped transient flags (B2-3). Prefer this._session over new loose fields. */
  private _session!: SessionFlagsState;
  private _dragDrop: DragDropTile | null = null;
  private _signalManager: SignalManager | null = null;
  private _commandHandlerHost: CommandHandlerHost | null = null;
  private _wsMutationsHost: WorkspaceMutationsHost | null = null;
  private _wsMutations: WorkspaceMutations | null = null;
  private _renderScheduler: RenderScheduler | null = null;
  private _decorationLayout: DecorationLayout | null = null;

  // Compatibility accessors for session flags (tests / residual call sites).
  private get _freezeRender() {
    return this._session.freezeRender;
  }
  private set _freezeRender(v: boolean) {
    this._session.freezeRender = v;
  }
  private get _workspaceChanging() {
    return this._session.workspaceChanging;
  }
  private set _workspaceChanging(v: boolean) {
    this._session.workspaceChanging = v;
  }

  // --- Object references ---
  private _kbd: import("./keybindings.js").Keybindings | null = null;
  private _tree: Tree | null = null;
  private _eventScheduler: EventScheduler | null = null;
  private theme: import("./extension-theme-manager.js").ExtensionThemeManager | null = null;
  private _pointerPolicy: PointerPolicy | null = null;
  private _tilingRender: TilingRender | null = null;
  private _tilingShadow: TilingShadow | null = null;
  private _intentionApplier: GnomeIntentionApplier | null = null;
  private _containerPresenter: GnomeContainerPresenter | null = null;
  private _previewPresenter: GnomePreviewPresenter | null = null;
  private _coreEffectDriver: CoreTilingEffectDriver | null = null;
  private _tilingEngineMode: TilingEngineMode = "shadow";
  private _tilingShadowFailure: string | null = null;
  private _tilingShadowComparison: ReturnType<TilingShadow["compareObservedGeometry"]> | null =
    null;
  private _tracker: WindowTracker | null = null;
  private _layout: LayoutEngine | null = null;
  private _grab: GrabResizeSession | null = null;
  private _settingsBridge: SettingsBridge | null = null;
  private _focus: FocusController | null = null;
  private _borders: BorderController | null = null;
  private _treePresentation: TreePresentation | null = null;
  private _dragPreviewPresenter: DragPreviewPresenter | null = null;
  private declare nodeWinAtPointer: Node | null;
  private declare sortedWindows: Meta.Window[];

  /** CommandBus — typed AnvilAction dispatch (B3-1 / B10-2). */
  private _commandBus: CommandBus | null = null;
  private _state: AnvilRuntimeState = "disabled";

  constructor(ext: AnvilExtension) {
    super();
    this.ext = ext;
    // GNOME names the managed preferences window from extension metadata.
    // Using the same stable substring works across supported Shell versions,
    // whose decorations may add their own localized suffix.
    this.prefsTitle = ext.metadata.name;
    this.disabled = true;
    this._session = createSessionFlags();
  }

  private _initializeGraph(): void {
    this._treePresentation = new TreePresentation();
    this._dragPreviewPresenter = new DragPreviewPresenter();
    this._tilingEngineMode = selectTilingEngineMode(
      GLib.environ_getenv(GLib.get_environ(), "ANVIL_TILING_ENGINE")
    );
    this._eventScheduler = new EventScheduler();
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    this._rules = new RulesEngine();
    this.reloadWindowOverrides();
    this._tilingShadow = new TilingShadow(
      this.ext.settings,
      () => this._rules?.windowProps.overrides ?? [],
      (transition) => {
        if (self._tilingEngineMode === "core") self._coreEffectDriver?.consume(transition);
      }
    );
    this._containerPresenter = new GnomeContainerPresenter({
      resolveWindow: (id) => self._tilingShadow?.resolveWindow(id),
      toGlobalRect: (surface, rect) => self._tilingShadow!.toGlobalRect(surface, rect),
    });
    this._previewPresenter = new GnomePreviewPresenter({
      enabled: () => self.ext.settings.get_boolean("preview-hint-enabled"),
      toGlobalRect: (surface, rect) => self._tilingShadow!.toGlobalRect(surface, rect),
    });
    this._intentionApplier = new GnomeIntentionApplier({
      resolveWindow: (id) => self._tilingShadow?.resolveWindow(id),
      toGlobalRect: (surface, rect) => self._tilingShadow!.toGlobalRect(surface, rect),
      toLocalRect: (surface, rect) => self._tilingShadow!.toLocalRect(surface, rect),
      participationChanged: () => {
        // Core participation is authoritative; non-participant platform policy is Runtime-owned.
      },
      presentContainer: (intention) => self._containerPresenter?.present(intention),
      removeContainerPresentation: (containerId) => self._containerPresenter?.remove(containerId),
      raiseWindows: (metaWindows) => {
        metaWindows.forEach((metaWindow) => safeRaise(metaWindow));
      },
      presentPreview: (intention) => self._previewPresenter?.present(intention),
      clearPreview: (intention) => self._previewPresenter?.clear(intention.operationId),
    });
    this._coreEffectDriver = new CoreTilingEffectDriver(
      this._intentionApplier,
      this._eventScheduler,
      (facts) => self._tilingShadow?.observeFacts(facts),
      () => self._tilingShadow?.requestReconcile()
    );
    this._tilingShadowFailure = null;
    this._tilingShadowComparison = null;
    this._session = createSessionFlags();
    // Keybindings are wired separately; host getters remain valid across graph activation.
    // LayoutEngine precedes Tree so workspace activation can determine monitor layouts.
    this._layout = new LayoutEngine({
      get tree() {
        return self.tree;
      },
      get settings() {
        return self.ext.settings;
      },
      get focusMetaWindow() {
        return self.focusMetaWindow;
      },
      get currentMonWsNode() {
        return self.currentMonWsNode;
      },
      notifyFocusChanged: (n, s) => self.notifyFocusChanged(n, s),
      moveWindow: (w, rect) => self.move(w, rect),
      rectForMonitor: (n, i) => self.rectForMonitor(n, i),
      floatingWindow: (n) => self.floatingWindow(n),
    });
    // SignalManager owns workspace signal binding; host getters resolve after the graph is complete.
    this._signalManager = new SignalManager({
      get coreTilingEngine() {
        return self._tilingEngineMode === "core";
      },
      get tracker() {
        return self._tracker!;
      },
      get tree() {
        return self.tree;
      },
      get layout() {
        return self._layout!;
      },
      get settingsBridge() {
        return self._settingsBridge!;
      },
      renderTree: (from, force, borderRefresh) => self.renderTree(from, force, borderRefresh),
      trackCurrentMonWs: () => self.trackCurrentMonWs(),
      updateMetaWorkspaceMonitor: (from, mon, w) => self.updateMetaWorkspaceMonitor(from, mon, w),
      updateDecorationLayout: () => self.updateDecorationLayout(),
      updateBorderLayout: () => self.updateBorderLayout(),
      setActiveWindowDecoration: (window) => self.setActiveWindowDecoration(window),
      showingDesktop: () => Boolean(global.display.get_property("showing-desktop", null)),
      suspendWindowDecorations: () => self._borders!.suspendAll(),
      notifyWorkspaceSettled: () => self.notifyWorkspaceSettled(),
      notifyFocusChanged: (n, s) => self.notifyFocusChanged(n, s),
      isRenderFrozen: () => self._freezeRender,
      freezeRender: () => self.freezeRender(),
      unfreezeRender: () => self.unfreezeRender(),
      get workspaceChanging() {
        return self._workspaceChanging;
      },
      set workspaceChanging(v) {
        self._workspaceChanging = v;
      },
      updateStackedFocus: (n) => self.updateStackedFocus(n),
      updateTabbedFocus: (n) => self.updateTabbedFocus(n),
      handleGrabOpBegin: (d, m, g) => self._handleGrabOpBegin(d, m, g),
      handleGrabOpEnd: (d, m, g) => self._handleGrabOpEnd(d, m, g),
      get scheduler() {
        return self._eventScheduler!;
      },
      observePortableTopology: () =>
        self._withTilingShadow("topology", (shadow) => shadow.observeTopology()),
      observePortableWindow: (window) =>
        self._withTilingShadow("window", (shadow) => shadow.observeWindow(window)),
      observePortableWindows: () =>
        self._withTilingShadow("windows", (shadow) =>
          shadow.observeWindows(self.windowsAllWorkspaces)
        ),
    });
    this._tree = new Tree({
      get settings() {
        return self.ext.settings;
      },
      get focusMetaWindow() {
        return self.focusMetaWindow;
      },
      determineSplitLayout: () => self.determineSplitLayout(),
      floatingWindow: (n) => self.floatingWindow(n),
      bindWorkspaceSignals: (ws) => self.bindWorkspaceSignals(ws),
      get presentation() {
        return self._treePresentation!;
      },
    });
    this.theme = this.ext.theme;
    // Always construct PointerPolicy; enable/disable behavior via settings (B9-2).
    this._ensurePointerPolicy();
    this._tilingRender = new TilingRender({
      settings: this.ext.settings,
      getTree: () => this.tree,
      moveWindow: (metaWindow, rect) => this.move(metaWindow, rect),
      getAllNodeWindows: () => this.allNodeWindows,
      isFloatingExempt: (w) => this.isFloatingExempt(w),
      isActiveWindowWorkspaceTiled: (w) => this.isActiveWindowWorkspaceTiled(w),
      getTiledChildren: (nodes) => this.tree.getTiledChildren(nodes),
      getResizeCount: (id) => self._grab!.getResizeCount(id),
      findParent: (node, type) => this.tree.findParent(node, type),
      computeSizes: (n, c) => self._layout!.computeSizes(n, c),
      presentation: self._treePresentation!,
    });
    this._grab = new GrabResizeSession({
      get tree() {
        return self.tree;
      },
      get focusMetaWindow() {
        return self.focusMetaWindow;
      },
      get settings() {
        return self.ext.settings;
      },
      get nodeWinAtPointer() {
        return self.nodeWinAtPointer;
      },
      set nodeWinAtPointer(n) {
        self.nodeWinAtPointer = n;
      },
      get scheduler() {
        return self._eventScheduler!;
      },
      findNodeWindow: (w) => self.findNodeWindow(w),
      findNodeWindowAtPointer: (n) => self._dragDrop!.findNodeWindowAtPointer(n) ?? null,
      trackCurrentMonWs: () => self.trackCurrentMonWs(),
      freezeRender: () => self.freezeRender(),
      unfreezeRender: () => self.unfreezeRender(),
      renderTree: (from, force) => self.renderTree(from, force),
      move: (w, rect) => self.move(w, rect),
      calculateGaps: (n) => self._tilingRender!.calculateGaps(n),
      processNode: (n) => self._tilingRender!.processNode(n),
      getMonitorConstraints: (i) => self._tilingRender!.getMonitorConstraints(i),
      floatingWindow: (n) => !!self.floatingWindow(n),
      minimizedWindow: (n) => !!self.minimizedWindow(n),
      allowDragDropTile: () => Boolean(self.allowDragDropTile()),
      moveWindowToPointer: (n, preview) => self._dragDrop!.moveWindowToPointer(n, preview),
      updateStackedFocus: (n) => self.updateStackedFocus(n),
      updateTabbedFocus: (n) => self.updateTabbedFocus(n),
      observeGrabResizeUpdate: (window) =>
        self._withTilingShadow("grab-update", (shadow) => shadow.observeGrabUpdate(window)),
      observeGrabMoveUpdate: (window, pointer, eligible) =>
        self._withTilingShadow("grab-move-update", (shadow) =>
          shadow.observeGrabMoveUpdate(window, pointer, eligible)
        ),
      get previewPresenter() {
        return self._dragPreviewPresenter!;
      },
    });
    this._tracker = new WindowTracker({
      get coreTilingEngine() {
        return self._tilingEngineMode === "core";
      },
      get tree() {
        return self.tree;
      },
      get focusMetaWindow() {
        return self.focusMetaWindow;
      },
      get prefsTitle() {
        return self.prefsTitle;
      },
      get windowsAllWorkspaces() {
        return self.windowsAllWorkspaces;
      },
      get settings() {
        return self.ext.settings;
      },
      isFloatingExempt: (w) => self.isFloatingExempt(w),
      isActiveWindowWorkspaceTiled: (w) => self.isActiveWindowWorkspaceTiled(w),
      floatingWindow: (n) => self.floatingWindow(n),
      findNodeWindowByActor: (actor) =>
        self._treePresentation!.findWindowNodeByActor(self.tree, actor),
      reloadTree: (from) => self.reloadTree(from),
      updateMetaWorkspaceMonitor: (from, mon, w) => self.updateMetaWorkspaceMonitor(from, mon, w),
      updateMetaPositionSize: (w, from) => self.updateMetaPositionSize(w, from),
      renderTree: (from, force, borderRefresh) => {
        if (borderRefresh) self.renderTree(from, force, borderRefresh);
        else self.renderTree(from, force);
      },
      get scheduler() {
        return self._eventScheduler!;
      },
      unfreezeRender: () => self.unfreezeRender(),
      registerWindowDecoration: (window, actor) => self._borders!.registerWindow(window, actor),
      unregisterWindowDecoration: (window, actorDestroyed) =>
        self._borders!.unregisterWindow(window, actorDestroyed),
      updateBorderLayout: () => self.updateBorderLayout(),
      setActiveWindowDecoration: (nextWindow) => self.setActiveWindowDecoration(nextWindow),
      reconcileWindowDecoration: (metaWindow) => self._borders!.reconcileWindow(metaWindow),
      reconcileActiveWindowDecoration: () => self._borders!.reconcileActiveWindow(),
      updateDecorationLayout: () => self.updateDecorationLayout(),
      updateStackedFocus: (n) => self.updateStackedFocus(n),
      updateTabbedFocus: (n) => self.updateTabbedFocus(n),
      notifyFocusChanged: (n, s) => self.notifyFocusChanged(n, s),
      moveCenter: (w) => self.moveCenter(w),
      removeFloatOverride: (w, withWmId) => self.removeFloatOverride(w, withWmId),
      trackCurrentMonWs: () => self.trackCurrentMonWs(),
      autoSplitFromFocus: () => self.layoutEngine.autoSplitFromFocus(),
      observePortableWindow: (w) =>
        self._withTilingShadow("window", (shadow) => shadow.observeWindow(w)),
      observePortableFrame: (w) => self._observePortableFrame(w),
      observePortableFocus: (w) =>
        self._withTilingShadow("focus", (shadow) => shadow.observeFocus(w)),
      withdrawPortableWindow: (w) =>
        self._withTilingShadow("withdraw", (shadow) => shadow.withdrawWindow(w)),
    });
    this._settingsBridge = new SettingsBridge({
      get settings() {
        return self.ext.settings;
      },
      get tree() {
        return self.tree;
      },
      reloadWindowOverrides: () => self.reloadWindowOverrides(),
      updateBorderLayout: () => self.updateBorderLayout(),
      pointerPolicyNeeded: () => self._pointerPolicyNeeded(),
      ensurePointerPolicy: () => self._ensurePointerPolicy(),
      teardownPointerPolicy: () => self._teardownPointerPolicy(),
      setHoverFocusEnabled: (enabled) => {
        self._pointerPolicy?.setHoverFocusEnabled(enabled);
      },
      renderTree: (from, force) => self.renderTree(from, force),
      determineSplitLayout: () => self.determineSplitLayout(),
      refreshStylesheet: () => {
        self.theme?.refreshStylesheet();
      },
      cleanupAlwaysFloat: () => self.cleanupAlwaysFloat(),
      restoreAlwaysFloat: () => self.restoreAlwaysFloat(),
      clearResizedWindows: () => self._grab!.clearResizedWindows(),
      suspendGrabResizeTilingEffects: () => self._grab!.suspendTilingEffects(),
      observePortablePolicy: () =>
        self._withTilingShadow("policy", (shadow) => shadow.observePolicy()),
    });
    this._focus = new FocusController({
      get layoutEngine() {
        return self._layout!;
      },
      isRenderFrozen: () => self._freezeRender,
      get scheduler() {
        return self._eventScheduler!;
      },
      renderTree: (from, force) => self.renderTree(from, force),
    });
    this._borders = new BorderController({
      get tree() {
        return self.tree;
      },
      get settings() {
        return self.ext.settings;
      },
      get focusMetaWindow() {
        return self.focusMetaWindow;
      },
      findNodeWindow: (w) => self.findNodeWindow(w),
    });
    this._dragDrop = new DragDropTile({
      get tree() {
        return self.tree;
      },
      get settings() {
        return self.ext.settings;
      },
      get layoutEngine() {
        return self._layout!;
      },
      get nodeWinAtPointer() {
        return self.nodeWinAtPointer;
      },
      get cancelGrab() {
        return self._grab!.cancelGrab;
      },
      get sortedWindows() {
        return self.sortedWindows;
      },
      renderTree: (from, force) => self.renderTree(from, force),
      processGap: (n) => self._tilingRender!.processGap(n),
      presentation: self._treePresentation!,
      previewPresenter: self._dragPreviewPresenter!,
    });
    this._initCommandHandlers();
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self2 = this;
    this._wsMutationsHost = {
      get tree() {
        return self2.tree;
      },
      get settings() {
        return self2.ext.settings;
      },
      get layoutEngine() {
        return self2._layout!;
      },
      get focusMetaWindow() {
        return self2.focusMetaWindow;
      },
      get grabOp() {
        return self2._grab!.grabOp;
      },
      get sortedWindows() {
        return self2.sortedWindows;
      },
      set sortedWindows(v) {
        self2.sortedWindows = v;
      },
      findNodeWindow: (w) => self2.findNodeWindow(w),
      renderTree: (from, force) => self2.renderTree(from, force),
      updateBorderLayout: () => self2.updateBorderLayout(),
      updateDecorationLayout: () => self2.updateDecorationLayout(),
      updateStackedFocus: (n) => self2.updateStackedFocus(n),
      updateTabbedFocus: (n) => self2.updateTabbedFocus(n),
      floatingWindow: (n) => self2.floatingWindow(n),
      validWindow: (w) => self2._tracker!.validWindow(w),
      handleResizing: (n) => self2._grab!.handleResizing(n),
      handleMoving: (n) => self2._grab!.handleMoving(n),
      grabModeFor: (n) => self2._grab!.grabModeFor(n),
    };
    this._wsMutations = new WorkspaceMutations(this._wsMutationsHost!);
    this._renderScheduler = new RenderScheduler({
      isRenderFrozen: () => self2._freezeRender,
      freezeRender: () => self2.freezeRender(),
      unfreezeRender: () => self2.unfreezeRender(),
      updateDecorationLayout: () => self2.updateDecorationLayout(),
      updateBorderLayout: () => self2.updateBorderLayout(),
      tilingRenderRender: (from) => self2._tilingRender!.render(from),
      recordSettledTilingComparison: () => self2._recordSettledTilingComparison(),
      trackCurrentWindows: () => self2._tracker!.trackCurrentWindows(),
      treeReinitializeWorkspaces: () => self2.tree._initWorkspaces(),
      treeResetRoot: () => self2.tree.reset(),
      disableDecorations: () => Utils._disableDecorations(),
      get tilingModeEnabled() {
        return self2.ext.settings.get_boolean("tiling-mode-enabled");
      },
    });
    this._decorationLayout = new DecorationLayout({
      isRenderFrozen: () => self2._freezeRender,
      get tree() {
        return self2.tree;
      },
      get focusMetaWindow() {
        return self2.focusMetaWindow;
      },
      get settings() {
        return self2.ext.settings;
      },
      get presentation() {
        return self2._treePresentation!;
      },
    });

    Logger.info("anvil runtime graph initialized");
  }

  get state(): AnvilRuntimeState {
    return this._state;
  }

  private _assertEnabled(operation: string): void {
    if (this._state !== "enabled") {
      throw new Error(`AnvilRuntime.${operation} used while ${this._state}`);
    }
  }

  private get pointerPolicy() {
    return this._pointerPolicy;
  }

  private get tilingRender() {
    return this._tilingRender!;
  }

  private get layoutEngine() {
    return this._layout!;
  }

  private get shouldFocusOnHover() {
    return this._pointerPolicy?.hoverFocusEnabled ?? false;
  }

  private set shouldFocusOnHover(enabled: boolean) {
    this._ensurePointerPolicy();
    this._pointerPolicy!.setHoverFocusEnabled(enabled);
  }

  private _pointerPolicyNeeded(): boolean {
    const settings = this.ext.settings;
    if (!settings) return false;
    return (
      settings.get_boolean("focus-on-hover-enabled") ||
      settings.get_boolean("move-pointer-focus-enabled")
    );
  }

  private _ensurePointerPolicy(): void {
    if (this._pointerPolicy) return;
    this._pointerPolicy = new PointerPolicy({
      settings: this.ext.settings,
      isWorkspaceChanging: () => this._workspaceChanging,
      isDisabled: () => this.disabled,
    });
    this._pointerPolicy.setHoverFocusEnabled(
      !!this.ext.settings?.get_boolean("focus-on-hover-enabled")
    );
  }

  /**
   * Disable pointer features without destroying the instance (B9-2 always-on).
   * Full dispose only on extension disable via disposePointerPolicy().
   */
  private _teardownPointerPolicy(): void {
    if (!this._pointerPolicy) return;
    this._pointerPolicy.setHoverFocusEnabled(false);
    this._pointerPolicy.disable();
  }

  private _disposePointerPolicy(): void {
    if (!this._pointerPolicy) return;
    this._pointerPolicy.disable();
    this._pointerPolicy = null;
  }

  private notifyFocusChanged(node: Node | null, source: PointerFocusSource) {
    if (this._pointerPolicy) {
      this._pointerPolicy.onFocusChanged({ node, source });
    }
    if (node) this.tree.debugParentNodes(node);
  }

  private notifyWorkspaceSettled() {
    this._pointerPolicy?.onWorkspaceSettled();
    if (this._tilingEngineMode === "shadow") this._recordSettledTilingComparison();
  }

  private addFloatOverride(metaWindow: Meta.Window, withWmId: boolean) {
    this._rules!.addFloatOverride(metaWindow, withWmId, this.ext.configMgr);
    this.windowProps = this._rules!.windowProps;
  }

  private removeFloatOverride(metaWindow: Meta.Window, withWmId: boolean) {
    this._rules!.removeFloatOverride(metaWindow, withWmId, this.ext.configMgr);
    this.windowProps = this._rules!.windowProps;
  }

  /** @deprecated Use commandToggleFloatingMode() from command-handlers.js. Kept for test surface. */
  private toggleFloatingMode(action: FloatAction, metaWindow: Meta.Window) {
    commandToggleFloatingMode(this._commandHandlerHost!, action, metaWindow);
  }

  private cleanupAlwaysFloat() {
    // remove the setting for each node window
    this.allNodeWindows.forEach((w) => {
      if (w.mode === WINDOW_MODES.FLOAT) {
        const mw = w.nodeValue as Meta.Window;
        if (mw.is_above()) mw.unmake_above();
      }
    });
  }

  private restoreAlwaysFloat() {
    this.allNodeWindows.forEach((w) => {
      if (w.mode === WINDOW_MODES.FLOAT) {
        const mw = w.nodeValue as Meta.Window;
        if (!mw.is_above()) mw.make_above();
      }
    });
  }

  private trackCurrentMonWs() {
    if (this._tilingEngineMode === "core") return;
    this._wsMutations!.trackCurrentMonWs();
  }

  // SignalManager owns signal connect/disconnect; this private adapter satisfies TreeHost.
  private bindWorkspaceSignals(metaWorkspace: Meta.Workspace) {
    this._signalManager!.bindWorkspaceSignals(metaWorkspace);
  }

  /**
   * Wire CommandBus to private handlers. New commands: extend AnvilAction and
   * CommandBusHost — do not reintroduce a mega-switch (architecture rule 3).
   */
  private _initCommandHandlers() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    this._commandHandlerHost = {
      get tree() {
        return self.tree;
      },
      get focusMetaWindow() {
        return self.focusMetaWindow;
      },
      get settings() {
        return self.ext.settings;
      },
      get ext() {
        return self.ext;
      },
      get layoutEngine() {
        return self._layout!;
      },
      get focusController() {
        return self._focus!;
      },
      get tilingRender() {
        return self._tilingRender!;
      },
      get rulesEngine() {
        return self._rules!;
      },
      get scheduler() {
        return self._eventScheduler!;
      },
      get prefsTitle() {
        return self.prefsTitle;
      },
      findNodeWindow: (w) => self.findNodeWindow(w),
      move: (w, rect) => self.move(w, rect),
      moveCenter: (w) => self.moveCenter(w),
      renderTree: (from, force) => self.renderTree(from, force),
      notifyFocusChanged: (n, s) => self.notifyFocusChanged(n, s),
      updateStackedFocus: (n) => self.updateStackedFocus(n),
      updateTabbedFocus: (n) => self.updateTabbedFocus(n),
      isActiveWindowWorkspaceTiled: (w) => self.isActiveWindowWorkspaceTiled(w),
      isFloatingExempt: (w) => self.isFloatingExempt(w),
      floatWorkspace: (i) => self.floatWorkspace(i),
      unfloatWorkspace: (i) => self.unfloatWorkspace(i),
      floatAllWindows: () => self.floatAllWindows(),
      unfloatAllWindows: () => self.unfloatAllWindows(),
      addFloatOverride: (w, withWmId) => self.addFloatOverride(w, withWmId),
      removeFloatOverride: (w, withWmId) => self.removeFloatOverride(w, withWmId),
      beginGrab: (m, g) => self._handleGrabOpBegin(global.display, m, g),
      endGrab: (m, g) => self._handleGrabOpEnd(global.display, m, g),
      setCancelGrab: (v) => {
        self._grab!.cancelGrab = v;
      },
      isRenderFrozen: () => self._freezeRender,
      freezeRender: () => self.freezeRender(),
      unfreezeRender: () => self.unfreezeRender(),
    };
    this._commandBus = new CommandBus(createCommandHandlers(this._commandHandlerHost!));
  }

  /** Dispatch a typed user action via CommandBus (B3-1). */
  command(action: AnvilAction) {
    this._assertEnabled("command");
    if (this._tilingEngineMode === "core") {
      if (this._handleCorePlatformCommand(action)) return;
      let handledByCore = false;
      this._withTilingShadow("command", (shadow) => {
        handledByCore = shadow.observeCommand(action, this.focusMetaWindow);
      });
      if (!handledByCore) Logger.warn(`core tiling command unsupported (${action.name})`);
      return;
    }
    this._withTilingShadow("command", (shadow) => {
      shadow.observeCommand(action, this.focusMetaWindow);
    });
    this._commandBus!.dispatch(action);
  }

  private _handleCorePlatformCommand(action: AnvilAction): boolean {
    if (action.name === "FocusBorderToggle") {
      const enabled = this.ext.settings.get_boolean("focus-border-toggle");
      this.ext.settings.set_boolean("focus-border-toggle", !enabled);
      return true;
    }
    if (action.name === "GapSize") {
      const current = this.ext.settings.get_uint("window-gap-size-increment");
      this.ext.settings.set_uint(
        "window-gap-size-increment",
        Math.max(0, Math.min(8, current + action.amount))
      );
      this._withTilingShadow("gap-policy", (shadow) => shadow.observePolicy());
      return true;
    }
    if (action.name === "TilingModeToggle") {
      const enabled = this.ext.settings.get_boolean("tiling-mode-enabled");
      this.ext.settings.set_boolean("tiling-mode-enabled", !enabled);
      this._withTilingShadow("tiling-policy", (shadow) => shadow.observePolicy());
      return true;
    }
    if (action.name === "WorkspaceActiveTileToggle") {
      const active = `${global.workspace_manager.get_active_workspace_index()}`;
      const skipped = this.ext.settings
        .get_string("workspace-skip-tile")
        .split(",")
        .filter(Boolean);
      const next = skipped.includes(active)
        ? skipped.filter((workspace) => workspace !== active)
        : [...skipped, active];
      this.ext.settings.set_string("workspace-skip-tile", next.join(","));
      this._withTilingShadow("workspace-policy", (shadow) => shadow.observePolicy());
      return true;
    }
    if (action.name === "CancelOperation") {
      this._withTilingShadow("cancel-operation", (shadow) => shadow.cancelOperation());
      return true;
    }
    if (action.name === "PrefsOpen") {
      const existing = Utils.findWindowWith(this.prefsTitle, Utils.PREFERENCES_WINDOW_CLASS);
      if (existing?.get_workspace()) {
        existing.get_workspace()!.activate_with_focus(existing, global.display.get_current_time());
        this.moveCenter(existing);
      } else {
        this.ext.openPreferences();
      }
      return true;
    }
    if (action.name === "WindowClose") {
      this.focusMetaWindow?.delete(global.display.get_current_time());
      return true;
    }
    if (action.name === "WindowSwapLastActive") {
      const focused = this.focusMetaWindow;
      if (!focused) return true;
      const target = global.display.get_tab_next(
        Meta.TabList.NORMAL,
        global.display.get_workspace_manager().get_active_workspace(),
        focused,
        false
      );
      if (target) {
        this._withTilingShadow("swap-last-active", (shadow) =>
          shadow.observeWindowSwap(focused, target)
        );
      }
      return true;
    }
    if (action.name === "WindowResize") {
      const metaWindow = this.focusMetaWindow;
      if (!metaWindow) return true;
      const grabOp = {
        Right: Meta.GrabOp.KEYBOARD_RESIZING_E,
        Left: Meta.GrabOp.KEYBOARD_RESIZING_W,
        Top: Meta.GrabOp.KEYBOARD_RESIZING_N,
        Bottom: Meta.GrabOp.KEYBOARD_RESIZING_S,
      }[action.direction];
      this._withTilingShadow("keyboard-resize", (shadow) =>
        shadow.observeKeyboardResize(metaWindow, grabOp, action.amount)
      );
      return true;
    }
    if (action.name === "SnapLayoutMove") {
      this._handleCoreSnapLayoutMove(action);
      return true;
    }
    if (action.name === "ShowTabDecorationToggle") {
      if (!this.ext.settings.get_boolean("tabbed-tiling-mode-enabled")) return true;
      const showTabs = this.ext.settings.get_boolean("showtab-decoration-enabled");
      this.ext.settings.set_boolean("showtab-decoration-enabled", !showTabs);
      this._withTilingShadow("tab-decoration-policy", (shadow) => shadow.observePolicy());
      return true;
    }
    if (action.name !== "FloatClassToggle") return false;
    const metaWindow = this.focusMetaWindow;
    if (!metaWindow) return true;
    if (this.isFloatingExempt(metaWindow)) {
      this.removeFloatOverride(metaWindow, false);
    } else {
      this.addFloatOverride(metaWindow, false);
    }
    this._withTilingShadow("float-class-policy", (shadow) => shadow.observePolicy());
    return true;
  }

  private _handleCoreSnapLayoutMove(action: Extract<AnvilAction, { name: "SnapLayoutMove" }>) {
    const metaWindow = this.focusMetaWindow;
    if (!metaWindow) return;
    const snap = computeSnapLayout(
      action.direction,
      metaWindow.get_work_area_current_monitor(),
      action.amount,
      metaWindow.get_frame_rect()
    );
    if (!snap) return;
    const requested = snap.rect;
    const rectRequest = {
      x: requested.x,
      y: requested.y,
      width: requested.width,
      height: requested.height,
    };
    let rect = {
      x: Utils.resolveX(rectRequest, metaWindow),
      y: Utils.resolveY(rectRequest, metaWindow),
      width: requested.width,
      height: requested.height,
    };
    if (snap.processGap) {
      const gap =
        this.ext.settings.get_uint("window-gap-size") *
        this.ext.settings.get_uint("window-gap-size-increment");
      if (rect.width > gap * 2 && rect.height > gap * 2) {
        rect = {
          x: rect.x + gap,
          y: rect.y + gap,
          width: rect.width - gap * 2,
          height: rect.height - gap * 2,
        };
      }
    }
    if (!this.isFloatingExempt(metaWindow)) this.addFloatOverride(metaWindow, false);
    this._withTilingShadow("snap-policy", (shadow) => shadow.observePolicy());
    this.move(metaWindow, rect);
  }

  private _withTilingShadow(name: string, callback: (shadow: TilingShadow) => void): void {
    const shadow = this._tilingShadow;
    if (!shadow) return;
    try {
      callback(shadow);
    } catch (error) {
      this._tilingShadowFailure = `${name}: ${error}`;
      this._tilingShadow = null;
      this._tilingShadowComparison = null;
      Logger.warn(`portable tiling shadow disabled (${this._tilingShadowFailure})`);
    }
  }

  private _observePortableFrame(metaWindow: Meta.Window): void {
    this._withTilingShadow("frame", (shadow) => {
      shadow.observeFrame(metaWindow);
      if (this._tilingEngineMode !== "core") return;
      shadow.observeGrabUpdate(metaWindow);
      const [x, y] = global.get_pointer() as unknown as [number, number];
      shadow.observeGrabMoveUpdate(metaWindow, [x, y], Boolean(this.allowDragDropTile()));
    });
  }

  private _recordSettledTilingComparison(): void {
    this._withTilingShadow("comparison", (shadow) => {
      this._tilingShadowComparison = shadow.compareObservedGeometry();
    });
  }

  /** Injectable command bus for tests / keybinding service (B10-2). */
  private get commandBus(): CommandBus {
    return this._commandBus!;
  }

  /** @deprecated Use commandResize() from command-handlers.js. Kept for test surface. */
  private resize(grabOp: Meta.GrabOp, amount: number) {
    commandResize(this._commandHandlerHost!, grabOp, amount);
  }

  private _stopLiveResizeLoop() {
    this._grab!.dispose();
  }

  disable() {
    if (this._state === "disabled" || this._state === "disabling") return;
    this._state = "disabling";
    this.disabled = true;
    this._disposeGraph();
    this._state = "disabled";
    Logger.debug(`runtime:disable`);
  }

  private _disposeGraph(): void {
    const safely = (name: string, dispose: () => void) => {
      try {
        dispose();
      } catch (error) {
        Logger.warn(`runtime cleanup failed (${name}): ${error}`);
      }
    };
    // Stop new delayed work before disconnecting producers and owners.
    safely("event scheduler", () => this._eventScheduler?.dispose());
    safely("core container presentation", () => this._containerPresenter?.destroy());
    safely("core previews", () => this._previewPresenter?.destroy());
    safely("drag preview", () => this._dragPreviewPresenter?.destroy());
    safely("decorations", () => Utils._disableDecorations());
    safely("signals", () => this._signalManager?.unbindAll());
    safely("borders", () => this._borders?.destroy());
    safely("tree presentation", () => this._treePresentation?.destroy());
    safely("tracker", () => this._tracker?.dispose());
    safely("grab-resize", () => this._grab?.dispose());
    safely("settings", () => this._settingsBridge?.disable());
    safely("render scheduler", () => this._renderScheduler?.dispose());
    safely("pointer policy", () => this._disposePointerPolicy());
    safely("tiling tree", () => this._tree?.dispose());
    this._rules = null;
    this._dragDrop = null;
    this._signalManager = null;
    this._commandHandlerHost = null;
    this._wsMutationsHost = null;
    this._wsMutations = null;
    this._renderScheduler = null;
    this._decorationLayout = null;
    this._tree = null;
    this._eventScheduler = null;
    this._tilingRender = null;
    this._coreEffectDriver = null;
    this._intentionApplier = null;
    this._containerPresenter = null;
    this._previewPresenter = null;
    this._tilingShadow = null;
    this._tilingShadowComparison = null;
    this._tracker = null;
    this._layout = null;
    this._grab = null;
    this._settingsBridge = null;
    this._focus = null;
    this._borders = null;
    this._treePresentation = null;
    this._dragPreviewPresenter = null;
    this._commandBus = null;
    this.windowProps = null;
  }

  enable() {
    if (this._state === "enabled" || this._state === "enabling") return;
    this._state = "enabling";
    const rollback: Array<() => void> = [];
    try {
      this._initializeGraph();
      rollback.push(() => this._disposeGraph());
      this.disabled = false;
      this._tree!.initialize();
      rollback.push(() => this._tree?.dispose());
      this._signalManager!.bindAll();
      rollback.push(() => this._signalManager?.unbindAll());
      this._withTilingShadow("bootstrap", (shadow) =>
        shadow.bootstrap(this.windowsAllWorkspaces, (window) => this._tracker!.validWindow(window))
      );
      if (this._tilingEngineMode === "shadow") this.reloadTree("enable");
      rollback.push(() => this._renderScheduler?.dispose());
      this._state = "enabled";
      Logger.debug(`runtime:enable`);
    } catch (error) {
      this.disabled = true;
      for (const undo of rollback.reverse()) {
        try {
          undo();
        } catch (rollbackError) {
          Logger.warn(`runtime enable rollback failed: ${rollbackError}`);
        }
      }
      // Construction may fail before its rollback is registered.
      if (rollback.length === 0) this._disposeGraph();
      this._state = "disabled";
      throw error;
    }
  }

  /**
   * Wire keybindings after both AnvilRuntime and Keybindings are constructed.
   * Call from AnvilExtension.enable — never create Keybindings in a getter.
   * @see .agents/rules/architecture.md lifecycle and dependency rules
   */
  wireKeybindings(kbd: Keybindings) {
    this._kbd = kbd;
  }

  private findNodeWindow(metaWindow: Meta.Window) {
    return this.tree.findNode(metaWindow);
  }

  private get focusMetaWindow() {
    return global.display.get_focus_window();
  }

  private get tree() {
    if (!this._tree!) throw new Error("AnvilRuntime tree unavailable while disabled");
    return this._tree!;
  }

  private get kbd() {
    // No lazy construction (B4-9). Must be wired via wireKeybindings() after
    // AnvilExtension constructs Keybindings.
    if (!this._kbd) {
      throw new Error("AnvilRuntime.kbd used before wireKeybindings()");
    }
    return this._kbd;
  }

  private get windowsAllWorkspaces() {
    const wsManager = global.workspace_manager;
    const windowsAll: Meta.Window[] = [];

    for (let i = 0; i < wsManager.get_n_workspaces(); i++) {
      Array.prototype.push.apply(
        windowsAll,
        global.display.get_tab_list(Meta.TabList.NORMAL_ALL, wsManager.get_workspace_by_index(i))
      );
    }
    windowsAll.sort((w1, w2) => {
      return w1.get_stable_sequence() - w2.get_stable_sequence();
    });
    return windowsAll;
  }

  private getWindowsOnWorkspace(workspaceIndex: number) {
    return this._wsMutations!.getWindowsOnWorkspace(workspaceIndex);
  }

  private determineSplitLayout() {
    return this._layout!.determineSplitLayout();
  }

  private floatWorkspace(workspaceIndex: number) {
    this._wsMutations!.floatWorkspace(workspaceIndex);
  }

  private unfloatWorkspace(workspaceIndex: number) {
    this._wsMutations!.unfloatWorkspace(workspaceIndex);
  }

  private setActiveWindowDecoration(nextWindow: Meta.Window | null) {
    this._borders!.setActiveWindow(nextWindow);
    this._treePresentation!.syncActiveTab(nextWindow ? this.tree.findNode(nextWindow) : null);
  }

  // Window movement API
  private move(
    metaWindow: Meta.Window,
    rect: { x: number; y: number; width: number; height: number }
  ) {
    if (!metaWindow) return;
    if ((metaWindow as any).grabbed) return;
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

    const windowActor = metaWindow.get_compositor_private() as AnvilWindowActor | null;
    if (!windowActor) return;
    windowActor.remove_all_transitions();

    metaWindow.move_frame(true, rect.x, rect.y);
    metaWindow.move_resize_frame(true, rect.x, rect.y, rect.width, rect.height);
  }

  private moveCenter(metaWindow: Meta.Window) {
    if (!metaWindow) return;
    const frameRect = metaWindow.get_frame_rect();
    const rectRequest = {
      x: "center",
      y: "center",
      width: frameRect.width,
      height: frameRect.height,
    };

    const moveRect = {
      x: Utils.resolveX(rectRequest, metaWindow),
      y: Utils.resolveY(rectRequest, metaWindow),
      width: Utils.resolveWidth(rectRequest, metaWindow),
      height: Utils.resolveHeight(rectRequest, metaWindow),
    };
    this.move(metaWindow, moveRect);
  }

  private rectForMonitor(node: Node, targetMonitor: number) {
    if (!node || (node && node.nodeType !== NODE_TYPES.WINDOW)) return null;
    if (targetMonitor < 0) return null;
    const metaWindow = node.nodeValue as Meta.Window;
    const currentWorkArea = metaWindow.get_work_area_current_monitor();
    const nextWorkArea = metaWindow.get_work_area_for_monitor(targetMonitor);

    if (currentWorkArea && nextWorkArea) {
      let rect: RectLike | null = node.rect;
      if (!rect && node.mode === WINDOW_MODES.FLOAT) {
        rect = metaWindow.get_frame_rect();
      }
      if (!rect) return null;
      const hRatio = nextWorkArea.height / currentWorkArea.height;
      const wRatio = nextWorkArea.width / currentWorkArea.width;
      rect.height *= hRatio;
      rect.width *= wRatio;

      if (nextWorkArea.y < currentWorkArea.y) {
        rect.y =
          ((nextWorkArea.y + rect.y - currentWorkArea.y) / currentWorkArea.height) *
          nextWorkArea.height;
      } else if (nextWorkArea.y > currentWorkArea.y) {
        rect.y = (rect.y / currentWorkArea.height) * nextWorkArea.height + nextWorkArea.y;
      }

      if (nextWorkArea.x < currentWorkArea.x) {
        rect.x =
          ((nextWorkArea.x + rect.x - currentWorkArea.x) / currentWorkArea.width) *
          nextWorkArea.width;
      } else if (nextWorkArea.x > currentWorkArea.x) {
        rect.x = (rect.x / currentWorkArea.width) * nextWorkArea.width + nextWorkArea.x;
      }
      return rect;
    }
    return null;
  }

  private renderTree(
    from: string,
    force: boolean = false,
    borderRefresh: BorderRefreshMode = "full"
  ) {
    if (this._tilingEngineMode === "core") return;
    this._renderScheduler!.renderTree(from, force, borderRefresh);
  }

  private get allNodeWindows() {
    return this.tree.getNodeByType(NODE_TYPES.WINDOW);
  }

  /**
   * Reloads the tree. This is an expensive operation.
   * Useful when using dynamic workspaces in GNOME-shell.
   *
   * TODO: add support to reload the tree from a JSON dump file.
   * TODO: move this to tree.js
   */
  private reloadTree(from: string) {
    if (this._tilingEngineMode === "core") return;
    this._renderScheduler!.reloadTree(from);
  }

  private updateBorderLayout() {
    this._borders!.reconcileAll();
  }

  private updateStackedFocus(focusNodeWindow: Node | undefined | null) {
    this._focus!.updateStackedFocus(focusNodeWindow);
  }

  private updateTabbedFocus(focusNodeWindow: Node | null | undefined) {
    this._focus!.updateTabbedFocus(focusNodeWindow);
  }

  /**
   * Check if a Meta Window's workspace is skipped for tiling.
   */
  private isActiveWindowWorkspaceTiled(metaWindow: Meta.Window) {
    return this._wsMutations!.isActiveWindowWorkspaceTiled(metaWindow);
  }

  /**
   * Check the current active workspace's tiling mode
   */
  private isCurrentWorkspaceTiled() {
    return this._wsMutations!.isCurrentWorkspaceTiled();
  }

  private updateMetaWorkspaceMonitor(
    from: string,
    _monitor: number | null,
    metaWindow: Meta.Window
  ) {
    if (this._tilingEngineMode === "core") return;
    this._wsMutations!.updateMetaWorkspaceMonitor(from, _monitor, metaWindow);
  }

  /**
   * Handle any updates to the current focused window's position.
   * Useful for updating the active window border, etc.
   */
  private updateMetaPositionSize(_metaWindow: Meta.Window, from: string) {
    if (this._tilingEngineMode === "core") return;
    this._wsMutations!.updateMetaPositionSize(_metaWindow, from);
  }

  private updateDecorationLayout() {
    if (this._tilingEngineMode === "core") return;
    this._decorationLayout!.updateDecorationLayout();
  }

  private freezeRender() {
    this._freezeRender = true;
  }

  private unfreezeRender() {
    this._freezeRender = false;
  }

  private floatingWindow(node: Node | null) {
    if (!node) return false;
    return node.nodeType === NODE_TYPES.WINDOW && node.mode === WINDOW_MODES.FLOAT;
  }

  private minimizedWindow(node: Node | null) {
    if (!node) return false;
    return node._type === NODE_TYPES.WINDOW && node._data && (node._data as Meta.Window).minimized;
  }

  /**
   * Handle previewing and applying where a drag-drop window is going to be tiled.
   * @deprecated Use this._dragDrop!.moveWindowToPointer() directly.
   */
  private moveWindowToPointer(focusNodeWindow: Node, preview: boolean = false) {
    this._dragDrop!.moveWindowToPointer(focusNodeWindow, preview);
  }

  /**
   * @deprecated Use this._dragDrop!.findNodeWindowAtPointer() directly.
   */
  private findNodeWindowAtPointer(focusNodeWindow: Node) {
    return this._dragDrop!.findNodeWindowAtPointer(focusNodeWindow);
  }

  private _handleGrabOpBegin(display: Meta.Display, metaWindow: Meta.Window, grabOp: Meta.GrabOp) {
    this._withTilingShadow("grab-begin", (shadow) => shadow.observeGrabBegin(metaWindow, grabOp));
    if (this._tilingEngineMode === "core") return;
    this._grab!.begin(display, metaWindow, grabOp);
  }

  private _handleGrabOpEnd(display: Meta.Display, metaWindow: Meta.Window, grabOp: Meta.GrabOp) {
    if (this._tilingEngineMode === "core") {
      const moving = Utils.grabMode(grabOp) === GRAB_TYPES.MOVING;
      const commitDrag = moving && Boolean(this.allowDragDropTile());
      this._withTilingShadow("grab-final-update", (shadow) => {
        if (moving) {
          const [x, y] = global.get_pointer() as unknown as [number, number];
          shadow.observeGrabMoveUpdate(metaWindow, [x, y], commitDrag);
        } else {
          shadow.observeGrabUpdate(metaWindow);
        }
      });
      this._withTilingShadow("grab-end", (shadow) =>
        shadow.observeGrabEnd(metaWindow, false, commitDrag)
      );
      return;
    }
    const beganPointerDrag =
      this._grab!.grabOp === Meta.GrabOp.MOVING ||
      this._grab!.grabOp === Meta.GrabOp.MOVING_UNCONSTRAINED ||
      this._grab!.grabOp === Meta.GrabOp.WINDOW_BASE;
    const dragEndKind =
      grabOp === Meta.GrabOp.MOVING_UNCONSTRAINED || grabOp === Meta.GrabOp.WINDOW_BASE;
    const commitDrag =
      beganPointerDrag &&
      dragEndKind &&
      !this._grab!.cancelGrab &&
      Boolean(this.allowDragDropTile());
    if (beganPointerDrag) {
      const [x, y] = global.get_pointer() as unknown as [number, number];
      this._withTilingShadow("grab-move-update", (shadow) =>
        shadow.observeGrabMoveUpdate(metaWindow, [x, y], commitDrag)
      );
    } else {
      this._withTilingShadow("grab-update", (shadow) => shadow.observeGrabUpdate(metaWindow));
    }
    this._withTilingShadow("grab-end", (shadow) =>
      shadow.observeGrabEnd(metaWindow, this._grab!.cancelGrab, commitDrag)
    );
    this._grab!.end(display, metaWindow, grabOp);
  }

  private _grabCleanup(focusNodeWindow: Node | null) {
    this._grab!.cleanup(focusNodeWindow);
  }

  private allowDragDropTile() {
    return this.kbd.allowDragDropTile();
  }

  /** Float/tile classification — delegated to RulesEngine (sole owner). */
  isFloatingExempt(metaWindow: Meta.Window | null) {
    // Keep the RulesEngine cache aligned with the runtime configuration snapshot.
    this._rules!.windowProps = this.windowProps!;
    return this._rules!.isFloatingExempt(metaWindow);
  }

  private get currentMonWsNode() {
    const monWs = this.currentMonWs;
    if (monWs) {
      return this.tree.findNode(monWs);
    }
    return null;
  }

  private get currentWsNode() {
    const ws = this.currentWs;
    if (ws) {
      return this.tree.findNode(ws);
    }
    return null;
  }

  private get currentMonWs() {
    const monWs = `${this.currentMon}${this.currentWs}`;
    return monWs;
  }

  private get currentWs() {
    const display = global.display;
    const wsMgr = display.get_workspace_manager();
    return `ws${wsMgr.get_active_workspace_index()}`;
  }

  private get currentMon() {
    const display = global.display;
    return `mo${display.get_current_monitor()}`;
  }

  /**
   * Reload window overrides from the configuration file
   * This is called when the preferences page modifies the overrides
   */
  private reloadWindowOverrides() {
    this._rules!.reloadFromConfig(this.ext.configMgr);
    this.windowProps = this._rules!.windowProps;
  }

  /**
   * Official test probe payload (B1-3). Used by AnvilExtension.getTestState().
   * Does not expose private fields to callers.
   */
  getTestStateJson(): string {
    const portableComparison =
      this._tilingEngineMode === "core" && this._tilingShadow
        ? this._tilingShadow.compareObservedGeometry()
        : this._tilingShadowComparison;
    return JSON.stringify({
      treeExists: !!this._tree!,
      tilingEngineMode: this._tilingEngineMode,
      tilingEnabled: this.ext.settings.get_boolean("tiling-mode-enabled"),
      stackedEnabled: this.ext.settings.get_boolean("stacked-tiling-mode-enabled"),
      tabbedEnabled: this.ext.settings.get_boolean("tabbed-tiling-mode-enabled"),
      tree: this._tree ? this._tree!.serializeForTest() : null,
      portableTiling: this._tilingShadow?.inspect() ?? null,
      portablePresentation: this._tilingShadow?.presentationPlan() ?? null,
      coreContainerPresentations: this._containerPresenter?.inspect() ?? [],
      corePreviews: this._previewPresenter?.inspect() ?? [],
      portableTilingShadow: portableComparison,
      portableTilingShadowFailure: this._tilingShadowFailure,
    });
  }

  forceRender(reason: string): void {
    this.renderTree(reason, true);
  }

  getStateJson(): string {
    return this.getTestStateJson();
  }

  getPortableWindowStateJson(metaWindow: Meta.Window): string {
    return JSON.stringify(this._tilingShadow?.inspectWindow(metaWindow) ?? null);
  }

  getMonitorConnector(index: number): string | null {
    return this._tilingRender!.getMonitorConnector(index);
  }

  clearResizeHistory(): void {
    this._grab!.clearResizedWindows();
  }

  clearRuntimeFloatOverridesForClass(wmClass: string): void {
    const props = this._rules!.windowProps;
    const filtered = props.overrides.filter(
      (override) =>
        !(override.wmClass === wmClass && !override.wmTitle && override.mode === "float")
    );
    if (filtered.length === props.overrides.length) return;
    props.overrides = filtered;
    this.ext.configMgr.windowProps = props;
    this._rules!.windowProps = props;
    this._rules!.invalidateClassificationCache();
    this.windowProps = props;
    this._withTilingShadow("float-override-cleanup", (shadow) => shadow.observePolicy());
  }

  private floatAllWindows() {
    this._wsMutations!.floatAllWindows();
  }

  private unfloatAllWindows() {
    this._wsMutations!.unfloatAllWindows();
  }
}
