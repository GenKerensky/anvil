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
import Gio from "gi://Gio";
import GObject from "gi://GObject";
import Meta from "gi://Meta";
import Shell from "gi://Shell";

// Gnome Shell imports
import * as Main from "resource:///org/gnome/shell/ui/main.js";

// Shared state
import { Logger } from "../shared/logger.js";
import { KEYBINDING_TABLE, type BindingCtx } from "./keybinding-table.js";
import type { AnvilAction } from "./window/actions.js";

export class Keybindings extends GObject.Object {
  static {
    GObject.registerClass(this);
  }

  extWm!: import("./window.js").WindowManager;
  kbdSettings!: Gio.Settings;
  settings!: Gio.Settings;
  private _bindings!: Record<string, () => void>;

  ext: import("../../extension.js").default;

  constructor(ext: import("../../extension.js").default) {
    super();
    Logger.debug(`created keybindings`);
    this.ext = ext;
    this.extWm = ext.extWm;
    this.kbdSettings = ext.kbdSettings;
    this.settings = ext.settings;
    this.buildBindingDefinitions();
  }

  enable() {
    const keybindings = this._bindings;

    for (const key in keybindings) {
      Main.wm.addKeybinding(
        key,
        this.kbdSettings,
        Meta.KeyBindingFlags.NONE,
        Shell.ActionMode.NORMAL,
        keybindings[key]
      );
    }

    Logger.debug(`keybindings:enable`);
  }

  disable() {
    const keybindings = this._bindings;

    for (const key in keybindings) {
      Main.wm.removeKeybinding(key);
    }

    Logger.debug(`keybindings:disable`);
  }

  get modifierState() {
    const pointer = global.get_pointer();
    return (pointer as unknown as number[])[2] ?? 0;
  }

  allowDragDropTile() {
    const tileModifier = this.kbdSettings.get_string("mod-mask-mouse-tile");
    const modState = this.modifierState;
    // Using Clutter.ModifierType values and also testing for pointer
    // being grabbed (256). E.g. grabbed + pressing Super = 256 + 64 = 320
    // See window.js#_handleMoving() - an overlay preview is shown.
    // See window.js#_handleGrabOpEnd() - when the drag has been dropped
    switch (tileModifier) {
      case "Super":
        return modState === 64 || modState === 320;
      case "Alt":
        return modState === 8 || modState === 264;
      case "Ctrl":
        return modState === 4 || modState === 260;
      case "None":
        return true;
    }
    return false;
  }

  buildBindingDefinitions() {
    const ctx: BindingCtx = {
      settings: this.settings,
      kbdSettings: this.kbdSettings,
    };
    this._bindings = Object.fromEntries(
      KEYBINDING_TABLE.map((spec) => [
        spec.key,
        () => {
          const action: AnvilAction =
            typeof spec.action === "function" ? spec.action(ctx) : spec.action;
          this.extWm.command(action);
        },
      ])
    );
  }
}
