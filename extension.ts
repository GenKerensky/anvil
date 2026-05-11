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
      const g = global as unknown as {
        context: { unsafe_mode: boolean };
        __anvil_test_state: unknown;
      };
      g.context.unsafe_mode = true;
      g.__anvil_test_state = this;
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

    const g = global as unknown as { __anvil_test_state: unknown };
    if (g.__anvil_test_state === this) {
      g.__anvil_test_state = null;
    }

    if (this._sessionId) {
      Main.sessionMode.disconnect(this._sessionId);
      this._sessionId = null;
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
