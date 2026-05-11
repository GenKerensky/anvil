import GObject from "gi://GObject";
import Gio from "gi://Gio";
import St from "gi://St";

import { ThemeManagerBase } from "../shared/theme.js";
import { Logger } from "../shared/logger.js";
import { production } from "../shared/settings.js";

export class ExtensionThemeManager extends ThemeManagerBase {
  static {
    GObject.registerClass(this);
  }

  metadata!: { uuid: string };
  stylesheet!: Gio.File | null;

  constructor(extension: import("../../extension.js").default) {
    super(extension);
    this.metadata = extension.metadata;
  }

  reloadStylesheet() {
    const uuid = this.metadata.uuid;
    const stylesheetFile = this.configMgr.stylesheetFile;
    const defaultStylesheetFile = this.configMgr.defaultStylesheetFile;
    const theme = St.ThemeContext.get_for_stage(global.stage).get_theme();

    try {
      if (defaultStylesheetFile) theme.unload_stylesheet(defaultStylesheetFile);
      if (stylesheetFile) theme.unload_stylesheet(stylesheetFile);
      if (production) {
        if (stylesheetFile) theme.load_stylesheet(stylesheetFile);
        this.stylesheet = stylesheetFile;
      } else {
        if (defaultStylesheetFile) theme.load_stylesheet(defaultStylesheetFile);
        this.stylesheet = defaultStylesheetFile;
      }
    } catch (e) {
      Logger.error(`${uuid} - ${e}`);
      return;
    }
  }
}
