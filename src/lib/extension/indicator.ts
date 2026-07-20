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
 */

import GObject from "gi://GObject";
import Gio from "gi://Gio";
import St from "gi://St";

import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";
import { QuickMenuToggle, SystemIndicator } from "resource:///org/gnome/shell/ui/quickSettings.js";
import {
  PopupSwitchMenuItem,
  PopupSeparatorMenuItem,
} from "resource:///org/gnome/shell/ui/popupMenu.js";

import * as Utils from "./utils.js";
import { Logger } from "../shared/logger.js";

const shellIconPath = [
  "resources",
  "icons",
  "hicolor",
  "symbolic",
  "apps",
  "org.gnome.shell.extensions.anvil-symbolic.svg",
] as const;

type AnvilExtension = import("../../extension.js").default;

function createShellIcon(extension: AnvilExtension): Gio.FileIcon {
  const file = shellIconPath.reduce((path, segment) => path.get_child(segment), extension.dir);
  return Gio.FileIcon.new(file);
}

/**
 * Thin adapter for Quick Settings addExternalIndicator (C1-1).
 * GIR typings for Quick Settings are incomplete; keep the cast in one place.
 */
export type QuickSettingsExternalIndicator = Parameters<
  typeof Main.panel.statusArea.quickSettings.addExternalIndicator
>[0];

class SettingsPopupSwitch extends PopupSwitchMenuItem {
  static {
    GObject.registerClass(this);
  }

  extension: AnvilExtension;

  constructor(title: string, extension: AnvilExtension, bind: string) {
    const active = !!extension.settings.get_boolean(bind);
    super(title, active);
    this.extension = extension;
    Logger.info(bind, active);
    this.connect("toggled", (item) => this.extension.settings.set_boolean(bind, item.state));
  }
}

export class FeatureMenuToggle extends QuickMenuToggle {
  static {
    GObject.registerClass(this);
  }

  extension!: AnvilExtension;
  _singleSwitch!: SettingsPopupSwitch;
  _focusHintSwitch!: SettingsPopupSwitch;
  _focusMovePointer!: SettingsPopupSwitch;
  constructor(extension: AnvilExtension) {
    const title = _("Tiling");
    const gicon = createShellIcon(extension);
    const initSettings = Utils.isGnomeGTE(45)
      ? { title, gicon, toggleMode: true }
      : { label: title, gicon, toggleMode: true };
    super(initSettings);
    this.extension = extension;
    this.extension.settings.bind(
      "tiling-mode-enabled",
      this,
      "checked",
      Gio.SettingsBindFlags.DEFAULT
    );
    this.extension.settings.bind(
      "quick-settings-enabled",
      this,
      "visible",
      Gio.SettingsBindFlags.DEFAULT
    );

    this.menu.setHeader(gicon, _("Anvil"), _("Tiling Window Management"));

    this.menu.addMenuItem(
      (this._singleSwitch = new SettingsPopupSwitch(
        _("Gaps Hidden when Single"),
        this.extension,
        "window-gap-hidden-on-single"
      ))
    );

    this.menu.addMenuItem(
      (this._focusHintSwitch = new SettingsPopupSwitch(
        _("Show Focus Hint Border"),
        this.extension,
        "focus-border-toggle"
      ))
    );

    this.menu.addMenuItem(
      (this._focusMovePointer = new SettingsPopupSwitch(
        _("Move Pointer with the Focus"),
        this.extension,
        "move-pointer-focus-enabled"
      ))
    );

    // Add an entry-point for more settings
    this.menu.addMenuItem(new PopupSeparatorMenuItem());
    const settingsItem = this.menu.addAction(_("Settings"), () => this.extension.openPreferences());

    // Ensure the settings are unavailable when the screen is locked
    settingsItem.visible = Main.sessionMode.allowSettings;
    (
      this.menu as unknown as {
        _settingsActions: Record<string, unknown>;
      }
    )._settingsActions[this.extension.uuid] = settingsItem;
  }
}

export class FeatureIndicator extends SystemIndicator {
  static {
    GObject.registerClass(this);
  }

  extension!: AnvilExtension;
  _indicator!: St.Icon;
  quickSettingsItems: FeatureMenuToggle[] = [];
  _settingsChangedId: number;

  constructor(extension: AnvilExtension) {
    super();

    this.extension = extension;

    // Create the icon for the indicator
    this._indicator = (this as unknown as { _addIndicator: () => St.Icon })._addIndicator();
    this._indicator.gicon = createShellIcon(extension);

    const tilingModeEnabled = this.extension.settings.get_boolean("tiling-mode-enabled");
    const quickSettingsEnabled = this.extension.settings.get_boolean("quick-settings-enabled");

    this._indicator.visible = tilingModeEnabled && quickSettingsEnabled;

    // Phase A fix: Save settings handler ID and disconnect on destroy
    // Credit: mayconrcmello/forge PR #521
    this._settingsChangedId = this.extension.settings.connect(
      "changed",
      (_settings: Gio.Settings, name: string) => {
        switch (name) {
          case "tiling-mode-enabled":
          case "quick-settings-enabled":
            this._indicator.visible = this.extension.settings.get_boolean(name);
        }
      }
    );

    // Disconnect the settings handler when this indicator is destroyed
    this.connect("destroy", () => {
      if (this._settingsChangedId) {
        this.extension.settings.disconnect(this._settingsChangedId);
        this._settingsChangedId = 0;
      }
    });
  }
}
