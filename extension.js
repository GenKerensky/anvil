/*
 * This file is part of the Anvil GNOME extension
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
// eslint-disable-next-line no-unused-vars
import Gio from "gi://Gio";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { Extension, gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";

// Shared state
import { Logger } from "./lib/shared/logger.js";
import { ConfigManager } from "./lib/shared/settings.js";

// Application imports
import { Keybindings } from "./lib/extension/keybindings.js";
import { WindowManager } from "./lib/extension/window.js";
import { FeatureIndicator, FeatureMenuToggle } from "./lib/extension/indicator.js";
import { ExtensionThemeManager } from "./lib/extension/extension-theme-manager.js";

export default class AnvilExtension extends Extension {
  /** @type {Gio.Settings | null} */
  settings = null;
  /** @type {Gio.Settings | null} */
  kbdSettings = null;
  /** @type {ConfigManager | null} */
  configMgr = null;
  /** @type {ExtensionThemeManager | null} */
  theme = null;
  /** @type {WindowManager | null} */
  extWm = null;
  /** @type {Keybindings | null} */
  keybindings = null;
  /** @type {FeatureIndicator | null} */
  indicator = null;

  enable() {
    this.settings = this.getSettings();
    this.kbdSettings = this.getSettings("org.gnome.shell.extensions.anvil.keybindings");
    Logger.init(this.settings);
    Logger.info("enable");

    // Enable unsafe mode for E2E tests — allows org.gnome.Shell.Eval D-Bus calls
    if (this.settings.get_boolean("test-mode")) {
      global.context.unsafe_mode = true;
    }

    this.configMgr = new ConfigManager(/** @type {any} */ (this));
    this.theme = new ExtensionThemeManager(this);
    this.extWm = new WindowManager(this);
    this.keybindings = new Keybindings(this);

    this._onSessionModeChanged(Main.sessionMode);
    this._sessionId = Main.sessionMode.connect("updated", this._onSessionModeChanged.bind(this));

    this.theme.patchCss();
    this.theme.reloadStylesheet();
    this.extWm.enable();
    Logger.info(`enable: finalized vars`);
  }

  disable() {
    Logger.info("disable");

    // See session mode unlock-dialog explanation on _onSessionModeChanged()
    if (this._sessionId) {
      Main.sessionMode.disconnect(this._sessionId);
      this._sessionId = null;
    }

    this._removeIndicator();
    this.extWm?.disable();
    this.keybindings?.disable();
    this.keybindings = null;
    this.extWm = null;
    this.theme = null;
    this.configMgr = null;
    this.settings = null;
    this.kbdSettings = null;
  }

  _onSessionModeChanged(session) {
    if (session.currentMode === "user" || session.parentMode === "user") {
      Logger.info("user on session change");
      this._addIndicator();
      this.keybindings?.enable();
    } else if (session.currentMode === "unlock-dialog") {
      // To the reviewer and maintainer: this extension needs to persist the window data structure in memory so it has to keep running on lock screen.
      // This is previous feature but was removed during GNOME 45 update due to the session-mode rule review.
      // The argument is that users will keep re-arranging windows when it times out or locks up.
      // Intent to serialize/deserialize to disk but that will take a longer time or probably a longer argument during review.
      // To keep following, added to only disable keybindings() and re-enable them during user session.
      // https://gjs.guide/extensions/review-guidelines/review-guidelines.html#session-modes
      Logger.info("lock-screen on session change");
      this.keybindings?.disable();
      this._removeIndicator();
    }
  }

  _addIndicator() {
    this.indicator ??= new FeatureIndicator(this);
    this.indicator.quickSettingsItems.push(new FeatureMenuToggle(this));
    Main.panel.statusArea.quickSettings.addExternalIndicator(/** @type {any} */ (this.indicator));
  }

  _removeIndicator() {
    this.indicator?.quickSettingsItems.forEach((item) => item.destroy());
    this.indicator?.destroy();
    this.indicator = null;
  }

  /**
   * Returns a JSON string describing the current tiling tree state.
   * Only available when test-mode is enabled. Used by the E2E test suite
   * via org.gnome.Shell.Eval.
   *
   * @returns {string|null}
   */
  getTestState() {
    if (!this.settings?.get_boolean("test-mode")) return null;
    const wm = this.extWm;
    if (!wm) return JSON.stringify({ error: "WindowManager not initialized" });

    const serializeNode = (node) => {
      if (!node) return null;
      return {
        type: node._type,
        layout: node.layout ?? null,
        mode: node.mode ?? null,
        childCount: node._nodes?.length ?? 0,
        children: (node._nodes ?? []).map(serializeNode),
      };
    };

    return JSON.stringify({
      treeExists: !!wm._tree,
      tilingEnabled: this.settings.get_boolean("tiling-mode-enabled"),
      tree: serializeNode(wm._tree),
    });
  }
}
