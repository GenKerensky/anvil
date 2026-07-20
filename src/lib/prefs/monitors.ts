import Adw from "gi://Adw";
import Gio from "gi://Gio";
import Gdk from "gi://Gdk";
import Gtk from "gi://Gtk";
import GObject from "gi://GObject";
import GLib from "gi://GLib";
import Cairo from "gi://cairo";

import { gettext as _ } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

type MonitorConstraintTuple = [
  connector: string,
  maxWidth: number,
  maxHeight: number,
  enabled: boolean,
  resizeExempt: boolean
];

export interface MonitorInfo {
  connector: string;
  label: string;
  geometry: { x: number; y: number; width: number; height: number };
  isPrimary: boolean;
}

export interface MonitorPreview {
  connector: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

type MonitorSpec = [connector: string, vendor: string, product: string, serial: string];

type LogicalMonitorState = [
  x: number,
  y: number,
  scale: number,
  transform: number,
  primary: boolean,
  monitors: MonitorSpec[],
  properties: Record<string, unknown>
];

type DisplayConfigState = [
  serial: number,
  monitors: unknown[],
  logicalMonitors: LogicalMonitorState[],
  properties: Record<string, unknown>
];

const DISPLAY_CONFIG_BUS_NAME = "org.gnome.Mutter.DisplayConfig";
const DISPLAY_CONFIG_OBJECT_PATH = "/org/gnome/Mutter/DisplayConfig";
const MONITOR_PADDING = 20;
const MONITOR_CORNER_RADIUS = 8;

export function calculateMonitorLayout(
  monitors: MonitorInfo[],
  widgetWidth: number,
  widgetHeight: number
): MonitorPreview[] {
  if (monitors.length === 0) return [];

  const minX = Math.min(...monitors.map((monitor) => monitor.geometry.x));
  const minY = Math.min(...monitors.map((monitor) => monitor.geometry.y));
  const maxX = Math.max(...monitors.map((monitor) => monitor.geometry.x + monitor.geometry.width));
  const maxY = Math.max(...monitors.map((monitor) => monitor.geometry.y + monitor.geometry.height));
  const contentWidth = maxX - minX || 1;
  const contentHeight = maxY - minY || 1;
  const availableWidth = Math.max(widgetWidth - MONITOR_PADDING * 2, 0);
  const availableHeight = Math.max(widgetHeight - MONITOR_PADDING * 2, 0);
  const scale = Math.max(
    0,
    Math.min(availableWidth / contentWidth, availableHeight / contentHeight, 1)
  );
  const renderedWidth = contentWidth * scale;
  const renderedHeight = contentHeight * scale;
  const originX = (widgetWidth - renderedWidth) / 2;
  const originY = (widgetHeight - renderedHeight) / 2;

  return monitors.map((monitor) => ({
    connector: monitor.connector,
    x: originX + (monitor.geometry.x - minX) * scale,
    y: originY + (monitor.geometry.y - minY) * scale,
    width: monitor.geometry.width * scale,
    height: monitor.geometry.height * scale,
  }));
}

export class MonitorsPage extends Adw.PreferencesPage {
  static {
    GObject.registerClass(this);
  }

  private _settings: Gio.Settings;
  private _drawingArea!: Gtk.DrawingArea;
  private _monitors: MonitorInfo[] = [];
  private _selectedConnector: string | null = null;
  private _monitorGroup!: Adw.PreferencesGroup;
  private _enableSwitch!: Gtk.Switch;
  private _maxWidthSpin!: Gtk.SpinButton;
  private _maxHeightSpin!: Gtk.SpinButton;
  private _exemptSwitch!: Gtk.Switch;
  private _boundConnector: string | null = null;
  private _settingsChangedId: number = 0;
  private _updating: boolean = false;

  constructor({ settings }: { settings: Gio.Settings }) {
    super({ title: _("Monitors"), icon_name: "video-display-symbolic" });

    this._settings = settings;
    this._monitors = this._queryMonitors(this._queryPrimaryConnector());

    this._buildUi();

    const initialMonitor = this._monitors.find((monitor) => monitor.isPrimary) ?? this._monitors[0];
    if (initialMonitor) this._selectMonitor(initialMonitor.connector);
  }

  private _queryPrimaryConnector(): string | null {
    // GDK4 exposes output geometry but not primary-output state; Mutter's
    // current logical-monitor configuration is the authoritative source.
    try {
      const response = Gio.DBus.session.call_sync(
        DISPLAY_CONFIG_BUS_NAME,
        DISPLAY_CONFIG_OBJECT_PATH,
        DISPLAY_CONFIG_BUS_NAME,
        "GetCurrentState",
        null,
        null,
        Gio.DBusCallFlags.NONE,
        1000,
        null
      );
      const state = response.deep_unpack() as unknown as DisplayConfigState;
      const primaryLogicalMonitor = state[2].find((logicalMonitor) => logicalMonitor[4]);
      return primaryLogicalMonitor?.[5]?.[0]?.[0] ?? null;
    } catch {
      return null;
    }
  }

  private _queryMonitors(primaryConnector: string | null): MonitorInfo[] {
    const display = Gdk.Display.get_default();
    if (!display) return [];
    const result: MonitorInfo[] = [];
    const gdkMonitors = display.get_monitors();
    for (let i = 0; i < gdkMonitors.get_n_items(); i++) {
      const mon = gdkMonitors.get_item(i) as Gdk.Monitor | null;
      if (!mon) continue;
      const geo = mon.geometry;
      const connector = mon.connector ?? `Monitor ${i}`;
      const label =
        mon.description ||
        (mon.manufacturer && mon.model ? `${mon.manufacturer} ${mon.model}` : mon.connector) ||
        connector;
      result.push({
        connector,
        label,
        geometry: { x: geo.x, y: geo.y, width: geo.width, height: geo.height },
        isPrimary: connector === primaryConnector,
      });
    }
    if (result.length > 0 && !result.some((monitor) => monitor.isPrimary)) {
      result[0].isPrimary = true;
    }
    return result;
  }

  private _readConstraints(): MonitorConstraintTuple[] {
    const val = this._settings.get_value("monitor-constraints");
    return val.deep_unpack() as MonitorConstraintTuple[];
  }

  private _writeConstraints(constraints: MonitorConstraintTuple[]): void {
    const variant = new GLib.Variant("a(suubb)", constraints);
    this._settings.set_value("monitor-constraints", variant);
  }

  private _getConstraint(connector: string): MonitorConstraintTuple | undefined {
    return this._readConstraints().find((c) => c[0] === connector);
  }

  private _setConstraintField(
    connector: string,
    fieldIndex: number,
    value: string | number | boolean
  ): void {
    const constraints = this._readConstraints();
    let found = false;
    for (const c of constraints) {
      if (c[0] === connector) {
        (c as unknown[])[fieldIndex] = value;
        found = true;
        break;
      }
    }
    if (!found) {
      const entry: MonitorConstraintTuple = [connector, 0, 0, true, false];
      (entry as unknown[])[fieldIndex] = value;
      constraints.push(entry);
    }
    this._writeConstraints(constraints);
  }

  private _buildUi(): void {
    // Drawing area for visual monitor layout
    this._drawingArea = new Gtk.DrawingArea({
      hexpand: true,
      height_request: 200,
      margin_bottom: 8,
    });

    this._drawingArea.set_draw_func(
      (_da: Gtk.DrawingArea, cr: Cairo.Context, w: number, h: number) => {
        this._drawMonitors(cr, w, h);
      }
    );

    const clickController = new Gtk.GestureClick();
    clickController.connect(
      "pressed",
      (_ctrl: Gtk.GestureClick, _nPress: number, x: number, y: number) => {
        this._handleClick(x, y);
      }
    );
    this._drawingArea.add_controller(clickController);

    // Wrap drawing area in a preferences group
    const visualGroup = new Adw.PreferencesGroup();
    const visualBox = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL });
    visualBox.append(this._drawingArea);
    visualGroup.add(visualBox);
    this.add(visualGroup);

    // Per-monitor controls
    this._monitorGroup = new Adw.PreferencesGroup({
      title: _("Select a monitor to configure"),
    });

    this._enableSwitch = new Gtk.Switch({ valign: Gtk.Align.CENTER });
    const enableRow = new Adw.ActionRow({
      title: _("Enable size constraints"),
      subtitle: _("New feature — may not have predictable behavior"),
      activatable_widget: this._enableSwitch,
    });
    const warningIcon = new Gtk.Image({ icon_name: "dialog-warning-symbolic" });
    warningIcon.set_tooltip_markup(
      _("<b>CAUTION</b>: This is a new feature and may not have predictable behavior")
    );
    enableRow.add_suffix(warningIcon);
    enableRow.add_suffix(this._enableSwitch);

    this._maxWidthSpin = Gtk.SpinButton.new_with_range(0, 10000, 10);
    this._maxWidthSpin.xalign = 1;
    const maxWidthRow = new Adw.ActionRow({
      title: _("Max width"),
      subtitle: _("0 = no limit"),
      activatable_widget: this._maxWidthSpin,
    });
    maxWidthRow.add_suffix(this._maxWidthSpin);

    this._maxHeightSpin = Gtk.SpinButton.new_with_range(0, 10000, 10);
    this._maxHeightSpin.xalign = 1;
    const maxHeightRow = new Adw.ActionRow({
      title: _("Max height"),
      subtitle: _("0 = no limit"),
      activatable_widget: this._maxHeightSpin,
    });
    maxHeightRow.add_suffix(this._maxHeightSpin);

    this._exemptSwitch = new Gtk.Switch({ valign: Gtk.Align.CENTER });
    const exemptRow = new Adw.ActionRow({
      title: _("Resize exemption"),
      subtitle: _("Let manually resized windows exceed the size limits"),
      activatable_widget: this._exemptSwitch,
    });
    exemptRow.add_suffix(this._exemptSwitch);

    this._monitorGroup.add(enableRow);
    this._monitorGroup.add(maxWidthRow);
    this._monitorGroup.add(maxHeightRow);
    this._monitorGroup.add(exemptRow);

    this.add(this._monitorGroup);

    // Wire up control changes
    this._enableSwitch.connect("notify::active", () => {
      if (this._updating || !this._boundConnector) return;
      this._setConstraintField(this._boundConnector, 3, this._enableSwitch.active);
    });

    this._maxWidthSpin.connect("value-changed", () => {
      if (this._updating || !this._boundConnector) return;
      this._setConstraintField(this._boundConnector, 1, this._maxWidthSpin.value);
    });

    this._maxHeightSpin.connect("value-changed", () => {
      if (this._updating || !this._boundConnector) return;
      this._setConstraintField(this._boundConnector, 2, this._maxHeightSpin.value);
    });

    this._exemptSwitch.connect("notify::active", () => {
      if (this._updating || !this._boundConnector) return;
      this._setConstraintField(this._boundConnector, 4, this._exemptSwitch.active);
    });

    // Listen for external changes to monitor-constraints
    this._settingsChangedId = this._settings.connect("changed::monitor-constraints", () => {
      this._refreshControls();
      this._drawingArea.queue_draw();
    });
  }

  override vfunc_dispose(): void {
    if (this._settingsChangedId !== 0) {
      this._settings.disconnect(this._settingsChangedId);
      this._settingsChangedId = 0;
    }
    super.vfunc_dispose();
  }

  private _drawMonitors(cr: Cairo.Context, widgetWidth: number, widgetHeight: number): void {
    if (this._monitors.length === 0) return;

    const crAny = cr as unknown as CairoContext;
    const previews = calculateMonitorLayout(this._monitors, widgetWidth, widgetHeight);

    let accentR = 0.2;
    let accentG = 0.4;
    let accentB = 0.8;
    try {
      const styleMgr = Adw.StyleManager.get_default();
      const accentRgba = styleMgr.accent_color_rgba;
      accentR = accentRgba.red;
      accentG = accentRgba.green;
      accentB = accentRgba.blue;
    } catch {
      // fallback to default blue
    }

    crAny.setFontSize(12);
    crAny.selectFontFace("sans-serif", Cairo.FontSlant.NORMAL, Cairo.FontWeight.NORMAL);

    for (const m of this._monitors) {
      const preview = previews.find((candidate) => candidate.connector === m.connector);
      if (!preview) continue;
      const { x: rx, y: ry, width: rw, height: rh } = preview;
      if (rw <= 0 || rh <= 0) continue;
      const radius = Math.min(MONITOR_CORNER_RADIUS, rw / 2, rh / 2);

      const isSelected = m.connector === this._selectedConnector;

      if (isSelected) {
        crAny.setSourceRGBA(accentR, accentG, accentB, 0.15);
      } else {
        crAny.setSourceRGBA(0.5, 0.5, 0.5, 0.1);
      }
      this._roundedRectangle(crAny, rx, ry, rw, rh, radius);
      crAny.fill();

      if (m.isPrimary) {
        crAny.save();
        this._roundedRectangle(crAny, rx, ry, rw, rh, radius);
        crAny.clip();
        crAny.setSourceRGBA(0, 0, 0, 1);
        crAny.rectangle(rx, ry, rw, Math.min(12, Math.max(6, rh * 0.1)));
        crAny.fill();
        crAny.restore();
      }

      if (isSelected) {
        crAny.setSourceRGBA(accentR, accentG, accentB, 0.8);
        crAny.setLineWidth(2.5);
      } else {
        crAny.setSourceRGBA(0.5, 0.5, 0.5, 0.5);
        crAny.setLineWidth(1);
      }
      this._roundedRectangle(crAny, rx, ry, rw, rh, radius);
      crAny.stroke();

      crAny.setSourceRGBA(0.9, 0.9, 0.9, 1);
      const extents = crAny.textExtents(m.label);
      const labelX = rx + (rw - extents.width) / 2;
      const labelY = ry + rh / 2 + extents.height / 2;
      crAny.moveTo(labelX, labelY);
      crAny.showText(m.label);
    }
  }

  private _handleClick(x: number, y: number): void {
    if (this._monitors.length === 0) return;

    const previews = calculateMonitorLayout(
      this._monitors,
      this._drawingArea.get_width(),
      this._drawingArea.get_height()
    );

    for (const preview of previews) {
      if (
        x >= preview.x &&
        x <= preview.x + preview.width &&
        y >= preview.y &&
        y <= preview.y + preview.height
      ) {
        this._selectMonitor(preview.connector);
        return;
      }
    }
  }

  private _roundedRectangle(
    cr: CairoContext,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number
  ): void {
    cr.newSubPath();
    cr.arc(x + width - radius, y + radius, radius, -Math.PI / 2, 0);
    cr.arc(x + width - radius, y + height - radius, radius, 0, Math.PI / 2);
    cr.arc(x + radius, y + height - radius, radius, Math.PI / 2, Math.PI);
    cr.arc(x + radius, y + radius, radius, Math.PI, (Math.PI * 3) / 2);
    cr.closePath();
  }

  private _selectMonitor(connector: string): void {
    this._selectedConnector = connector;
    this._boundConnector = connector;

    const monitor = this._monitors.find((m) => m.connector === connector);
    if (monitor) {
      this._monitorGroup.title = `${_("Monitor:")} ${monitor.label} (${connector})`;
    }

    this._refreshControls();
    this._drawingArea.queue_draw();
  }

  private _refreshControls(): void {
    const constraint = this._boundConnector ? this._getConstraint(this._boundConnector) : undefined;

    this._updating = true;

    if (constraint) {
      this._enableSwitch.active = constraint[3];
      this._maxWidthSpin.value = constraint[1];
      this._maxHeightSpin.value = constraint[2];
      this._exemptSwitch.active = constraint[4];
    } else {
      this._enableSwitch.active = false;
      this._maxWidthSpin.value = 0;
      this._maxHeightSpin.value = 0;
      this._exemptSwitch.active = false;
    }

    this._updating = false;
  }
}

interface CairoContext {
  setSourceRGBA(r: number, g: number, b: number, a: number): void;
  newSubPath(): void;
  arc(x: number, y: number, radius: number, angle1: number, angle2: number): void;
  closePath(): void;
  save(): void;
  restore(): void;
  clip(): void;
  rectangle(x: number, y: number, w: number, h: number): void;
  fill(): void;
  stroke(): void;
  setLineWidth(w: number): void;
  moveTo(x: number, y: number): void;
  showText(text: string): void;
  textExtents(text: string): {
    x: number;
    y: number;
    width: number;
    height: number;
    xAdvance: number;
    yAdvance: number;
  };
  setFontSize(size: number): void;
  selectFontFace(family: string, slant: number, weight: number): void;
}
