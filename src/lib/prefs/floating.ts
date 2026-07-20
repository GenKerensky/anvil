// Gtk imports
import Adw from "gi://Adw";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import GObject from "gi://GObject";
import Gtk from "gi://Gtk";

// Gnome imports
import { gettext as _ } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

// Extension imports
import { AddButton, PreferencesPage, RemoveItemRow, ResetButton } from "./widgets.js";
import { ConfigManager, type WindowOverride } from "../shared/settings.js";
import {
  formatWindowPickerRequest,
  parseWindowPickerResult,
  WINDOW_PICKER_REQUEST_KEY,
  WINDOW_PICKER_RESULT_KEY,
} from "../shared/window-picker-protocol.js";

export class FloatingPage extends PreferencesPage {
  static {
    GObject.registerClass(this);
  }

  settings!: Gio.Settings;
  private configMgr!: ConfigManager;
  private rows!: RemoveItemRow[];
  private floatingWindowGroup!: Adw.PreferencesGroup;
  private addWindowButton!: AddButton;
  private pickerResultChangedId = 0;
  private pickerRequestId: string | null = null;

  constructor({ settings, dir }: { settings: Gio.Settings; dir: Gio.File }) {
    super({ title: _("Windows"), icon_name: "focus-windows-symbolic" });

    this.settings = settings;
    this.configMgr = new ConfigManager({ dir });

    const overrides: WindowOverride[] = this.configMgr.windowProps?.overrides ?? [];
    this.rows = this.loadItemsFromConfig(overrides);

    this.addWindowButton = new AddButton({ onAdd: () => this.onAddWindow() });

    const headerActions = new Gtk.Box({
      orientation: Gtk.Orientation.HORIZONTAL,
      spacing: 6,
      valign: Gtk.Align.CENTER,
    });
    headerActions.append(this.addWindowButton);
    headerActions.append(new ResetButton({ onReset: () => this.onResetHandler() }));

    this.floatingWindowGroup = this.add_group({
      title: _("Floating Windows"),
      description: _("Windows that will not be tiled"),
      header_suffix: headerActions,
      children: this.rows,
    });

    this.pickerResultChangedId = this.settings.connect(`changed::${WINDOW_PICKER_RESULT_KEY}`, () =>
      this.onWindowPickerResult()
    );
  }

  loadItemsFromConfig(overrides: WindowOverride[]) {
    const children: RemoveItemRow[] = [];
    for (const override of overrides) {
      if (override.mode === "float") {
        children.push(this.createOverrideRow(override));
      }
    }
    return children;
  }

  private createOverrideRow(override: WindowOverride): RemoveItemRow {
    return new RemoveItemRow({
      title: override.wmTitle ?? override.wmClass,
      subtitle: override.wmClass,
      onRemove: (_item: string, parent: Gtk.Widget) => this.onRemoveHandler(override, parent),
    });
  }

  onRemoveHandler(item: WindowOverride, parent: Gtk.Widget) {
    this.floatingWindowGroup.remove(parent);
    this.rows = this.rows.filter((row) => row != parent);
    const existing: WindowOverride[] = this.configMgr.windowProps?.overrides ?? [];
    const modified = existing.filter((row) => !sameWindowOverride(row, item));
    this.saveOverrides(modified);
  }

  saveOverrides(modified: WindowOverride[]) {
    if (modified) {
      this.configMgr.windowProps = {
        overrides: modified,
      };
      const current = this.settings.get_uint("window-overrides-reload-trigger");
      const changed = current === 0xffffffff ? 0 : current + 1;
      this.settings.set_uint("window-overrides-reload-trigger", changed);
    }
  }

  private onAddWindow(): void {
    if (this.pickerRequestId) {
      const requestId = this.pickerRequestId;
      this.setPickerIdle();
      this.settings.set_string(
        WINDOW_PICKER_REQUEST_KEY,
        formatWindowPickerRequest({ version: 1, id: requestId, action: "cancel" })
      );
      return;
    }

    const requestId = GLib.uuid_string_random();
    this.pickerRequestId = requestId;
    this.addWindowButton.setSelecting(true);
    this.settings.set_string(
      WINDOW_PICKER_REQUEST_KEY,
      formatWindowPickerRequest({ version: 1, id: requestId, action: "pick" })
    );
  }

  private onWindowPickerResult(): void {
    const result = parseWindowPickerResult(this.settings.get_string(WINDOW_PICKER_RESULT_KEY));
    if (!result || result.id !== this.pickerRequestId) return;
    this.setPickerIdle();
    if (result.status !== "selected") return;

    const existing: WindowOverride[] = this.configMgr.windowProps?.overrides ?? [];
    const retained = existing.filter(
      (override) =>
        !(
          override.mode === "tile" &&
          !override.wmTitle &&
          !override.wmId &&
          override.wmClass.toLowerCase() === result.wmClass.toLowerCase()
        )
    );
    const duplicate = retained.some(
      (override) =>
        override.mode === "float" &&
        !override.wmTitle &&
        !override.wmId &&
        override.wmClass.toLowerCase() === result.wmClass.toLowerCase()
    );
    if (duplicate) {
      if (retained.length !== existing.length) this.saveOverrides(retained);
      return;
    }

    const override: WindowOverride = { wmClass: result.wmClass, mode: "float" };
    this.saveOverrides([...retained, override]);
    const row = this.createOverrideRow(override);
    this.rows.push(row);
    this.floatingWindowGroup.add(row);
  }

  private setPickerIdle(): void {
    this.pickerRequestId = null;
    this.addWindowButton.setSelecting(false);
  }

  onResetHandler() {
    const defaultWindowProps = this.configMgr.loadDefaultWindowConfigContents();
    if (!defaultWindowProps) return;

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

  override vfunc_dispose(): void {
    if (this.pickerRequestId) {
      this.settings.set_string(
        WINDOW_PICKER_REQUEST_KEY,
        formatWindowPickerRequest({ version: 1, id: this.pickerRequestId, action: "cancel" })
      );
      this.pickerRequestId = null;
    }
    if (this.pickerResultChangedId) {
      this.settings.disconnect(this.pickerResultChangedId);
      this.pickerResultChangedId = 0;
    }
    super.vfunc_dispose();
  }
}

function sameWindowOverride(left: WindowOverride, right: WindowOverride): boolean {
  return (
    left.wmClass === right.wmClass &&
    left.wmTitle === right.wmTitle &&
    left.wmId === right.wmId &&
    left.mode === right.mode
  );
}
