// Gnome imports
import Adw from "gi://Adw";
import Gio from "gi://Gio";
import GObject from "gi://GObject";
import Gdk from "gi://Gdk";
import Gtk from "gi://Gtk";

// Extension imports
import { gettext as _ } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

// Shared state
import { ConfigManager } from "../shared/settings.js";
import { PrefsThemeManager } from "./prefs-theme-manager.js";
import {
  DEFAULT_FOCUSED_SHADOW,
  DEFAULT_UNFOCUSED_SHADOW,
  formatBoxShadow,
  parseBoxShadow,
  type ShadowStyle,
} from "./shadow-style.js";

// Prefs UI
import { ColorRow, PreferencesPage, ResetButton, SpinButtonRow, SwitchRow } from "./widgets.js";
import { Logger } from "../shared/logger.js";

export class AppearancePage extends PreferencesPage {
  static {
    GObject.registerClass(this);
  }

  settings!: Gio.Settings;
  themeMgr!: PrefsThemeManager;

  static getCssSelectorAsMessage(selector: string) {
    switch (selector) {
      // TODO: make separate color selection for preview hint
      case ".window-tiled-border":
        return _("Tiled window");
      case ".window-tabbed-border":
        return _("Tabbed window");
      case ".window-stacked-border":
        return _("Stacked window");
      case ".window-floated-border":
        return _("Floating window");
      case ".window-split-border":
        return _("Split direction hint");
    }
  }

  constructor({ settings, dir }: { settings: Gio.Settings; dir: Gio.File }) {
    super({ title: _("Appearance"), icon_name: "brush-symbolic" });
    this.settings = settings;
    const configMgr = new ConfigManager({ dir });
    this.themeMgr = new PrefsThemeManager({ configMgr: configMgr, settings: settings });
    this.add_group({
      title: _("Gaps"),
      description: _("Change the gap size between windows"),
      children: [
        new SpinButtonRow({
          title: _("Gap size"),
          range: [0, 32, 1],
          settings,
          bind: "window-gap-size",
        }),
        new SpinButtonRow({
          title: _("Gap size multiplier"),
          range: [0, 32, 1],
          settings,
          bind: "window-gap-size-increment",
        }),
        new SwitchRow({
          title: _("Disable gaps for single window"),
          subtitle: _("Disables window gaps when only a single window is present"),
          settings,
          bind: "window-gap-hidden-on-single",
        }),
      ],
    });
    const borderRadiusSelectors = [
      ".window-tiled-border",
      ".window-split-border",
      ".window-stacked-border",
      ".window-tabbed-border",
      ".window-floated-border",
      ".window-tilepreview-tiled",
      ".window-tilepreview-stacked",
      ".window-tilepreview-swap",
      ".window-tilepreview-tabbed",
      ".window-focused-shadow",
      ".window-unfocused-shadow",
    ];

    const currentRadius = parseInt(
      String(
        this.themeMgr.removePx(
          this.themeMgr.getCssProperty(".window-tiled-border", "border-radius")!.value ?? "18px"
        )
      )
    );

    const borderRadiusRow = new SpinButtonRow({
      title: _("Border radius"),
      subtitle: _("Set to 0 for square corners"),
      range: [0, 28, 1],
      init: currentRadius,
      onChange: (value) => {
        const px = this.themeMgr.addPx(String(value));
        for (const selector of borderRadiusSelectors) {
          this.themeMgr.setCssProperty(selector, "border-radius", px);
        }
      },
    });

    borderRadiusRow.add_suffix(
      new ResetButton({
        onReset: () => {
          const defaultRadius = 18;
          const px = this.themeMgr.addPx(String(defaultRadius));
          for (const selector of borderRadiusSelectors) {
            this.themeMgr.setCssProperty(selector, "border-radius", px);
          }
          (borderRadiusRow.activatable_widget! as Gtk.SpinButton).value = defaultRadius;
        },
      })
    );

    this.add_group({
      title: _("Style"),
      description: _("Change how the shell looks"),
      children: [
        new SwitchRow({
          title: _("Preview hint"),
          subtitle: _("Shows where the window will be tiled when you let go of it"),
          experimental: true,
          settings,
          bind: "preview-hint-enabled",
        }),
        new SwitchRow({
          title: _("Border around focused window"),
          subtitle: _("Display a colored border around the focused window"),
          settings,
          bind: "focus-border-toggle",
        }),
        new SwitchRow({
          title: _("Window split hint border"),
          subtitle: _("Show split direction border on focused window"),
          settings,
          bind: "split-border-toggle",
        }),
        new SwitchRow({
          title: _("Anvil in quick settings"),
          subtitle: _("Toggles the Anvil tile in quick settings"),
          experimental: true,
          settings,
          bind: "quick-settings-enabled",
        }),
        borderRadiusRow,
      ],
    });
    this.add_group({
      title: _("Color"),
      description: _("Changes the focused window's border and preview hint colors"),
      children: [
        "window-tiled-border",
        "window-tabbed-border",
        "window-stacked-border",
        "window-floated-border",
        "window-split-border",
      ].map((x) => this._createColorOptionWidget(x)),
    });
    this.add_group({
      title: _("Shadows"),
      description: _("Customize shadows for focused and unfocused windows"),
      children: [
        this._createShadowOptionWidget(
          ".window-focused-shadow",
          _("Focused window"),
          DEFAULT_FOCUSED_SHADOW
        ),
        this._createShadowOptionWidget(
          ".window-unfocused-shadow",
          _("Unfocused window"),
          DEFAULT_UNFOCUSED_SHADOW
        ),
      ],
    });
  }

  _createShadowOptionWidget(
    selector: string,
    title: string,
    defaults: Readonly<ShadowStyle>
  ): Adw.ExpanderRow {
    const theme = this.themeMgr;
    const value = theme.getCssProperty(selector, "box-shadow")?.value ?? "";
    let shadow = parseBoxShadow(value) ?? { ...defaults };
    const row = new Adw.ExpanderRow({ title });
    const update = () => theme.setCssProperty(selector, "box-shadow", formatBoxShadow(shadow));

    const colorRow = new ColorRow({
      title: _("Color and opacity"),
      init: shadow.color,
      onChange: (color) => {
        shadow = { ...shadow, color };
        update();
      },
    });
    colorRow.add_suffix(
      new ResetButton({
        onReset: () => {
          shadow = { ...shadow, color: defaults.color };
          update();
          const rgba = new Gdk.RGBA();
          if (rgba.parse(defaults.color)) colorRow.colorButton.set_rgba(rgba);
        },
      })
    );
    row.add_row(colorRow);

    const addNumberRow = (
      field: "xOffset" | "yOffset" | "blurRadius" | "spreadRadius",
      label: string,
      range: [number, number, number]
    ) => {
      const numberRow = new SpinButtonRow({
        title: label,
        range,
        init: shadow[field],
        onChange: (number) => {
          shadow = { ...shadow, [field]: number };
          update();
        },
      });
      numberRow.add_suffix(
        new ResetButton({
          onReset: () => {
            shadow = { ...shadow, [field]: defaults[field] };
            update();
            (numberRow.activatable_widget! as Gtk.SpinButton).value = defaults[field];
          },
        })
      );
      row.add_row(numberRow);
    };

    addNumberRow("xOffset", _("Horizontal offset"), [-32, 32, 1]);
    addNumberRow("yOffset", _("Vertical offset"), [-32, 32, 1]);
    addNumberRow("blurRadius", _("Blur radius"), [0, 64, 1]);
    addNumberRow("spreadRadius", _("Spread radius"), [-32, 32, 1]);

    return row;
  }

  _createColorOptionWidget(prefix: string) {
    const selector = `.${prefix}`;
    const theme = this.themeMgr;
    const title = AppearancePage.getCssSelectorAsMessage(selector);
    const colorScheme = theme.getColorSchemeBySelector(selector)!;
    const row = new Adw.ExpanderRow({ title });

    const borderSizeRow = new SpinButtonRow({
      title: _("Border size"),
      range: [1, 6, 1],
      init: Number(theme.removePx(theme.getCssProperty(selector, "border-width")!.value ?? "0")),
      onChange: (value) => {
        const px = theme.addPx(String(value));
        Logger.debug(`Setting border width for selector: ${selector} ${px}`);
        theme.setCssProperty(selector, "border-width", px);
      },
    });

    borderSizeRow.add_suffix(
      new ResetButton({
        onReset: () => {
          const borderDefault = String(
            this.themeMgr.defaultPalette[colorScheme as keyof typeof this.themeMgr.defaultPalette][
              "border-width"
            ]
          );
          theme.setCssProperty(selector, "border-width", theme.addPx(borderDefault));
          (borderSizeRow.activatable_widget! as Gtk.SpinButton).value = Number(borderDefault);
        },
      })
    );

    const updateCssColors = (rgbaString: string) => {
      const rgba = new Gdk.RGBA();

      if (rgba.parse(rgbaString)) {
        Logger.debug(`Setting color for selector: ${selector} ${rgbaString}`);
        const previewBorderRgba = rgba.copy();
        const previewBackgroundRgba = rgba.copy();
        const overviewBackgroundRgba = rgba.copy();

        previewBorderRgba.alpha = 0.3;
        previewBackgroundRgba.alpha = 0.2;
        overviewBackgroundRgba.alpha = 0.5;

        // The primary color updates the focus hint:
        theme.setCssProperty(selector, "border-color", rgba.to_string());

        // Only apply below on the tabbed scheme
        if (colorScheme === "tabbed") {
          const tabBorderRgba = rgba.copy();
          const tabActiveBackgroundRgba = rgba.copy();
          tabBorderRgba.alpha = 0.6;
          theme.setCssProperty(
            `.window-${colorScheme}-tab`,
            "border-color",
            tabBorderRgba.to_string()
          );
          theme.setCssProperty(
            `.window-${colorScheme}-tab-active`,
            "background-color",
            tabActiveBackgroundRgba.to_string()
          );
        }
        // And then finally the preview when doing drag/drop tiling:
        theme.setCssProperty(
          `.window-tilepreview-${colorScheme}`,
          "border-color",
          previewBorderRgba.to_string()
        );
        theme.setCssProperty(
          `.window-tilepreview-${colorScheme}`,
          "background-color",
          previewBackgroundRgba.to_string()
        );
      }
    };

    const borderColorRow = new ColorRow({
      title: _("Border color"),
      init: theme.getCssProperty(selector, "border-color")!.value ?? "",
      onChange: updateCssColors,
    });

    borderColorRow.add_suffix(
      new ResetButton({
        onReset: () => {
          const selectorColor = String(
            theme.defaultPalette[colorScheme as keyof typeof theme.defaultPalette].color
          );
          updateCssColors(selectorColor);
          const rgba = new Gdk.RGBA();
          if (rgba.parse(selectorColor)) {
            (borderColorRow as ColorRow).colorButton.set_rgba(rgba);
          }
        },
      })
    );

    row.add_row(borderColorRow);
    row.add_row(borderSizeRow);

    return row;
  }
}
