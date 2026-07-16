import Gio from "gi://Gio";
import GLib from "gi://GLib";
import GObject from "gi://GObject";

import { ThemeManagerBase } from "../shared/theme.js";
import { Logger } from "../shared/logger.js";

export class PrefsThemeManager extends ThemeManagerBase {
  static {
    GObject.registerClass(this);
  }

  declare settings: Gio.Settings;

  reloadStylesheet() {
    try {
      return this.settings.set_string("css-updated", GLib.uuid_string_random()) !== false;
    } catch (error) {
      Logger.warn(`Could not request Shell stylesheet reload: ${error}`);
      return false;
    }
  }
}
