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

import Gio from "gi://Gio";

import { production } from "./settings.js";

export class Logger {
  static #settings: Gio.Settings;

  static LOG_LEVELS = {
    OFF: 0,
    FATAL: 1,
    ERROR: 2,
    WARN: 3,
    INFO: 4,
    DEBUG: 5,
    TRACE: 6,
    ALL: 7,
  };

  static init(settings: Gio.Settings) {
    this.#settings = settings;
  }

  static get #level() {
    if (this.#settings?.get_boolean?.("logging-enabled")) {
      return production
        ? Logger.LOG_LEVELS.OFF
        : this.#settings?.get_uint?.("log-level") ?? Logger.LOG_LEVELS.OFF;
    }
    return Logger.LOG_LEVELS.OFF;
  }

  // TODO: use console.* methods
  static format(msg: string, ...params: string[]) {
    return params.reduce((acc: string, val) => acc.replace("{}", val), msg);
  }

  static fatal(...args: unknown[]) {
    if (this.#level > Logger.LOG_LEVELS.OFF) log(`[Anvil] [FATAL]`, ...(args as any[]));
  }

  static error(...args: unknown[]) {
    if (this.#level > Logger.LOG_LEVELS.FATAL) log(`[Anvil] [ERROR]`, ...(args as any[]));
  }

  static warn(...args: unknown[]) {
    if (this.#level > Logger.LOG_LEVELS.ERROR) log(`[Anvil] [WARN]`, ...(args as any[]));
  }

  static info(...args: unknown[]) {
    if (this.#level > Logger.LOG_LEVELS.WARN) log(`[Anvil] [INFO]`, ...(args as any[]));
  }

  static debug(...args: unknown[]) {
    if (this.#level > Logger.LOG_LEVELS.INFO) log(`[Anvil] [DEBUG]`, ...(args as any[]));
  }

  static trace(...args: unknown[]) {
    if (this.#level > Logger.LOG_LEVELS.DEBUG) log(`[Anvil] [TRACE]`, ...(args as any[]));
  }

  static log(...args: unknown[]) {
    if (this.#level > Logger.LOG_LEVELS.OFF) log(`[Anvil] [LOG]`, ...(args as any[]));
  }
}
