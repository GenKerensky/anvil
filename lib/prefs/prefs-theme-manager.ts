import Gio from "gi://Gio";
import GObject from "gi://GObject";

import { ThemeManagerBase } from "../shared/theme.js";

export class PrefsThemeManager extends ThemeManagerBase {
  static {
    GObject.registerClass(this);
  }

  declare settings: Gio.Settings;

  reloadStylesheet() {
    this.settings.set_string("css-updated", Date.now().toString());
  }
}
