/*
 * SettingsBridge — GSettings "changed" → typed host effects.
 *
 * Owns the settings key → handler map previously inlined in AnvilRuntime.
 * Meta/overview signals remain owned by SignalManager.
 *
 * Prefs → shell contract (C3-1):
 *   Prefs and the shell process share GSettings (and windows.json via
 *   ConfigManager). Shell must not race silent file reloads; it reacts only to
 *   GSettings keys, notably:
 *     - window-overrides-reload-trigger — prefs bumps this after writing
 *       windows.json; shell reloads float/tile overrides
 *     - css-updated — theme CSS changed; shell reloads stylesheet
 *   All other keys in SETTING_HANDLERS are the live prefs→shell event bus.
 *
 * @see codebase-review.md F5 Stage 8, C3-1
 */

import type Gio from "gi://Gio";

import { LAYOUT_TYPES, type Tree } from "./tree.js";

export interface SettingsBridgeHost {
  readonly settings: Gio.Settings;
  readonly tree: Tree;

  reloadWindowOverrides(): void;
  updateBorderLayout(): void;
  pointerPolicyNeeded(): boolean;
  ensurePointerPolicy(): void;
  teardownPointerPolicy(): void;
  setHoverFocusEnabled(enabled: boolean): void;
  renderTree(from: string, force?: boolean): void;
  determineSplitLayout(): string;
  reloadStylesheet(): void;
  cleanupAlwaysFloat(): void;
  restoreAlwaysFloat(): void;
  clearResizedWindows(): void;
  observePortablePolicy(): void;
}

type SettingHandler = (host: SettingsBridgeHost, key: string) => void;

const PORTABLE_POLICY_KEYS = new Set([
  "window-overrides-reload-trigger",
  "tiling-mode-enabled",
  "window-gap-size-increment",
  "window-gap-size",
  "window-gap-hidden-on-single",
  "workspace-skip-tile",
  "stacked-tiling-mode-enabled",
  "tabbed-tiling-mode-enabled",
  "auto-split-enabled",
  "auto-exit-tabbed",
  "showtab-decoration-enabled",
  "monitor-constraints",
]);

function handleBorderToggles(host: SettingsBridgeHost, _key: string): void {
  // A toggle changes desired decoration state; it does not end any tracked
  // window's lifecycle. Reconcile in place so re-enabling can restore actors.
  host.updateBorderLayout();
}

function handlePointerPolicy(host: SettingsBridgeHost, key: string): void {
  if (host.pointerPolicyNeeded()) {
    host.ensurePointerPolicy();
    if (key === "focus-on-hover-enabled") {
      host.setHoverFocusEnabled(host.settings.get_boolean(key));
    }
  } else {
    host.teardownPointerPolicy();
  }
}

function handleStackedTilingMode(host: SettingsBridgeHost, key: string): void {
  const settings = host.settings;
  if (!settings.get_boolean(key)) {
    const stackedNodes = host.tree.getNodeByLayout(LAYOUT_TYPES.STACKED);
    stackedNodes.forEach((node) => {
      node.prevLayout = node.layout;
      node.layout = host.determineSplitLayout();
    });
  } else {
    const hSplitNodes = host.tree.getNodeByLayout(LAYOUT_TYPES.HSPLIT);
    const vSplitNodes = host.tree.getNodeByLayout(LAYOUT_TYPES.VSPLIT);
    Array.prototype.push.apply(hSplitNodes, vSplitNodes);
    hSplitNodes.forEach((node) => {
      if (node.prevLayout && node.prevLayout === LAYOUT_TYPES.STACKED) {
        node.layout = LAYOUT_TYPES.STACKED;
      }
    });
  }
  host.renderTree(key);
}

function handleTabbedTilingMode(host: SettingsBridgeHost, key: string): void {
  const settings = host.settings;
  if (!settings.get_boolean(key)) {
    const tabbedNodes = host.tree.getNodeByLayout(LAYOUT_TYPES.TABBED);
    tabbedNodes.forEach((node) => {
      node.prevLayout = node.layout;
      node.layout = host.determineSplitLayout();
    });
  } else {
    const hSplitNodes = host.tree.getNodeByLayout(LAYOUT_TYPES.HSPLIT);
    const vSplitNodes = host.tree.getNodeByLayout(LAYOUT_TYPES.VSPLIT);
    Array.prototype.push.apply(hSplitNodes, vSplitNodes);
    hSplitNodes.forEach((node) => {
      if (node.prevLayout && node.prevLayout === LAYOUT_TYPES.TABBED) {
        node.layout = LAYOUT_TYPES.TABBED;
      }
    });
  }
  host.renderTree(key);
}

/** GSettings key → effect (behavior-preserving from AnvilRuntime switch). */
const SETTINGS_HANDLERS: Record<string, SettingHandler> = {
  "window-overrides-reload-trigger": (h) => h.reloadWindowOverrides(),
  "focus-border-toggle": handleBorderToggles,
  "split-border-toggle": handleBorderToggles,
  "focus-border-hidden-on-single": handleBorderToggles,
  "focus-on-hover-enabled": handlePointerPolicy,
  "move-pointer-focus-enabled": handlePointerPolicy,
  "tiling-mode-enabled": (h, k) => h.renderTree(k),
  "window-gap-size-increment": (h, k) => h.renderTree(k, true),
  "window-gap-size": (h, k) => h.renderTree(k, true),
  "window-gap-hidden-on-single": (h, k) => h.renderTree(k, true),
  "workspace-skip-tile": (h, k) => h.renderTree(k, true),
  "stacked-tiling-mode-enabled": handleStackedTilingMode,
  "tabbed-tiling-mode-enabled": handleTabbedTilingMode,
  "css-updated": (h) => {
    h.reloadStylesheet();
    h.updateBorderLayout();
  },
  "float-always-on-top-enabled": (h, k) => {
    if (!h.settings.get_boolean(k)) {
      h.cleanupAlwaysFloat();
    } else {
      h.restoreAlwaysFloat();
    }
  },
  "monitor-constraints": (h, k) => {
    h.clearResizedWindows();
    h.renderTree(k, true);
  },
};

export class SettingsBridge {
  private _host: SettingsBridgeHost;
  private _id = 0;

  constructor(host: SettingsBridgeHost) {
    this._host = host;
  }

  enable(): void {
    if (this._id) return;
    this._id = this._host.settings.connect("changed", (_, settingName: string) => {
      this._onChanged(settingName);
    });
  }

  disable(): void {
    if (!this._id) return;
    this._host.settings.disconnect(this._id);
    this._id = 0;
  }

  /** Exposed for unit tests. */
  handleChanged(settingName: string): void {
    this._onChanged(settingName);
  }

  private _onChanged(settingName: string): void {
    const handler = SETTINGS_HANDLERS[settingName];
    if (settingName === "window-overrides-reload-trigger") {
      handler?.(this._host, settingName);
      this._host.observePortablePolicy();
      return;
    }
    if (PORTABLE_POLICY_KEYS.has(settingName)) this._host.observePortablePolicy();
    handler?.(this._host, settingName);
  }
}
