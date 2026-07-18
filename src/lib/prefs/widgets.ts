/** @license (c) aylur. GPL v3 */

import Adw from "gi://Adw";
import Gio from "gi://Gio";
import Gdk from "gi://Gdk";
import Gtk from "gi://Gtk";
import GObject from "gi://GObject";
import Cairo from "gi://cairo";

// GNOME imports
import { gettext as _ } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

// Shared state
import { Logger } from "../shared/logger.js";

interface GroupOptions {
  title: string;
  description?: string;
  children: Gtk.Widget[];
  header_suffix?: Gtk.Widget;
}

export class PreferencesPage extends Adw.PreferencesPage {
  static {
    GObject.registerClass(this);
  }

  add_group({
    title,
    description = "",
    children,
    header_suffix,
  }: GroupOptions): Adw.PreferencesGroup {
    const group = new Adw.PreferencesGroup({ title, description });
    for (const child of children) group.add(child);
    if (header_suffix) group.set_header_suffix(header_suffix);
    this.add(group);
    return group;
  }
}

interface SwitchRowOptions {
  title: string;
  settings: Gio.Settings;
  bind: string;
  subtitle?: string;
  experimental?: boolean;
}

export class SwitchRow extends Adw.ActionRow {
  static {
    GObject.registerClass(this);
  }

  constructor({ title, settings, bind, subtitle = "", experimental = false }: SwitchRowOptions) {
    super({ title, subtitle });
    const gswitch = new Gtk.Switch({
      active: settings.get_boolean(bind),
      valign: Gtk.Align.CENTER,
    });
    settings.bind(bind, gswitch, "active", Gio.SettingsBindFlags.DEFAULT);
    if (experimental) {
      const icon = new Gtk.Image({ icon_name: "bug-symbolic" });
      icon.set_tooltip_markup(
        _("<b>CAUTION</b>: Enabling this setting can lead to bugs or cause the shell to crash")
      );
      this.add_suffix(icon);
    }
    this.add_suffix(gswitch);
    this.activatable_widget = gswitch;
  }
}

interface ColorRowOptions {
  title: string;
  init: string;
  onChange: (color: string) => void;
  subtitle?: string;
}

interface LiveColorButtonOptions {
  rgba: Gdk.RGBA;
  title: string;
  onChange: (color: string) => void;
}

/**
 * Gtk.ColorDialog only publishes the accepted result. Keep ownership of the
 * chooser so previews can follow its RGBA property while the editor is open.
 */
class LiveColorButton extends Gtk.Button {
  static {
    GObject.registerClass(this);
  }

  private _rgba: Gdk.RGBA;
  private _dialog: Gtk.ColorChooserDialog | null = null;
  private readonly _preview: Gtk.DrawingArea;
  private readonly _title: string;
  private readonly _onChange: (color: string) => void;

  constructor({ rgba, title, onChange }: LiveColorButtonOptions) {
    const preview = new Gtk.DrawingArea({ content_width: 40, content_height: 22 });
    super({
      child: preview,
      css_classes: ["color"],
      tooltip_text: title,
      valign: Gtk.Align.CENTER,
    });

    this._preview = preview;
    this._rgba = rgba.copy();
    this._title = title;
    this._onChange = onChange;
    this._preview.set_draw_func(
      (_area: Gtk.DrawingArea, cr: Cairo.Context, width: number, height: number) =>
        this._drawPreview(cr, width, height)
    );
    this.connect("clicked", () => this._openDialog());
  }

  get_rgba(): Gdk.RGBA {
    return this._rgba.copy();
  }

  set_rgba(rgba: Gdk.RGBA): void {
    this._rgba = rgba.copy();
    this._preview.queue_draw();
  }

  private _openDialog(): void {
    if (this._dialog) {
      this._dialog.present();
      return;
    }

    const root = this.get_root();
    const parent = root instanceof Gtk.Window ? root : null;
    const initialColor = this._rgba.copy();
    let previewChanged = false;
    const dialog = Gtk.ColorChooserDialog.new(this._title, parent) as Gtk.ColorChooserDialog;
    dialog.modal = true;
    dialog.show_editor = true;
    dialog.use_alpha = true;
    dialog.set_rgba(initialColor);
    dialog.connect("notify::rgba", () => {
      previewChanged = true;
      this.set_rgba(dialog.get_rgba());
      this._onChange(this._rgba.to_string());
    });
    dialog.connect("response", (_dialog, response) => {
      if (response !== Gtk.ResponseType.OK && previewChanged) {
        this.set_rgba(initialColor);
        this._onChange(initialColor.to_string());
      }
      dialog.destroy();
    });
    dialog.connect("destroy", () => {
      if (this._dialog === dialog) this._dialog = null;
    });
    this._dialog = dialog;
    dialog.present();
  }

  private _drawPreview(cr: Cairo.Context, width: number, height: number): void {
    const context = cr as unknown as ColorPreviewContext;
    const checkerSize = 5;
    for (let y = 0; y < height; y += checkerSize) {
      for (let x = 0; x < width; x += checkerSize) {
        const shade = (x / checkerSize + y / checkerSize) % 2 === 0 ? 0.75 : 0.45;
        context.setSourceRGBA(shade, shade, shade, 1);
        context.rectangle(x, y, checkerSize, checkerSize);
        context.fill();
      }
    }
    context.setSourceRGBA(this._rgba.red, this._rgba.green, this._rgba.blue, this._rgba.alpha);
    context.rectangle(0, 0, width, height);
    context.fill();
  }
}

export class ColorRow extends Adw.ActionRow {
  static {
    GObject.registerClass(this);
  }

  colorButton!: LiveColorButton;

  constructor({ title, init, onChange, subtitle = "" }: ColorRowOptions) {
    super({ title, subtitle });
    const rgba = new Gdk.RGBA();
    rgba.parse(init);
    this.colorButton = new LiveColorButton({ rgba, title, onChange });
    this.add_suffix(this.colorButton);
    this.activatable_widget = this.colorButton;
  }
}

interface ColorPreviewContext {
  setSourceRGBA(red: number, green: number, blue: number, alpha: number): void;
  rectangle(x: number, y: number, width: number, height: number): void;
  fill(): void;
}

interface SpinButtonRowOptions {
  title: string;
  range: [number, number, number];
  subtitle?: string;
  init?: number;
  onChange?: (value: number) => void;
  settings?: Gio.Settings;
  bind?: string;
}

export class SpinButtonRow extends Adw.ActionRow {
  static {
    GObject.registerClass(this);
  }

  constructor({
    title,
    range: [low, high, step],
    subtitle = "",
    init = undefined,
    onChange = undefined,
    settings = undefined,
    bind = undefined,
  }: SpinButtonRowOptions) {
    super({ title, subtitle });
    const gspin = Gtk.SpinButton.new_with_range(low, high, step);
    gspin.xalign = 1;
    if (bind && settings) {
      settings.bind(bind, gspin, "value", Gio.SettingsBindFlags.DEFAULT);
    } else if (init !== undefined) {
      gspin.value = init;
      gspin.connect("value-changed", (widget) => {
        if (onChange) onChange(widget.value);
      });
    }
    this.add_suffix(gspin);
    this.set_css_classes(["spin"]);
    this.activatable_widget = gspin;
  }
}

interface DropDownRowOptions {
  title: string;
  settings: Gio.Settings;
  bind: string;
  items: { name: string; id: string | number }[];
  subtitle?: string;
  type?: string;
}

export class DropDownRow extends Adw.ActionRow {
  static {
    GObject.registerClass(this);
  }

  settings!: Gio.Settings;

  /** Name of the gsetting key to bind to */
  bind: string;

  /** GVariant type string (e.g. 's' for string, 'u' for uint) */
  type: string;

  selected = 0;

  items: { name: string; id: string | number }[];

  model = new Gtk.StringList();

  dropdown?: Gtk.DropDown;

  constructor({ title, settings, bind, items, subtitle = "", type }: DropDownRowOptions) {
    super({ title, subtitle });
    this.settings = settings;
    this.items = items;
    this.bind = bind;
    this.type = type ?? this.settings.get_value(bind)?.get_type_string() ?? "?";
    this.#build();
    if (this.dropdown) this.add_suffix(this.dropdown);
    this.add_suffix(new ResetButton({ settings, bind, onReset: () => this.reset() }));
  }

  reset() {
    if (this.dropdown) this.dropdown.selected = 0;
    this.selected = 0;
  }

  #build() {
    for (const { name, id } of this.items) {
      this.model.append(name);
      if (this.#get() === id) this.selected = this.items.findIndex((x) => x.id === id);
    }
    const { model, selected } = this;
    this.dropdown = new Gtk.DropDown({ valign: Gtk.Align.CENTER, model, selected });
    this.dropdown.connect("notify::selected", () => this.#onSelected());
    this.activatable_widget = this.dropdown;
  }

  #onSelected() {
    this.selected = this.dropdown?.selected ?? 0;
    const { id } = this.items[this.selected];
    Logger.debug("setting", id, this.selected);
    this.#set(this.bind, id);
  }

  static #settingsTypes: Record<string, string> = {
    b: "boolean",
    y: "byte",
    n: "int16",
    q: "uint16",
    i: "int32",
    u: "uint",
    x: "int64",
    t: "uint64",
    d: "double",
    s: "string",
    o: "objv",
  };

  #get(x: string = this.bind) {
    const methodName = `get_${DropDownRow.#settingsTypes[this.type] ?? "value"}`;
    return (this.settings as unknown as Record<string, (x: string) => unknown>)[methodName]?.(x);
  }

  #set(x: string, y: unknown) {
    const methodName = `set_${DropDownRow.#settingsTypes[this.type] ?? "value"}`;
    Logger.log(`${methodName}(${x}, ${y})`);
    return (this.settings as unknown as Record<string, (x: string, y: unknown) => unknown>)[
      methodName
    ]?.(x, y);
  }
}

interface ClearButtonOptions {
  onClear: () => void;
}

export class ClearButton extends Gtk.Button {
  static {
    GObject.registerClass(this);
  }

  constructor({ onClear }: ClearButtonOptions) {
    super({
      icon_name: "edit-clear-symbolic",
      tooltip_text: _("Clear shortcut"),
      css_classes: ["flat", "circular"],
      valign: Gtk.Align.CENTER,
    });
    this.connect("clicked", () => {
      onClear();
    });
  }
}

interface ResetButtonOptions {
  settings?: Gio.Settings;
  bind?: string;
  onReset: () => void;
}

export class ResetButton extends Gtk.Button {
  static {
    GObject.registerClass(this);
  }

  constructor({ settings, bind, onReset }: ResetButtonOptions) {
    super({
      icon_name: "edit-undo-symbolic",
      tooltip_text: _("Reset to default"),
      css_classes: ["flat", "circular"],
      valign: Gtk.Align.CENTER,
    });
    this.connect("clicked", () => {
      if (bind !== undefined) settings?.reset(bind);
      onReset();
    });
  }
}

interface RemoveButtonOptions {
  item: string;
  parent: Gtk.Widget;
  onRemove: (item: string, parent: Gtk.Widget) => void;
}

export class RemoveButton extends Gtk.Button {
  static {
    GObject.registerClass(this);
  }

  constructor({ item, parent, onRemove }: RemoveButtonOptions) {
    super({
      icon_name: "edit-delete-symbolic",
      tooltip_text: _("Remove Item"),
      css_classes: ["flat", "circular"],
      valign: Gtk.Align.CENTER,
    });
    this.connect("clicked", () => {
      onRemove(item, parent);
    });
  }
}

interface EntryRowOptions {
  title: string;
  settings: Gio.Settings;
  bind: string;
  map?: {
    to: (s: Gio.Settings, b: string, t: string) => void;
    from: (s: Gio.Settings, b: string) => string;
  };
}

export class EntryRow extends Adw.EntryRow {
  static {
    GObject.registerClass(this);
  }

  constructor({ title, settings, bind, map }: EntryRowOptions) {
    super({ title });
    this.connect("changed", () => {
      const text = this.get_text();
      if (typeof text === "string")
        if (map) {
          map.to(settings, bind, text);
        } else {
          settings.set_string(bind, text);
        }
    });
    const current = map ? map.from(settings, bind) : settings.get_string(bind);
    this.set_text(current ?? "");
    this.add_suffix(
      new ClearButton({
        onClear: () => {
          this.set_text("");
        },
      })
    );
    this.add_suffix(
      new ResetButton({
        settings,
        bind,
        onReset: () => {
          this.set_text((map ? map.from(settings, bind) : settings.get_string(bind)) ?? "");
        },
      })
    );
  }
}

interface RadioRowOptions {
  title: string;
  subtitle?: string;
  settings: Gio.Settings;
  bind: string;
  options: Record<string, string>;
}

export class RadioRow extends Adw.ActionRow {
  static {
    GObject.registerClass(this);
  }

  static orientation = Gtk.Orientation.HORIZONTAL;

  static spacing = 3;

  static valign = Gtk.Align.CENTER;

  constructor({ title, subtitle = "", settings, bind, options }: RadioRowOptions) {
    super({ title, subtitle });
    const current = settings.get_string(bind);
    const labels = Object.fromEntries(Object.entries(options).map(([k, v]) => [v, k]));
    const { orientation, spacing, valign } = RadioRow;
    const hbox = new Gtk.Box({ orientation, spacing, valign });
    let group: Gtk.ToggleButton | undefined;
    for (const [key, label] of Object.entries(options)) {
      const toggle = new Gtk.ToggleButton({ label, ...(group && { group }) });
      group ||= toggle;
      toggle.active = key === current;
      toggle.set_css_classes(["flat"]);
      toggle.connect("clicked", () => {
        if (toggle.active) {
          settings.set_string(bind, labels[toggle.label || ""]);
        }
      });
      hbox.append(toggle);
    }
    this.add_suffix(hbox);
  }
}

interface RemoveItemRowOptions {
  title: string;
  subtitle?: string;
  onRemove?: (item: string, parent: Gtk.Widget) => void;
}

export class RemoveItemRow extends Adw.ActionRow {
  static {
    GObject.registerClass(this);
  }

  constructor({ title, subtitle = "", onRemove }: RemoveItemRowOptions) {
    super({ title, subtitle });
    const rmbutton = new RemoveButton({
      item: subtitle,
      parent: this,
      onRemove: onRemove ?? (() => {}),
    });

    this.add_suffix(rmbutton);
  }
}
