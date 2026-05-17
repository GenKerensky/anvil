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
 * Anvil is a fork of Forge by Jose Maranan.
 */

import Gio from "gi://Gio";
import GLib from "gi://GLib";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { Extension, gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";

import { Logger } from "./lib/shared/logger.js";
import { ConfigManager } from "./lib/shared/settings.js";

import { Keybindings } from "./lib/extension/keybindings.js";
import { WindowManager } from "./lib/extension/window.js";
import { FeatureIndicator, FeatureMenuToggle } from "./lib/extension/indicator.js";
import { ExtensionThemeManager } from "./lib/extension/extension-theme-manager.js";

// Credit: jcrussell/forge — descriptors for GNOME settings overridden while enabled.
// Each entry saves the original value during enable() and restores it during disable().
interface SavedSetting {
  gsettings: Gio.Settings;
  key: string;
  original: boolean | string[];
  setter: "set_boolean" | "set_strv";
}

const SETTINGS_OVERRIDES: {
  schemaId: string;
  key: string;
  type: "boolean" | "strv";
  newValue: boolean | string[];
}[] = [
  { schemaId: "org.gnome.mutter", key: "edge-tiling", type: "boolean", newValue: false },
  { schemaId: "org.gnome.mutter", key: "auto-maximize", type: "boolean", newValue: false },
  {
    schemaId: "org.gnome.mutter.keybindings",
    key: "toggle-tiled-left",
    type: "strv",
    newValue: [],
  },
  {
    schemaId: "org.gnome.mutter.keybindings",
    key: "toggle-tiled-right",
    type: "strv",
    newValue: [],
  },
  { schemaId: "org.gnome.desktop.wm.keybindings", key: "maximize", type: "strv", newValue: [] },
  { schemaId: "org.gnome.desktop.wm.keybindings", key: "unmaximize", type: "strv", newValue: [] },
  { schemaId: "org.gnome.desktop.wm.keybindings", key: "minimize", type: "strv", newValue: [] },
  {
    schemaId: "org.gnome.shell.keybindings",
    key: "toggle-message-tray",
    type: "strv",
    newValue: [],
  },
];

export default class AnvilExtension extends Extension {
  settings!: Gio.Settings;
  kbdSettings!: Gio.Settings;
  configMgr!: ConfigManager;
  theme!: ExtensionThemeManager;
  extWm!: WindowManager;
  keybindings!: Keybindings;
  indicator: FeatureIndicator | null = null;
  private _sessionId: number | null = null;
  private _savedSettings: SavedSetting[] | null = null;
  private _gnomeSettings: Map<string, Gio.Settings> | null = null;

  enable() {
    this.settings = this.getSettings();
    this.kbdSettings = this.getSettings("org.gnome.shell.extensions.anvil.keybindings");
    Logger.init(this.settings);
    Logger.info("enable");

    if (this.settings.get_boolean("test-mode")) {
      const g = global as unknown as {
        context: { unsafe_mode: boolean };
        __anvil_test_state: unknown;
      };
      g.context.unsafe_mode = true;
      g.__anvil_test_state = this;
    }

    // Credit: jcrussell/forge — disable GNOME features and keybindings that
    // conflict with tree-based tiling (edge-tiling #461, auto-maximize #288)
    this._savedSettings = [];
    this._gnomeSettings = new Map();
    try {
      for (const desc of SETTINGS_OVERRIDES) {
        if (!this._gnomeSettings.has(desc.schemaId)) {
          this._gnomeSettings.set(desc.schemaId, new Gio.Settings({ schema_id: desc.schemaId }));
        }
        const gsettings = this._gnomeSettings.get(desc.schemaId)!;
        const getter = desc.type === "boolean" ? "get_boolean" : "get_strv";
        const setter = desc.type === "boolean" ? "set_boolean" : "set_strv";
        const original = gsettings[getter](desc.key);
        gsettings[setter](desc.key, desc.newValue as never);
        this._savedSettings.push({
          gsettings,
          key: desc.key,
          original: original as never,
          setter: setter as never,
        });
      }
      Logger.info("Disabled conflicting GNOME settings and keybindings");
    } catch (e) {
      Logger.warn(`Failed to disable GNOME conflicting features: ${e}`);
    }

    this.configMgr = new ConfigManager(this as { dir: Gio.File });
    this.theme = new ExtensionThemeManager(this);
    this.extWm = new WindowManager(this);
    this.keybindings = new Keybindings(this);

    this._onSessionModeChanged(Main.sessionMode);
    this._sessionId = Main.sessionMode.connect("updated", this._onSessionModeChanged.bind(this));

    this.theme.patchCss();
    this.theme.reloadStylesheet();
    this.extWm.enable();
    Logger.info("enable: finalized vars");
  }

  disable() {
    Logger.info("disable");
    // session-modes: ["user", "unlock-dialog"] — the extension persists
    // through screen lock to preserve tree/window state during the unlock
    // transition. Keybindings are disconnected in _onSessionModeChanged
    // when entering unlock-dialog mode, and reconnected when returning to user mode.

    const g = global as unknown as { __anvil_test_state: unknown };
    if (g.__anvil_test_state === this) {
      g.__anvil_test_state = null;
    }

    if (this._sessionId) {
      Main.sessionMode.disconnect(this._sessionId);
      this._sessionId = null;
    }

    if (this._savedSettings) {
      try {
        for (const saved of this._savedSettings) {
          saved.gsettings[saved.setter](saved.key, saved.original as never);
        }
        Logger.info("Restored GNOME settings and keybindings");
      } catch (e) {
        Logger.warn(`Failed to restore GNOME settings: ${e}`);
      }
      this._savedSettings = null;
      this._gnomeSettings = null;
    }

    this._removeIndicator();
    this.extWm?.disable();
    this.keybindings?.disable();
    this.keybindings = null as unknown as Keybindings;
    this.extWm = null as unknown as WindowManager;
    this.theme = null as unknown as ExtensionThemeManager;
    this.configMgr = null as unknown as ConfigManager;
    this.settings = null as unknown as Gio.Settings;
    this.kbdSettings = null as unknown as Gio.Settings;
  }

  _onSessionModeChanged(session: { currentMode: string; parentMode: string }) {
    if (session.currentMode === "user" || session.parentMode === "user") {
      Logger.info("user on session change");
      this._addIndicator();
      this.keybindings?.enable();
    } else if (session.currentMode === "unlock-dialog") {
      this._removeIndicator();
      this.keybindings?.disable();
    }
  }

  _addIndicator() {
    if (this.indicator) return;
    this.indicator = new FeatureIndicator(this);
    const featureToggle = new FeatureMenuToggle(this);
    this.indicator.quickSettingsItems.push(featureToggle);
    Main.panel.statusArea.quickSettings.addExternalIndicator(
      this.indicator as unknown as Parameters<
        typeof Main.panel.statusArea.quickSettings.addExternalIndicator
      >[0]
    );
  }

  _removeIndicator() {
    if (!this.indicator) return;
    this.indicator.quickSettingsItems.forEach((item) => item.destroy());
    this.indicator.quickSettingsItems.length = 0;
    (this.indicator as { destroy(): void }).destroy();
    this.indicator = null;
  }

  openPreferences() {
    const uuid = this.metadata.uuid;
    Gio.DBus.session.call(
      "org.gnome.Shell",
      "/org/gnome/Shell",
      "org.gnome.Shell.Extensions",
      "OpenExtensionPrefs",
      new GLib.Variant("(ssa{sv})", [uuid, "", {}]),
      null,
      Gio.DBusCallFlags.NONE,
      -1,
      null
    );
  }

  getTestState(): string | null {
    if (!this.settings?.get_boolean("test-mode")) return null;
    const wm = this.extWm as { _tree?: unknown } | null;
    if (!wm) return JSON.stringify({ error: "WindowManager not initialized" });

    interface SerializedNode {
      type: string;
      layout: string | null;
      mode: string | null;
      childCount: number;
      children: (SerializedNode | null)[];
      wmClass?: string | null;
    }

    const serializeNode = (node: unknown): SerializedNode | null => {
      if (!node) return null;
      const n = node as {
        _type: string;
        layout?: string;
        mode?: string;
        _nodes?: unknown[];
        nodeValue?: { wm_class?: string | null };
      };
      const data: SerializedNode = {
        type: n._type,
        layout: n.layout ?? null,
        mode: n.mode ?? null,
        childCount: n._nodes?.length ?? 0,
        children: (n._nodes ?? []).map(serializeNode),
      };
      if (n._type === "WINDOW" && n.nodeValue) {
        data.wmClass = n.nodeValue.wm_class ?? null;
      }
      return data;
    };

    return JSON.stringify({
      treeExists: !!wm._tree,
      tilingEnabled: this.settings.get_boolean("tiling-mode-enabled"),
      stackedEnabled: this.settings.get_boolean("stacked-tiling-mode-enabled"),
      tabbedEnabled: this.settings.get_boolean("tabbed-tiling-mode-enabled"),
      tree: serializeNode(wm._tree),
    });
  }
}
