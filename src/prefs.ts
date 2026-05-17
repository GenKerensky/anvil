/*
 * This file is part of the Anvil GNOME extension
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
import Adw from "gi://Adw";
import Gdk from "gi://Gdk";
import Gtk from "gi://Gtk";

import { ExtensionPreferences } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

import { KeyboardPage } from "./lib/prefs/keyboard.js";
import { AppearancePage } from "./lib/prefs/appearance.js";
import { SettingsPage } from "./lib/prefs/settings.js";
import { FloatingPage } from "./lib/prefs/floating.js";
import { MonitorsPage } from "./lib/prefs/monitors.js";

export default class AnvilExtensionPreferences extends ExtensionPreferences {
  window!: Adw.PreferencesWindow;

  settings = this.getSettings();

  kbdSettings = this.getSettings("org.gnome.shell.extensions.anvil.keybindings");

  constructor(args: ConstructorParameters<typeof ExtensionPreferences>[0]) {
    super(args);
    const iconPath = this.dir.get_child("resources").get_child("icons").get_path() ?? "";
    const display = Gdk.Display.get_default();
    if (display) {
      const iconTheme = Gtk.IconTheme.get_for_display(display as Gdk.Display);
      iconTheme.add_search_path(iconPath);
    }
  }

  async fillPreferencesWindow(window: Adw.PreferencesWindow) {
    this.window = window;
    window.add(new SettingsPage({ settings: this.settings, window, metadata: this.metadata }));
    window.add(new AppearancePage({ settings: this.settings, dir: this.dir }));
    window.add(new KeyboardPage({ kbdSettings: this.kbdSettings }));
    window.add(new FloatingPage({ settings: this.settings, dir: this.dir }));
    window.add(new MonitorsPage({ settings: this.settings }));
    window.search_enabled = true;
    window.can_navigate_back = true;
  }
}
