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

// Gnome imports
import GLib from "gi://GLib";

import GObject from "gi://GObject";
import Meta from "gi://Meta";

// Gnome Shell imports
import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";
import { PACKAGE_VERSION } from "resource:///org/gnome/shell/misc/config.js";

// Shared state
import { Logger } from "../shared/logger.js";
import type { WindowConfig } from "../shared/settings.js";

// App imports
import * as Utils from "./utils.js";
import { Keybindings } from "./keybindings.js";
import { Tree, Queue, Node, NODE_TYPES, RectLike } from "./tree.js";
import { production } from "../shared/settings.js";
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

import { WINDOW_MODES } from "./window/constants.js";
import { DragDropTile } from "./drag-drop-tile.js";
import { SignalManager } from "./signal-manager.js";
import { RenderScheduler } from "./render-scheduler.js";
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

export { WINDOW_MODES, GRAB_TYPES } from "./window/constants.js";
export type { AnvilMetaWindow, AnvilWindowActor, AnvilMetaWorkspace } from "./window/types.js";
export type { AnvilAction, AnvilActionName } from "./window/actions.js";
export { RulesEngine, windowTitleMatchesOverride } from "./rules-engine.js";
export type { RuleMatch, RuleSource } from "./rules-engine.js";

export class WindowManager extends GObject.Object {
  static {
    GObject.registerClass(this);
  }

  ext: AnvilExtension;
  /** Synced with RulesEngine / ConfigManager (same object after reload). */
  windowProps!: WindowConfig;
  private _rules!: RulesEngine;

  // --- State ---
  declare prefsTitle: string;
  declare disabled: boolean;
  /** Grouped transient flags (B2-3). Prefer this._session over new loose fields. */
  private _session!: SessionFlagsState;
  private _dragDrop!: DragDropTile;
  private _signalManager!: SignalManager;
  private _commandHandlerHost!: CommandHandlerHost;
  private _wsMutationsHost!: WorkspaceMutationsHost;
  private _wsMutations!: WorkspaceMutations;
  private _renderScheduler!: RenderScheduler;
  private _decorationLayout!: DecorationLayout;

  // Compatibility accessors for session flags (tests / residual call sites).
  get _freezeRender() {
    return this._session.freezeRender;
  }
  set _freezeRender(v: boolean) {
    this._session.freezeRender = v;
  }
  get _workspaceChanging() {
    return this._session.workspaceChanging;
  }
  set _workspaceChanging(v: boolean) {
    this._session.workspaceChanging = v;
  }

  // --- Object references ---
  declare _kbd: import("./keybindings.js").Keybindings;
  declare _tree: Tree;
  declare eventQueue: Queue;
  declare theme: import("./extension-theme-manager.js").ExtensionThemeManager;
  declare _pointerPolicy: PointerPolicy | null;
  declare _tilingRender: TilingRender;
  declare _tracker: WindowTracker;
  declare _layout: LayoutEngine;
  declare _grab: GrabResizeSession;
  declare _settingsBridge: SettingsBridge;
  declare _focus: FocusController;
  declare _borders: BorderController;
  declare nodeWinAtPointer: Node<any> | null;
  declare sortedWindows: Meta.Window[];

  // --- GLib source IDs ---
  declare _queueSourceId: number;

  /** CommandBus — typed AnvilAction dispatch (B3-1 / B10-2). */
  private _commandBus!: CommandBus;

  constructor(ext: AnvilExtension) {
    super();
    this.ext = ext;
    this.prefsTitle = `Anvil ${_("Settings")} - ${
      !production ? "DEV" : `${PACKAGE_VERSION}-${ext.metadata.version}`
    }`;
    this._rules = new RulesEngine();
    this.reloadWindowOverrides();
    this.disabled = false;
    this._session = createSessionFlags();
    // Keybindings wired after construction via wireKeybindings() (B4-9).
    // Host getters use `self` so lazy tree access works during/after construction.
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    // LayoutEngine before Tree: Tree._initWorkspaces calls determineSplitLayout().
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
      sameParentMonitor: (a, b) => self.sameParentMonitor(a, b),
      floatingWindow: (n) => self.floatingWindow(n),
    });
    // SignalManager before Tree: Tree._initWorkspaces() calls bindWorkspaceSignals
    // during construction, so it must exist first and own the impl (C11). Host
    // getters are lazy — _tracker/_grab/_settingsBridge need not exist yet.
    this._signalManager = new SignalManager({
      get tracker() {
        return self._tracker;
      },
      get tree() {
        return self.tree;
      },
      get layout() {
        return self._layout;
      },
      get settingsBridge() {
        return self._settingsBridge;
      },
      renderTree: (from, force) => self.renderTree(from, force),
      trackCurrentMonWs: () => self.trackCurrentMonWs(),
      updateMetaWorkspaceMonitor: (from, mon, w) => self.updateMetaWorkspaceMonitor(from, mon, w),
      updateDecorationLayout: () => self.updateDecorationLayout(),
      hideWindowBorders: () => self.hideWindowBorders(),
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
      queueEvent: (ev, interval) => self.queueEvent(ev, interval),
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
    });
    this.eventQueue = new Queue();
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
      getResizeCount: (id) => self._grab.getResizeCount(id),
      findParent: (node, type) => this.tree.findParent(node, type),
      computeSizes: (n, c) => self._layout.computeSizes(n, c),
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
      get eventQueueLength() {
        return self.eventQueue.length;
      },
      findNodeWindow: (w) => self.findNodeWindow(w),
      findNodeWindowAtPointer: (n) => self._dragDrop.findNodeWindowAtPointer(n) ?? null,
      trackCurrentMonWs: () => self.trackCurrentMonWs(),
      freezeRender: () => self.freezeRender(),
      unfreezeRender: () => self.unfreezeRender(),
      renderTree: (from, force) => self.renderTree(from, force),
      queueEvent: (ev, interval) => self.queueEvent(ev, interval),
      move: (w, rect) => self.move(w, rect),
      calculateGaps: (n) => self._tilingRender.calculateGaps(n),
      processNode: (n) => self._tilingRender.processNode(n),
      getMonitorConstraints: (i) => self._tilingRender.getMonitorConstraints(i),
      floatingWindow: (n) => !!self.floatingWindow(n),
      minimizedWindow: (n) => !!self.minimizedWindow(n),
      allowDragDropTile: () => Boolean(self.allowDragDropTile()),
      moveWindowToPointer: (n, preview) => self._dragDrop.moveWindowToPointer(n, preview),
      updateStackedFocus: (n) => self.updateStackedFocus(n),
      updateTabbedFocus: (n) => self.updateTabbedFocus(n),
    });
    this._tracker = new WindowTracker({
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
      reloadTree: (from) => self.reloadTree(from),
      updateMetaWorkspaceMonitor: (from, mon, w) => self.updateMetaWorkspaceMonitor(from, mon, w),
      updateMetaPositionSize: (w, from) => self.updateMetaPositionSize(w, from),
      renderTree: (from, force) => self.renderTree(from, force),
      queueEvent: (ev, interval) => self.queueEvent(ev, interval),
      unfreezeRender: () => self.unfreezeRender(),
      ensureBorderActors: (a) => self.ensureBorderActors(a),
      hideActorBorder: (a) => self.hideActorBorder(a),
      updateBorderLayout: () => self.updateBorderLayout(),
      updateDecorationLayout: () => self.updateDecorationLayout(),
      updateStackedFocus: (n) => self.updateStackedFocus(n),
      updateTabbedFocus: (n) => self.updateTabbedFocus(n),
      notifyFocusChanged: (n, s) => self.notifyFocusChanged(n, s),
      moveCenter: (w) => self.moveCenter(w),
      removeFloatOverride: (w, withWmId) => self.removeFloatOverride(w, withWmId),
      trackCurrentMonWs: () => self.trackCurrentMonWs(),
      autoSplitFromFocus: () => self.layoutEngine.autoSplitFromFocus(),
    });
    this._settingsBridge = new SettingsBridge({
      get settings() {
        return self.ext.settings;
      },
      get tree() {
        return self.tree;
      },
      reloadWindowOverrides: () => self.reloadWindowOverrides(),
      bordersEnabled: () => self._bordersEnabled(),
      ensureAllBorderActors: () => self.ensureAllBorderActors(),
      updateBorderLayout: () => self.updateBorderLayout(),
      destroyAllBorderActors: () => self.destroyAllBorderActors(),
      pointerPolicyNeeded: () => self._pointerPolicyNeeded(),
      ensurePointerPolicy: () => self._ensurePointerPolicy(),
      teardownPointerPolicy: () => self._teardownPointerPolicy(),
      setHoverFocusEnabled: (enabled) => {
        self._pointerPolicy?.setHoverFocusEnabled(enabled);
      },
      renderTree: (from, force) => self.renderTree(from, force),
      determineSplitLayout: () => self.determineSplitLayout(),
      reloadStylesheet: () => {
        self.theme?.reloadStylesheet();
      },
      cleanupAlwaysFloat: () => self.cleanupAlwaysFloat(),
      restoreAlwaysFloat: () => self.restoreAlwaysFloat(),
      clearResizedWindows: () => self._grab.clearResizedWindows(),
    });
    this._focus = new FocusController({
      get layoutEngine() {
        return self._layout;
      },
      isRenderFrozen: () => self._freezeRender,
      queueEvent: (ev, interval) => self.queueEvent(ev, interval),
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
      calculateGaps: (n) => self._tilingRender.calculateGaps(n),
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
        return self._layout;
      },
      get nodeWinAtPointer() {
        return self.nodeWinAtPointer;
      },
      get cancelGrab() {
        return self._grab.cancelGrab;
      },
      get sortedWindows() {
        return self.sortedWindows;
      },
      renderTree: (from, force) => self.renderTree(from, force),
      processGap: (n) => self._tilingRender.processGap(n),
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
        return self2._layout;
      },
      get focusMetaWindow() {
        return self2.focusMetaWindow;
      },
      get grabOp() {
        return self2._grab.grabOp;
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
      validWindow: (w) => self2._tracker.validWindow(w),
      handleResizing: (n) => self2._grab.handleResizing(n),
      handleMoving: (n) => self2._grab.handleMoving(n),
    };
    this._wsMutations = new WorkspaceMutations(this._wsMutationsHost);
    this._renderScheduler = new RenderScheduler({
      isRenderFrozen: () => self2._freezeRender,
      freezeRender: () => self2.freezeRender(),
      unfreezeRender: () => self2.unfreezeRender(),
      updateDecorationLayout: () => self2.updateDecorationLayout(),
      updateBorderLayout: () => self2.updateBorderLayout(),
      tilingRenderRender: (from) => self2._tilingRender.render(from),
      trackCurrentWindows: () => self2._tracker.trackCurrentWindows(),
      treeReinitializeWorkspaces: () => self2.tree._initWorkspaces(),
      treeResetRoot: () => {
        self2.tree.childNodes.length = 0;
        self2.tree.attachNode = null;
      },
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
    });

    Logger.info("anvil initialized");
  }

  get pointerPolicy() {
    return this._pointerPolicy;
  }

  get tilingRender() {
    return this._tilingRender;
  }

  get layoutEngine() {
    return this._layout;
  }

  get shouldFocusOnHover() {
    return this._pointerPolicy?.hoverFocusEnabled ?? false;
  }

  set shouldFocusOnHover(enabled: boolean) {
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

  notifyFocusChanged(node: Node<any> | null, source: PointerFocusSource) {
    if (this._pointerPolicy) {
      this._pointerPolicy.onFocusChanged({ node, source });
    }
    if (node) this.tree.debugParentNodes(node);
  }

  notifyWorkspaceSettled() {
    this._pointerPolicy?.onWorkspaceSettled();
  }

  addFloatOverride(metaWindow: Meta.Window, withWmId: boolean) {
    this._rules.addFloatOverride(metaWindow, withWmId, this.ext.configMgr);
    this.windowProps = this._rules.windowProps;
  }

  removeFloatOverride(metaWindow: Meta.Window, withWmId: boolean) {
    this._rules.removeFloatOverride(metaWindow, withWmId, this.ext.configMgr);
    this.windowProps = this._rules.windowProps;
  }

  /** @deprecated Use commandToggleFloatingMode() from command-handlers.js. Kept for test surface. */
  toggleFloatingMode(action: FloatAction, metaWindow: Meta.Window) {
    commandToggleFloatingMode(this._commandHandlerHost, action, metaWindow);
  }

  queueEvent(eventObj: { name: string; callback: () => void }, interval: number = 220) {
    this.eventQueue.enqueue(eventObj);

    if (!this._queueSourceId) {
      this._queueSourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, interval, () => {
        const currEventObj = this.eventQueue.dequeue();
        if (currEventObj) {
          currEventObj.callback();
        }
        const result = this.eventQueue.length !== 0;
        if (!result) {
          this._queueSourceId = 0;
        }
        return result;
      });
    }
  }

  cleanupAlwaysFloat() {
    // remove the setting for each node window
    this.allNodeWindows.forEach((w) => {
      if (w.mode === WINDOW_MODES.FLOAT) {
        const mw = w.nodeValue as Meta.Window;
        if (mw.is_above()) mw.unmake_above();
      }
    });
  }

  restoreAlwaysFloat() {
    this.allNodeWindows.forEach((w) => {
      if (w.mode === WINDOW_MODES.FLOAT) {
        const mw = w.nodeValue as Meta.Window;
        if (!mw.is_above()) mw.make_above();
      }
    });
  }

  trackCurrentMonWs() {
    this._wsMutations.trackCurrentMonWs();
  }

  // Delegates to SignalManager (C11): it owns signal connect/disconnect. Kept as
  // a facade so Tree (TreeHost) and tests can call WM.bindWorkspaceSignals().
  bindWorkspaceSignals(metaWorkspace: Meta.Workspace) {
    this._signalManager.bindWorkspaceSignals(metaWorkspace);
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
        return self._layout;
      },
      get focusController() {
        return self._focus;
      },
      get tilingRender() {
        return self._tilingRender;
      },
      get rulesEngine() {
        return self._rules;
      },
      get eventQueueLength() {
        return self.eventQueue.length;
      },
      get prefsTitle() {
        return self.prefsTitle;
      },
      findNodeWindow: (w) => self.findNodeWindow(w),
      move: (w, rect) => self.move(w, rect),
      moveCenter: (w) => self.moveCenter(w),
      renderTree: (from, force) => self.renderTree(from, force),
      queueEvent: (ev, interval) => self.queueEvent(ev, interval),
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
        self._grab.cancelGrab = v;
      },
      unfreezeRender: () => self.unfreezeRender(),
    };
    this._commandBus = new CommandBus(createCommandHandlers(this._commandHandlerHost));
  }

  /** Dispatch a typed user action via CommandBus (B3-1). */
  command(action: AnvilAction) {
    this._commandBus.dispatch(action);
  }

  /** Injectable command bus for tests / keybinding service (B10-2). */
  get commandBus(): CommandBus {
    return this._commandBus;
  }

  /** @deprecated Use commandResize() from command-handlers.js. Kept for test surface. */
  resize(grabOp: Meta.GrabOp, amount: number) {
    commandResize(this._commandHandlerHost, grabOp, amount);
  }

  _stopLiveResizeLoop() {
    this._grab.dispose();
  }

  disable() {
    Utils._disableDecorations();
    this._signalManager.unbindAll();
    this._borders.destroyAllBorderActors();
    this._tracker.dispose();
    this._grab.dispose();
    this._settingsBridge.disable();
    this._renderScheduler.dispose();
    this._disposePointerPolicy();
    this._removeQueueSource();
    this.disabled = true;
    Logger.debug(`extension:disable`);
  }

  enable() {
    // Pair with disable(): re-enable after a prior disable (B4-8).
    this.disabled = false;
    // Reset the workspace-transition flag in case disable fired during a
    // transition (SignalManager.unbindAll cancels the clearing timeout).
    this._workspaceChanging = false;
    this._signalManager.bindAll();
    this.reloadTree("enable");
    Logger.debug(`extension:enable`);
  }

  /**
   * Wire keybindings after both WM and Keybindings are constructed.
   * Call from AnvilExtension.enable — never create Keybindings in a getter.
   * @see codebase-review.md B2-2, B4-9
   */
  wireKeybindings(kbd: Keybindings) {
    this._kbd = kbd;
  }

  findNodeWindow(metaWindow: Meta.Window) {
    return this.tree.findNode(metaWindow);
  }

  get focusMetaWindow() {
    return global.display.get_focus_window();
  }

  get tree() {
    if (!this._tree) {
      // Lazy recreate with TreeHost (Stage 7 — no concrete WM dependency on Tree)
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      const self = this;
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
      });
    }
    return this._tree;
  }

  get kbd() {
    // No lazy construction (B4-9). Must be wired via wireKeybindings() after
    // AnvilExtension constructs Keybindings.
    if (!this._kbd) {
      throw new Error("WindowManager.kbd used before wireKeybindings()");
    }
    return this._kbd;
  }

  get windowsAllWorkspaces() {
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

  getWindowsOnWorkspace(workspaceIndex: number) {
    return this._wsMutations.getWindowsOnWorkspace(workspaceIndex);
  }

  determineSplitLayout() {
    return this._layout.determineSplitLayout();
  }

  floatWorkspace(workspaceIndex: number) {
    this._wsMutations.floatWorkspace(workspaceIndex);
  }

  unfloatWorkspace(workspaceIndex: number) {
    this._wsMutations.unfloatWorkspace(workspaceIndex);
  }

  _bordersEnabled() {
    const settings = this.ext.settings;
    return (
      settings.get_boolean("focus-border-toggle") || settings.get_boolean("split-border-toggle")
    );
  }

  ensureBorderActors(windowActor: AnvilWindowActor | null) {
    this._borders.ensureBorderActors(windowActor);
  }

  ensureAllBorderActors() {
    this._borders.ensureAllBorderActors();
  }

  destroyAllBorderActors() {
    this._borders.destroyAllBorderActors();
  }

  hideActorBorder(actor: AnvilWindowActor | null) {
    this._borders.hideActorBorder(actor);
  }

  hideWindowBorders() {
    this._borders.hideWindowBorders();
  }

  // Window movement API
  move(metaWindow: Meta.Window, rect: { x: number; y: number; width: number; height: number }) {
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

  moveCenter(metaWindow: Meta.Window) {
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

  rectForMonitor(node: Node<any>, targetMonitor: number) {
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

  /** Remove the shared event queue GLib source (C8 — stays on WM as shared facade). */
  private _removeQueueSource(): void {
    if (this._queueSourceId) {
      GLib.Source.remove(this._queueSourceId);
      this._queueSourceId = 0;
    }
  }

  renderTree(from: string, force: boolean = false) {
    this._renderScheduler.renderTree(from, force);
  }

  get allNodeWindows() {
    return this.tree.getNodeByType(NODE_TYPES.WINDOW);
  }

  /**
   * Reloads the tree. This is an expensive operation.
   * Useful when using dynamic workspaces in GNOME-shell.
   *
   * TODO: add support to reload the tree from a JSON dump file.
   * TODO: move this to tree.js
   */
  reloadTree(from: string) {
    this._renderScheduler.reloadTree(from);
  }

  sameParentMonitor(firstNode: Node<any>, secondNode: Node<any>) {
    if (!firstNode || !secondNode) return false;
    if (!firstNode.nodeValue || !secondNode.nodeValue) return false;
    const firstWin = firstNode.nodeValue as Meta.Window;
    const secondWin = secondNode.nodeValue as Meta.Window;
    if (!firstWin.get_workspace()) return false;
    if (!secondWin.get_workspace()) return false;
    const firstMonWs = `mo${firstWin.get_monitor()}ws${firstWin.get_workspace().index()}`;
    const secondMonWs = `mo${secondWin.get_monitor()}ws${secondWin.get_workspace().index()}`;
    return firstMonWs === secondMonWs;
  }

  updateBorderLayout() {
    this._borders.updateBorderLayout();
  }

  updateStackedFocus(focusNodeWindow: Node<any> | undefined | null) {
    this._focus.updateStackedFocus(focusNodeWindow);
  }

  updateTabbedFocus(focusNodeWindow: Node<any> | null | undefined) {
    this._focus.updateTabbedFocus(focusNodeWindow);
  }

  /**
   * Check if a Meta Window's workspace is skipped for tiling.
   */
  isActiveWindowWorkspaceTiled(metaWindow: Meta.Window) {
    return this._wsMutations.isActiveWindowWorkspaceTiled(metaWindow);
  }

  /**
   * Check the current active workspace's tiling mode
   */
  isCurrentWorkspaceTiled() {
    return this._wsMutations.isCurrentWorkspaceTiled();
  }

  updateMetaWorkspaceMonitor(from: string, _monitor: number | null, metaWindow: Meta.Window) {
    this._wsMutations.updateMetaWorkspaceMonitor(from, _monitor, metaWindow);
  }

  /**
   * Handle any updates to the current focused window's position.
   * Useful for updating the active window border, etc.
   */
  updateMetaPositionSize(_metaWindow: Meta.Window, from: string) {
    this._wsMutations.updateMetaPositionSize(_metaWindow, from);
  }

  updateDecorationLayout() {
    this._decorationLayout.updateDecorationLayout();
  }

  freezeRender() {
    this._freezeRender = true;
  }

  unfreezeRender() {
    this._freezeRender = false;
  }

  floatingWindow(node: Node<any> | null) {
    if (!node) return false;
    return node.nodeType === NODE_TYPES.WINDOW && node.mode === WINDOW_MODES.FLOAT;
  }

  minimizedWindow(node: Node<any> | null) {
    if (!node) return false;
    return node._type === NODE_TYPES.WINDOW && node._data && (node._data as Meta.Window).minimized;
  }

  /**
   * Handle previewing and applying where a drag-drop window is going to be tiled.
   * @deprecated Use this._dragDrop.moveWindowToPointer() directly.
   */
  moveWindowToPointer(focusNodeWindow: Node<any>, preview: boolean = false) {
    this._dragDrop.moveWindowToPointer(focusNodeWindow, preview);
  }

  /**
   * @deprecated Use this._dragDrop.findNodeWindowAtPointer() directly.
   */
  findNodeWindowAtPointer(focusNodeWindow: Node<any>) {
    return this._dragDrop.findNodeWindowAtPointer(focusNodeWindow);
  }

  _handleGrabOpBegin(display: Meta.Display, metaWindow: Meta.Window, grabOp: Meta.GrabOp) {
    this._grab.begin(display, metaWindow, grabOp);
  }

  _handleGrabOpEnd(display: Meta.Display, metaWindow: Meta.Window, grabOp: Meta.GrabOp) {
    this._grab.end(display, metaWindow, grabOp);
  }

  _grabCleanup(focusNodeWindow: Node<any> | null) {
    this._grab.cleanup(focusNodeWindow);
  }

  allowDragDropTile() {
    return this.kbd.allowDragDropTile();
  }

  /** Float/tile classification — delegated to RulesEngine (sole owner). */
  isFloatingExempt(metaWindow: Meta.Window | null) {
    // Keep rules cache aligned with WM windowProps (tests may mutate either).
    this._rules.windowProps = this.windowProps;
    return this._rules.isFloatingExempt(metaWindow);
  }

  get currentMonWsNode() {
    const monWs = this.currentMonWs;
    if (monWs) {
      return this.tree.findNode(monWs);
    }
    return null;
  }

  get currentWsNode() {
    const ws = this.currentWs;
    if (ws) {
      return this.tree.findNode(ws);
    }
    return null;
  }

  get currentMonWs() {
    const monWs = `${this.currentMon}${this.currentWs}`;
    return monWs;
  }

  get currentWs() {
    const display = global.display;
    const wsMgr = display.get_workspace_manager();
    return `ws${wsMgr.get_active_workspace_index()}`;
  }

  get currentMon() {
    const display = global.display;
    return `mo${display.get_current_monitor()}`;
  }

  /**
   * Reload window overrides from the configuration file
   * This is called when the preferences page modifies the overrides
   */
  reloadWindowOverrides() {
    this._rules.reloadFromConfig(this.ext.configMgr);
    this.windowProps = this._rules.windowProps;
  }

  /**
   * Official test probe payload (B1-3). Used by AnvilExtension.getTestState().
   * Does not expose private fields to callers.
   */
  getTestStateJson(): string {
    return JSON.stringify({
      treeExists: !!this._tree,
      tilingEnabled: this.ext.settings.get_boolean("tiling-mode-enabled"),
      stackedEnabled: this.ext.settings.get_boolean("stacked-tiling-mode-enabled"),
      tabbedEnabled: this.ext.settings.get_boolean("tabbed-tiling-mode-enabled"),
      tree: this._tree ? this._tree.serializeForTest() : null,
    });
  }

  floatAllWindows() {
    this._wsMutations.floatAllWindows();
  }

  unfloatAllWindows() {
    this._wsMutations.unfloatAllWindows();
  }
}
