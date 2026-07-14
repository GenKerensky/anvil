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
import { AnvilRuntime } from "./lib/extension/anvil-runtime.js";
import {
  FeatureIndicator,
  FeatureMenuToggle,
  type QuickSettingsExternalIndicator,
} from "./lib/extension/indicator.js";
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

/**
 * Official test probe for E2E / automation (B1-3).
 * Prefer this over walking private `_tree` / `_nodes` fields.
 */
export interface AnvilTestProbe {
  getTestState(): string | null;
  isIndicatorVisible(): boolean;
}

export default class AnvilExtension extends Extension {
  /** Present only while enabled; null after disable (B1-2). */
  private _settings: Gio.Settings | null = null;
  private _kbdSettings: Gio.Settings | null = null;
  private _configMgr: ConfigManager | null = null;
  private _theme: ExtensionThemeManager | null = null;
  private _runtime: AnvilRuntime | null = null;
  private _keybindings: Keybindings | null = null;
  indicator: FeatureIndicator | null = null;
  private _sessionId: number | null = null;
  private _savedSettings: SavedSetting[] | null = null;
  private _gnomeSettings: Map<string, Gio.Settings> | null = null;
  private _testProbe: AnvilTestProbe | null = null;

  /** GSettings for the extension — throws if used outside enable/disable cycle. */
  get settings(): Gio.Settings {
    if (!this._settings) throw new Error("AnvilExtension.settings used while disabled");
    return this._settings;
  }

  get kbdSettings(): Gio.Settings {
    if (!this._kbdSettings) throw new Error("AnvilExtension.kbdSettings used while disabled");
    return this._kbdSettings;
  }

  get configMgr(): ConfigManager {
    if (!this._configMgr) throw new Error("AnvilExtension.configMgr used while disabled");
    return this._configMgr;
  }

  get theme(): ExtensionThemeManager {
    if (!this._theme) throw new Error("AnvilExtension.theme used while disabled");
    return this._theme;
  }

  get runtime(): AnvilRuntime {
    if (!this._runtime) throw new Error("AnvilExtension.runtime used while disabled");
    return this._runtime;
  }

  get keybindings(): Keybindings {
    if (!this._keybindings) throw new Error("AnvilExtension.keybindings used while disabled");
    return this._keybindings;
  }

  enable() {
    this._settings = this.getSettings();
    this._kbdSettings = this.getSettings("org.gnome.shell.extensions.anvil.keybindings");
    Logger.init(this.settings);
    Logger.info("enable");

    // Always export runtime + settings for E2E test access (used by test/e2e/lib/commands.js)
    // In GNOME 50+, Main.extensionManager.lookup() returns a proxy that only
    // exposes base Extension properties — custom fields and methods (getSettings)
    // are not forwarded. Expose them on global to bypass the proxy.
    {
      const g = global as unknown as {
        __anvil_runtime?: AnvilRuntime | null;
        __anvil_settings?: Gio.Settings | null;
      };
      g.__anvil_runtime = null;
      g.__anvil_settings = this.settings;
    }

    // Test mode exposes a narrow probe for in-process automation. It must
    // never modify GNOME Shell's global unsafe mode; the E2E harness uses
    // direct GJS APIs and does not need Shell.Eval.
    if (this.settings.get_boolean("test-mode")) {
      this._testProbe = {
        getTestState: () => this.getTestState(),
        isIndicatorVisible: () => this.indicator !== null,
      };
      const g = global as unknown as { __anvil_test_state: AnvilTestProbe | null };
      g.__anvil_test_state = this._testProbe;
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

    this._configMgr = new ConfigManager(this as { dir: Gio.File });
    this._theme = new ExtensionThemeManager(this);
    // Construct the runtime first (Keybindings needs ext.runtime), then wire keybindings
    // explicitly so getters never lazy-create subsystems (B2-2, B4-9).
    this._runtime = new AnvilRuntime(this);
    this._keybindings = new Keybindings(this);
    this._runtime.wireKeybindings(this._keybindings);

    this._theme.patchCss();
    this._theme.reloadStylesheet();
    // Runtime must be fully active before session-mode handling enables keybindings.
    this._runtime.enable();
    {
      const g = global as unknown as { __anvil_runtime?: AnvilRuntime | null };
      g.__anvil_runtime = this._runtime;
    }

    this._onSessionModeChanged(Main.sessionMode);
    this._sessionId = Main.sessionMode.connect("updated", this._onSessionModeChanged.bind(this));
    Logger.info("enable: finalized vars");
  }

  disable() {
    Logger.info("disable");
    // session-modes: ["user", "unlock-dialog"] — the extension persists
    // through screen lock to preserve tree/window state during the unlock
    // transition. Keybindings are disconnected in _onSessionModeChanged
    // when entering unlock-dialog mode, and reconnected when returning to user mode.

    {
      const g = global as unknown as {
        __anvil_runtime?: AnvilRuntime | null;
        __anvil_settings?: Gio.Settings | null;
      };
      g.__anvil_runtime = null;
      g.__anvil_settings = null;
    }

    const g = global as unknown as { __anvil_test_state: AnvilTestProbe | null };
    if (g.__anvil_test_state === this._testProbe) {
      g.__anvil_test_state = null;
    }
    this._testProbe = null;

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
    this._runtime?.disable();
    this._keybindings?.disable();
    // Honest nulls — no `null as unknown as T` (B1-2).
    this._keybindings = null;
    this._runtime = null;
    this._theme = null;
    this._configMgr = null;
    this._settings = null;
    this._kbdSettings = null;
  }

  _onSessionModeChanged(session: { currentMode: string; parentMode: string }) {
    if (session.currentMode === "user" || session.parentMode === "user") {
      Logger.info("user on session change");
      this._addIndicator();
      this._keybindings?.enable();
    } else if (session.currentMode === "unlock-dialog") {
      this._removeIndicator();
      this._keybindings?.disable();
    }
  }

  _addIndicator() {
    if (this.indicator) return;
    this.indicator = new FeatureIndicator(this);
    const featureToggle = new FeatureMenuToggle(this);
    this.indicator.quickSettingsItems.push(featureToggle);
    Main.panel.statusArea.quickSettings.addExternalIndicator(
      this.indicator as unknown as QuickSettingsExternalIndicator
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

  /**
   * AnvilTestProbe — JSON snapshot for E2E (B1-3).
   * Delegates tree serialization to AnvilRuntime; does not walk private fields.
   */
  getTestState(): string | null {
    if (!this._settings?.get_boolean("test-mode")) return null;
    if (!this._runtime) {
      return JSON.stringify({ error: "AnvilRuntime not initialized" });
    }
    return this._runtime.getTestStateJson();
  }
}
