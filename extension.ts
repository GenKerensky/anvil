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

export default class AnvilExtension extends Extension {
  settings!: Gio.Settings;
  kbdSettings!: Gio.Settings;
  configMgr!: ConfigManager;
  theme!: ExtensionThemeManager;
  extWm!: WindowManager;
  keybindings!: Keybindings;
  indicator: FeatureIndicator | null = null;
  private _sessionId: number | null = null;

  enable() {
    this.settings = this.getSettings();
    this.kbdSettings = this.getSettings("org.gnome.shell.extensions.anvil.keybindings");
    Logger.init(this.settings);
    Logger.info("enable");

    if (this.settings.get_boolean("test-mode")) {
      (global as any).context.unsafe_mode = true;
      (global as any).__anvil_test_state = this;
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

    if ((global as any).__anvil_test_state === this) {
      (global as any).__anvil_test_state = null;
    }

    if (this._sessionId) {
      Main.sessionMode.disconnect(this._sessionId);
      this._sessionId = null;
    }

    this._removeIndicator();
    this.extWm?.disable();
    this.keybindings?.disable();
    this.keybindings = null as any;
    this.extWm = null as any;
    this.theme = null as any;
    this.configMgr = null as any;
    this.settings = null as any;
    this.kbdSettings = null as any;
  }

  _onSessionModeChanged(session: any) {
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
    Main.panel.statusArea.quickSettings.addExternalIndicator(this.indicator as any);
  }

  _removeIndicator() {
    if (!this.indicator) return;
    this.indicator.quickSettingsItems.forEach((item) => item.destroy());
    this.indicator.quickSettingsItems.length = 0;
    this.indicator.destroy();
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
    const wm = this.extWm as any;
    if (!wm) return JSON.stringify({ error: "WindowManager not initialized" });

    const serializeNode = (node: any): any => {
      if (!node) return null;
      const data: any = {
        type: node._type,
        layout: node.layout ?? null,
        mode: node.mode ?? null,
        childCount: node._nodes?.length ?? 0,
        children: (node._nodes ?? []).map(serializeNode),
      };
      if (node._type === "WINDOW" && node.nodeValue) {
        data.wmClass = node.nodeValue.wm_class ?? null;
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
