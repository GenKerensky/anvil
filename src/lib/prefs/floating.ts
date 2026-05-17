// Gtk imports
import Adw from "gi://Adw";
import Gio from "gi://Gio";
import GObject from "gi://GObject";
import Gtk from "gi://Gtk";

// Gnome imports
import { gettext as _ } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

// Extension imports
import { PreferencesPage, RemoveItemRow, ResetButton } from "./widgets.js";
import { ConfigManager } from "../shared/settings.js";

interface WindowOverride {
  wmClass: string;
  wmTitle?: string;
  mode: string;
}

export class FloatingPage extends PreferencesPage {
  static {
    GObject.registerClass(this);
  }

  settings!: Gio.Settings;
  private configMgr!: ConfigManager;
  private rows!: RemoveItemRow[];
  private floatingWindowGroup!: Adw.PreferencesGroup;

  constructor({ settings, dir }: { settings: Gio.Settings; dir: Gio.File }) {
    super({ title: _("Windows"), icon_name: "window-symbolic" });

    this.settings = settings;
    this.configMgr = new ConfigManager({ dir });

    const overrides: WindowOverride[] = this.configMgr.windowProps?.overrides ?? [];
    this.rows = this.loadItemsFromConfig(overrides);

    this.floatingWindowGroup = this.add_group({
      title: _("Floating Windows"),
      description: _("Windows that will not be tiled"),
      header_suffix: new ResetButton({ onReset: () => this.onResetHandler() }),
      children: this.rows,
    });
  }

  loadItemsFromConfig(overrides: WindowOverride[]) {
    const children: RemoveItemRow[] = [];
    for (const override of overrides) {
      if (override.mode === "float") {
        const itemrow = new RemoveItemRow({
          title: override.wmTitle ?? override.wmClass,
          subtitle: override.wmClass,
          onRemove: (item: string, parent: Gtk.Widget) => this.onRemoveHandler(item, parent),
        });
        children.push(itemrow);
      }
    }
    return children;
  }

  onRemoveHandler(item: string, parent: Gtk.Widget) {
    this.floatingWindowGroup.remove(parent);
    this.rows = this.rows.filter((row) => row != parent);
    const existing: WindowOverride[] = this.configMgr.windowProps?.overrides ?? [];
    const modified = existing.filter((row) => item != row.wmClass);
    this.saveOverrides(modified);
  }

  saveOverrides(modified: WindowOverride[]) {
    if (modified) {
      this.configMgr.windowProps = {
        overrides: modified,
      };
      const changed = Math.floor(Date.now() / 1000);
      this.settings.set_uint("window-overrides-reload-trigger", changed);
    }
  }

  onResetHandler() {
    const defaultWindowProps = this.configMgr.loadDefaultWindowConfigContents();
    const original = defaultWindowProps.overrides as WindowOverride[];
    this.saveOverrides(original);

    for (const child of this.rows) {
      this.floatingWindowGroup.remove(child);
    }

    this.rows = this.loadItemsFromConfig(original);
    for (const item of this.rows) {
      this.floatingWindowGroup.add(item);
    }
  }
}
