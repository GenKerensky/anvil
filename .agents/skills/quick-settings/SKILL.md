---
name: quick-settings
description: Add indicators, toggles, sliders, and action buttons to the GNOME Shell Quick Settings panel
license: MIT
compatibility: agents
---

# Quick Settings

Guide for adding indicators, toggles, sliders, and action buttons to the GNOME Shell
Quick Settings panel (the system menu). This is the modern replacement for
individual panel buttons.

## Imports

```ts
import Gio from "gi://Gio";
import St from "gi://St";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";
import * as QuickSettings from "resource:///org/gnome/shell/ui/quickSettings.js";
import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";
```

## SystemIndicator

Every extension using quick settings should create a `SystemIndicator` subclass.
It manages the list of quick settings items and can optionally display an icon.

```ts
const MyIndicator = GObject.registerClass(
  class MyIndicator extends QuickSettings.SystemIndicator {
    _indicator: St.Icon;

    constructor(extension: AnvilExtension) {
      super();

      // Create an icon (optional — skip if you only want items, no icon)
      this._indicator = this._addIndicator();
      this._indicator.icon_name = "selection-mode-symbolic";

      // Show/hide based on a setting
      extension.settings.bind(
        "feature-enabled",
        this._indicator,
        "visible",
        Gio.SettingsBindFlags.DEFAULT
      );

      // Add items to the quick settings grid
      this.quickSettingsItems.push(new MyToggle(extension));
      this.quickSettingsItems.push(new MyMenuToggle(extension));
    }

    destroy() {
      this.quickSettingsItems.forEach((item) => item.destroy());
      super.destroy();
    }
  }
);
```

### Registration

Add to the quick settings panel from `enable()`:

```ts
enable() {
    this._indicator = new MyIndicator(this);
    Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator);
}

disable() {
    this._indicator?.destroy();
    this._indicator = null;
}
```

## QuickToggle

The most basic item — a simple toggle button with icon, title, and subtitle.

```ts
const MyToggle = GObject.registerClass(
  class MyToggle extends QuickSettings.QuickToggle {
    constructor(extension: AnvilExtension) {
      super({
        title: _("My Feature"),
        subtitle: _("Enable or disable my feature"),
        iconName: "selection-mode-symbolic",
        toggleMode: true,
      });

      // Bind to GSettings — checked state tracks the setting
      extension.settings.bind("feature-enabled", this, "checked", Gio.SettingsBindFlags.DEFAULT);
    }
  }
);
```

## QuickMenuToggle

A toggle with an attached popup menu. Use this when the feature has additional
settings or actions.

```ts
const MyMenuToggle = GObject.registerClass(
  class MyMenuToggle extends QuickSettings.QuickMenuToggle {
    constructor(extension: AnvilExtension) {
      super({
        title: _("My Feature"),
        subtitle: _("With extra options"),
        iconName: "selection-mode-symbolic",
        toggleMode: true,
      });

      // Bind the main toggle
      extension.settings.bind("feature-enabled", this, "checked", Gio.SettingsBindFlags.DEFAULT);

      // Set a header with icon, title, and optional subtitle
      this.menu.setHeader("selection-mode-symbolic", _("My Feature"), _("Optional Subtitle"));

      // Add a suffix to the header (e.g. warning icon)
      const suffix = new St.Icon({ iconName: "dialog-warning-symbolic" });
      this.menu.addHeaderSuffix(suffix);

      // Add a section of menu items
      const section = new PopupMenu.PopupMenuSection();
      section.addAction(_("Option 1"), () => log("activated"));
      section.addAction(_("Option 2"), () => log("activated"));
      this.menu.addMenuItem(section);

      // Add a settings entry (with lock screen gating)
      this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
      const settingsItem = this.menu.addAction(_("Settings"), () => extension.openPreferences());
      settingsItem.visible = Main.sessionMode.allowSettings;
      (this.menu as any)._settingsActions[extension.uuid] = settingsItem;
    }
  }
);
```

## QuickSlider

A slider (like brightness or volume). Usually spans two columns.

```ts
const MySlider = GObject.registerClass(
  class MySlider extends QuickSettings.QuickSlider {
    constructor(extension: AnvilExtension) {
      super({
        iconName: "selection-mode-symbolic",
        iconLabel: _("Accessible name for the icon"),
      });

      // Make the icon clickable (e.g. for mute/unmute)
      this.iconReactive = true;
      this.connect("icon-clicked", () => log("Slider icon clicked!"));

      // Watch slider value changes
      this.slider.accessible_name = _("My Slider");
      this._sliderChangedId = this.slider.connect("notify::value", () => this._onSliderChanged());
    }

    _onSliderChanged() {
      const percent = Math.floor(this.slider.value * 100);
      extension.settings.set_uint("slider-value", percent);
    }
  }
);
```

Add to the indicator spanning 2 columns (parameter 2):

```ts
Main.panel.statusArea.quickSettings.addExternalIndicator(indicator, 2);
```

When binding from gsettings back to the slider, block the signal handler
temporarily to avoid feedback loops:

```ts
this.slider.block_signal_handler(this._sliderChangedId);
this.slider.value = this._settings.get_uint("slider-value") / 100.0;
this.slider.unblock_signal_handler(this._sliderChangedId);
```

## Action Button

A prominent button in the quick settings action area (next to Lock Screen,
Settings buttons). Use sparingly — space is limited.

```ts
const MyButton = GObject.registerClass(
  class MyButton extends QuickSettings.QuickSettingsItem {
    constructor() {
      super({
        style_class: "icon-button",
        can_focus: true,
        icon_name: "selection-mode-symbolic",
        accessible_name: _("My Action"),
      });
      this.connect("clicked", () => log("activated"));
    }
  }
);
```

Action buttons are added manually to the existing action area:

```ts
const actionsArea = Main.panel.statusArea.quickSettings._system._indicator.child;
actionsArea.add_child(new MyButton());
```

## Anvil Usage

The existing implementation in `src/lib/extension/indicator.ts` demonstrates all major
patterns:

- **`FeatureIndicator`** (line 103) — extends `SystemIndicator`, manages icon visibility
  bound to `tiling-mode-enabled` + `quick-settings-enabled` gsettings keys
- **`FeatureMenuToggle`** (line 37) — extends `QuickMenuToggle`, binds `checked` to
  `tiling-mode-enabled`, contains `PopupSwitchMenuItem` subclasses for gap/focus settings,
  and a `Settings` action with lock-screen gating
- **`extension.ts`** (lines 112–118) — the enable/disable lifecycle:
  `new FeatureIndicator(this)` → `quickSettingsItems.push(new FeatureMenuToggle(this))` →
  `addExternalIndicator()` on enable, `destroy()` on disable

## Extension Lifecycle

```ts
enable() {
    this._indicator = new MyIndicator(this);
    Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator);
    // For sliders: pass 2 as second arg for two-column span
    // Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator, 2);
}

disable() {
    this._indicator?.destroy();
    this._indicator = null;
}
```

The `destroy()` call on the indicator cascades to all items pushed onto
`quickSettingsItems`.

## Testing

Quick settings items cannot be tested headless (no keyboard/virtual pointer).
Settings-level verification via gsettings is the only testable path. The
`test/unit/__mocks__/shell/main.js` mock provides a stub `addExternalIndicator`.
