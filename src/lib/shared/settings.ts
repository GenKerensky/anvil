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

/**
 * Shared WindowConfig schema for shell + prefs (C4-1).
 * Mode is a closed set; title/class matchers use RulesEngine grammars.
 */
export type WindowOverrideMode = "float" | "tile";

export interface WindowOverride {
  wmClass: string;
  wmTitle?: string;
  wmId?: string;
  mode: WindowOverrideMode;
}

export interface WindowConfig {
  overrides: WindowOverride[];
}

/** Runtime check for JSON loaded from windows.json. */
export function isWindowConfig(value: unknown): value is WindowConfig {
  if (!value || typeof value !== "object") return false;
  const o = value as { overrides?: unknown };
  if (!Array.isArray(o.overrides)) return false;
  return o.overrides.every((item) => {
    if (!item || typeof item !== "object") return false;
    const row = item as WindowOverride;
    return (
      typeof row.wmClass === "string" &&
      row.wmClass.trim().length > 0 &&
      (row.mode === "float" || row.mode === "tile") &&
      (row.wmTitle === undefined || typeof row.wmTitle === "string") &&
      (row.wmId === undefined || typeof row.wmId === "string")
    );
  });
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
    const stylesheet = this.userStylesheetFile;
    return stylesheet.query_exists(null) ? stylesheet : null;
  }

  /** Stable user stylesheet handle. Merely reading this property never creates files. */
  get userStylesheetFile() {
    return Gio.File.new_for_path(
      GLib.build_filenamev([this.confDir, "stylesheet", "anvil", "stylesheet.css"])
    );
  }

  /** Deterministic, non-overwriting recovery path for a migrated shipped default. */
  stylesheetBackupFile(version: number, sourceDigest: string) {
    const source = this.userStylesheetFile.get_path()!;
    return Gio.File.new_for_path(`${source}.bak-v${version}-${sourceDigest.slice(0, 12)}`);
  }

  /** Unique staging path used before an exclusive first-install move. */
  stylesheetTemporaryFile(token: string) {
    const source = this.userStylesheetFile.get_path()!;
    return Gio.File.new_for_path(`${source}.tmp-${token}`);
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
        return this.parseWindowConfig(
          contents,
          "default window config",
          defaultSettingFile.get_path()
        );
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
      windowProps = this.parseWindowConfig(
        windowConfigContents,
        "window config",
        windowConfigFile.get_path()
      );
    }
    return windowProps;
  }

  set windowProps(props: WindowConfig | null) {
    if (!isWindowConfig(props)) {
      Logger.error("Invalid window config: refusing to write");
      return;
    }
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

  private parseWindowConfig(
    contents: string,
    label: string,
    path: string | null = null
  ): WindowConfig | null {
    const source = path ? `${label} (${path})` : label;
    let parsed: unknown;
    try {
      parsed = JSON.parse(contents);
    } catch (e) {
      Logger.error(`Failed to parse ${source}: ${e}`);
      return null;
    }
    if (!isWindowConfig(parsed)) {
      Logger.error(`Invalid ${source}: expected valid float/tile override rows`);
      return null;
    }
    return parsed;
  }
}
