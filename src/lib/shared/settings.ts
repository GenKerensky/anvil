/*
 * This file is part of the Anvil Window Manager extension for Gnome 3
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
import GLib from "gi://GLib";
import GObject from "gi://GObject";

import { Logger } from "./logger.js";

// Dev or Prod mode, see Makefile:debug
export const production = true;

export interface WindowOverride {
  wmClass: string;
  wmTitle?: string;
  wmId?: string;
  mode: string;
}

export interface WindowConfig {
  overrides: WindowOverride[];
}

export class ConfigManager extends GObject.Object {
  static {
    GObject.registerClass(this);
  }

  extensionPath!: string;

  #confDir = GLib.get_user_config_dir();

  constructor({ dir }: { dir: Gio.File }) {
    super();
    this.extensionPath = dir.get_path()!;
  }

  get confDir() {
    return `${this.#confDir}/anvil`;
  }

  get defaultStylesheetFile() {
    const defaultStylesheet = GLib.build_filenamev([this.extensionPath, `stylesheet.css`]);

    Logger.trace(`default-stylesheet: ${defaultStylesheet}`);

    const defaultStylesheetFile = Gio.File.new_for_path(defaultStylesheet);
    if (defaultStylesheetFile.query_exists(null)) {
      return defaultStylesheetFile;
    }
    return null;
  }

  get stylesheetFile() {
    const profileSettingPath = `${this.confDir}/stylesheet/anvil`;
    const settingFile = "stylesheet.css";
    const defaultSettingFile = this.defaultStylesheetFile;
    return this.loadFile(profileSettingPath, settingFile, defaultSettingFile);
  }

  get defaultWindowConfigFile() {
    const defaultWindowConfig = GLib.build_filenamev([
      this.extensionPath,
      `config`,
      `windows.json`,
    ]);

    Logger.trace(`default-window-config: ${defaultWindowConfig}`);
    const defaultWindowConfigFile = Gio.File.new_for_path(defaultWindowConfig);

    if (defaultWindowConfigFile.query_exists(null)) {
      return defaultWindowConfigFile;
    }
    return null;
  }

  loadDefaultWindowConfigContents() {
    const defaultSettingFile = this.defaultWindowConfigFile;
    if (defaultSettingFile) {
      const contents = this.loadFileContents(defaultSettingFile);
      if (contents) {
        try {
          return JSON.parse(contents);
        } catch (e) {
          Logger.error(`Failed to parse default window config: ${e}`);
        }
      }
    }
    return null;
  }

  get windowConfigFile() {
    const profileSettingPath = `${this.confDir}/config`;
    const settingFile = "windows.json";
    const defaultSettingFile = this.defaultWindowConfigFile;
    return this.loadFile(profileSettingPath, settingFile, defaultSettingFile);
  }

  loadFile(path: string, file: string, defaultFile: Gio.File | null) {
    const customSetting = GLib.build_filenamev([path, file]);
    Logger.trace(`custom-setting-file: ${customSetting}`);

    const customSettingFile = Gio.File.new_for_path(customSetting);
    if (customSettingFile.query_exists(null)) {
      return customSettingFile;
    } else {
      const profileCustomSettingDir = Gio.File.new_for_path(path);
      if (!profileCustomSettingDir.query_exists(null)) {
        if (profileCustomSettingDir.make_directory_with_parents(null)) {
          const createdStream = customSettingFile.create(Gio.FileCreateFlags.NONE, null);
          const defaultContents = defaultFile ? this.loadFileContents(defaultFile) : null;
          Logger.trace(defaultContents);
          createdStream.write_all(defaultContents ?? "", null);
        }
      }
    }

    return null;
  }

  loadFileContents(configFile: Gio.File) {
    const [success, contents] = configFile.load_contents(null);
    if (success) {
      const stringContents = new TextDecoder().decode(contents as Uint8Array);
      return stringContents;
    }
  }

  get windowProps(): WindowConfig | null {
    let windowConfigFile = this.windowConfigFile;
    let windowProps = null;
    // if (!windowConfigFile || !production) {
    if (!windowConfigFile) {
      windowConfigFile = this.defaultWindowConfigFile;
    }

    if (!windowConfigFile) return null;

    const [success, contents] = windowConfigFile.load_contents(null);
    if (success) {
      const windowConfigContents = new TextDecoder().decode(contents as Uint8Array);
      Logger.trace(`${windowConfigContents}`);
      try {
        windowProps = JSON.parse(windowConfigContents);
      } catch (e) {
        Logger.error(`Failed to parse window config: ${e}`);
      }
    }
    return windowProps;
  }

  set windowProps(props: WindowConfig | null) {
    let windowConfigFile = this.windowConfigFile;
    // if (!windowConfigFile || !production) {
    if (!windowConfigFile) {
      windowConfigFile = this.defaultWindowConfigFile;
    }

    if (!windowConfigFile) return;

    const windowConfigContents = JSON.stringify(props, null, 4);

    const PERMISSIONS_MODE = 0o744;

    const parentPath = windowConfigFile.get_parent()?.get_path();
    if (parentPath && GLib.mkdir_with_parents(parentPath, PERMISSIONS_MODE) === 0) {
      const [_, _tag] = windowConfigFile.replace_contents(
        windowConfigContents as string,
        null,
        false,
        Gio.FileCreateFlags.REPLACE_DESTINATION,
        null
      );
    }
  }
}
