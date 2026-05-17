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
    const pointer = this.extWm.getPointer();
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
    this._bindings = {
      "window-toggle-float": () => {
        const actions = [
          {
            name: "FloatToggle",
            mode: "float",
            x: "center",
            y: "center",
            width: 0.65,
            height: 0.75,
          },
        ];
        actions.forEach((action) => {
          this.extWm.command(action);
        });
      },
      "window-toggle-always-float": () => {
        const action = {
          name: "FloatClassToggle",
          mode: "float",
          x: "center",
          y: "center",
          width: 0.65,
          height: 0.75,
        };
        this.extWm.command(action);
      },
      "window-focus-left": () => {
        const actions = [
          {
            name: "Focus",
            direction: "Left",
          },
        ];
        actions.forEach((action) => {
          this.extWm.command(action);
        });
      },
      "window-focus-down": () => {
        const actions = [
          {
            name: "Focus",
            direction: "Down",
          },
        ];
        actions.forEach((action) => {
          this.extWm.command(action);
        });
      },
      "window-focus-up": () => {
        const actions = [
          {
            name: "Focus",
            direction: "Up",
          },
        ];
        actions.forEach((action) => {
          this.extWm.command(action);
        });
      },
      "window-focus-right": () => {
        const actions = [
          {
            name: "Focus",
            direction: "Right",
          },
        ];
        actions.forEach((action) => {
          this.extWm.command(action);
        });
      },
      "window-swap-left": () => {
        const actions = [
          {
            name: "Swap",
            direction: "Left",
          },
        ];
        actions.forEach((action) => {
          this.extWm.command(action);
        });
      },
      "window-swap-down": () => {
        const actions = [
          {
            name: "Swap",
            direction: "Down",
          },
        ];
        actions.forEach((action) => {
          this.extWm.command(action);
        });
      },
      "window-swap-up": () => {
        const actions = [
          {
            name: "Swap",
            direction: "Up",
          },
        ];
        actions.forEach((action) => {
          this.extWm.command(action);
        });
      },
      "window-swap-right": () => {
        const actions = [
          {
            name: "Swap",
            direction: "Right",
          },
        ];
        actions.forEach((action) => {
          this.extWm.command(action);
        });
      },
      "window-move-left": () => {
        const actions = [
          {
            name: "Move",
            direction: "Left",
          },
        ];
        actions.forEach((action) => {
          this.extWm.command(action);
        });
      },
      "window-move-down": () => {
        const actions = [
          {
            name: "Move",
            direction: "Down",
          },
        ];
        actions.forEach((action) => {
          this.extWm.command(action);
        });
      },
      "window-move-up": () => {
        const actions = [
          {
            name: "Move",
            direction: "Up",
          },
        ];
        actions.forEach((action) => {
          this.extWm.command(action);
        });
      },
      "window-move-right": () => {
        const actions = [
          {
            name: "Move",
            direction: "Right",
          },
        ];
        actions.forEach((action) => {
          this.extWm.command(action);
        });
      },
      "con-split-layout-toggle": () => {
        const actions = [{ name: "LayoutToggle" }];
        actions.forEach((action) => {
          this.extWm.command(action);
        });
      },
      "con-split-vertical": () => {
        const actions = [{ name: "Split", orientation: "vertical" }];
        actions.forEach((action) => {
          this.extWm.command(action);
        });
      },
      "con-split-horizontal": () => {
        const actions = [{ name: "Split", orientation: "horizontal" }];
        actions.forEach((action) => {
          this.extWm.command(action);
        });
      },
      "con-stacked-layout-toggle": () => {
        const action = { name: "LayoutStackedToggle" };
        this.extWm.command(action);
      },
      "con-tabbed-layout-toggle": () => {
        const action = { name: "LayoutTabbedToggle" };
        this.extWm.command(action);
      },
      "con-tabbed-showtab-decoration-toggle": () => {
        const action = { name: "ShowTabDecorationToggle" };
        this.extWm.command(action);
      },
      "focus-border-toggle": () => {
        const action = { name: "FocusBorderToggle" };
        this.extWm.command(action);
      },
      "prefs-tiling-toggle": () => {
        const action = { name: "TilingModeToggle" };
        this.extWm.command(action);
      },
      "window-gap-size-increase": () => {
        const action = { name: "GapSize", amount: 1 };
        this.extWm.command(action);
      },
      "window-gap-size-decrease": () => {
        const action = { name: "GapSize", amount: -1 };
        this.extWm.command(action);
      },
      "workspace-active-tile-toggle": () => {
        const action = { name: "WorkspaceActiveTileToggle" };
        this.extWm.command(action);
      },
      "window-close": () => {
        const action = { name: "WindowClose" };
        this.extWm.command(action);
      },
      "prefs-open": () => {
        const action = { name: "PrefsOpen" };
        this.extWm.command(action);
      },
      "window-swap-last-active": () => {
        const action = {
          name: "WindowSwapLastActive",
        };
        this.extWm.command(action);
      },
      "window-snap-one-third-right": () => {
        const action = {
          name: "SnapLayoutMove",
          direction: "Right",
          amount: 1 / 3,
        };
        this.extWm.command(action);
      },
      "window-snap-two-third-right": () => {
        const action = {
          name: "SnapLayoutMove",
          direction: "Right",
          amount: 2 / 3,
        };
        this.extWm.command(action);
      },
      "window-snap-one-third-left": () => {
        const action = {
          name: "SnapLayoutMove",
          direction: "Left",
          amount: 1 / 3,
        };
        this.extWm.command(action);
      },
      "window-snap-two-third-left": () => {
        const action = {
          name: "SnapLayoutMove",
          direction: "Left",
          amount: 2 / 3,
        };
        this.extWm.command(action);
      },
      "window-snap-center": () => {
        const action = {
          name: "SnapLayoutMove",
          direction: "Center",
        };
        this.extWm.command(action);
      },
      "window-resize-top-increase": () => {
        const action = {
          name: "WindowResizeTop",
          amount: this.settings.get_uint("resize-amount"),
        };
        this.extWm.command(action);
      },
      "window-resize-top-decrease": () => {
        const action = {
          name: "WindowResizeTop",
          amount: -1 * this.settings.get_uint("resize-amount"),
        };
        this.extWm.command(action);
      },
      "window-resize-bottom-increase": () => {
        const action = {
          name: "WindowResizeBottom",
          amount: this.settings.get_uint("resize-amount"),
        };
        this.extWm.command(action);
      },
      "window-resize-bottom-decrease": () => {
        const action = {
          name: "WindowResizeBottom",
          amount: -1 * this.settings.get_uint("resize-amount"),
        };
        this.extWm.command(action);
      },
      "window-resize-left-increase": () => {
        const action = {
          name: "WindowResizeLeft",
          amount: this.settings.get_uint("resize-amount"),
        };
        this.extWm.command(action);
      },
      "window-resize-left-decrease": () => {
        const action = {
          name: "WindowResizeLeft",
          amount: -1 * this.settings.get_uint("resize-amount"),
        };
        this.extWm.command(action);
      },
      "window-resize-right-increase": () => {
        const action = {
          name: "WindowResizeRight",
          amount: this.settings.get_uint("resize-amount"),
        };
        this.extWm.command(action);
      },
      "window-resize-right-decrease": () => {
        const action = {
          name: "WindowResizeRight",
          amount: -1 * this.settings.get_uint("resize-amount"),
        };
        this.extWm.command(action);
      },
    };
  }
}
