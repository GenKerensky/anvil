import GObject from "gi://GObject";
import Gio from "gi://Gio";
import St from "gi://St";

import { ThemeManagerBase } from "../shared/theme.js";
import { Logger } from "../shared/logger.js";

export class ExtensionThemeManager extends ThemeManagerBase {
  static {
    GObject.registerClass(this);
  }

  metadata!: { uuid: string };
  stylesheet!: Gio.File | null;
  stylesheets: Gio.File[] = [];
  private _packagedStylesheetDetached = false;

  constructor(extension: import("../../extension.js").default) {
    super(extension);
    this.metadata = extension.metadata;
  }

  reloadStylesheet() {
    const uuid = this.metadata.uuid;
    const selection = this.lastMigrationResult;
    if (!selection?.usable || (!selection.baseFile && !selection.overrideFile)) return false;

    const theme = St.ThemeContext.get_for_stage(global.stage).get_theme();
    const previousStylesheets = [...this.stylesheets];

    if (!this._unloadFrom(theme)) {
      Logger.error(`${uuid} - could not unload every active stylesheet; reload deferred`);
      return false;
    }

    // GNOME Shell loads the extension's root stylesheet.css before enable().
    // Remove that unmanaged copy once so Anvil can select exactly one complete
    // stylesheet below and avoid duplicate shipped/user declarations.
    if (!this._packagedStylesheetDetached && selection.baseFile) {
      try {
        theme.unload_stylesheet(selection.baseFile);
        this._packagedStylesheetDetached = true;
      } catch (error) {
        Logger.error(`${uuid} - could not detach packaged stylesheet: ${error}`);
        this._restore(theme, previousStylesheets);
        return false;
      }
    }

    // The migrated user stylesheet is a complete editable copy, not a sparse
    // CSS layer. Load it alone so duplicate shipped selectors cannot win the
    // cascade; keep the packaged file strictly as the fallback.
    if (selection.overrideFile) {
      try {
        if (theme.load_stylesheet(selection.overrideFile) === false) {
          throw new Error("St.Theme.load_stylesheet returned false");
        }
        this.stylesheets.push(selection.overrideFile);
      } catch (error) {
        Logger.warn(`${uuid} - user stylesheet rejected; using shipped defaults: ${error}`);
      }
    }

    if (this.stylesheets.length === 0 && selection.baseFile) {
      try {
        if (theme.load_stylesheet(selection.baseFile) === false) {
          throw new Error("St.Theme.load_stylesheet returned false");
        }
        this.stylesheets.push(selection.baseFile);
      } catch (error) {
        Logger.error(`${uuid} - could not load shipped stylesheet: ${error}`);
        if (!this._unloadFrom(theme)) {
          Logger.error(`${uuid} - could not unload partial stylesheet reload; restore deferred`);
          return false;
        }
        this._restore(theme, previousStylesheets);
        this.stylesheet = this.stylesheets.at(-1) ?? null;
        return false;
      }
    }

    this.stylesheet = this.stylesheets.at(-1) ?? null;
    return this.stylesheets.length > 0;
  }

  /** Re-evaluate files before handling a cross-process preferences notification. */
  refreshStylesheet() {
    const selection = this.initializeStylesheet();
    return selection.usable ? this.reloadStylesheet() : false;
  }

  unloadStylesheets() {
    const theme = St.ThemeContext.get_for_stage(global.stage).get_theme();
    return this._unloadFrom(theme);
  }

  private _unloadFrom(theme: St.Theme) {
    const failed: Gio.File[] = [];
    for (const loaded of [...this.stylesheets].reverse()) {
      try {
        theme.unload_stylesheet(loaded);
      } catch (error) {
        Logger.warn(`${this.metadata.uuid} - could not unload stylesheet: ${error}`);
        failed.push(loaded);
      }
    }
    this.stylesheets = failed.reverse();
    this.stylesheet = this.stylesheets.at(-1) ?? null;
    return this.stylesheets.length === 0;
  }

  private _restore(theme: St.Theme, previousStylesheets: Gio.File[]): void {
    for (const previous of previousStylesheets) {
      try {
        if (theme.load_stylesheet(previous) === false) {
          Logger.error(
            `${this.metadata.uuid} - St.Theme rejected a previous stylesheet during restore`
          );
          continue;
        }
        this.stylesheets.push(previous);
      } catch (error) {
        Logger.error(`${this.metadata.uuid} - could not restore previous stylesheet: ${error}`);
      }
    }
  }
}
