---
name: preferences-window
description: Add, modify, or debug the Anvil extension preferences dialog built with GTK4 and Adwaita
license: MIT
compatibility: agents
---

# Preferences Window

Guide for adding, modifying, or debugging the Anvil extension preferences dialog. The prefs
run in a **separate GTK4/Adwaita process** from GNOME Shell — no access to `Meta`, `Clutter`,
`Shell`, or `St`. Only `Gio`, `GLib`, `GObject`, `Gtk`, `Gdk`, and `Adw` are available.

## Architecture

```
src/prefs.ts                          # Entry point: fillPreferencesWindow()
src/lib/prefs/
  settings.ts   → SettingsPage         # "Tiling" page — behavior toggles, log level
  appearance.ts → AppearancePage       # "Appearance" page — gaps, colors, CSS, border radius
  keyboard.ts   → KeyboardPage         # "Keyboard" page — modifier key, shortcut entries
  floating.ts   → FloatingPage         # "Windows" page — per-window float overrides
  widgets.ts                          # Reusable widget classes (SwitchRow, ColorRow, etc.)
  prefs-theme-manager.ts              # CSS read/parse/modify/write + signal extension
  metadata.js                         # Generated: developers list from git log (gitignored; path: src/lib/prefs/metadata.js)
```

Two GSettings schemas (from `metadata.json` `settings-schema`):

| Schema                                         | Path                                             | Purpose            |
| ---------------------------------------------- | ------------------------------------------------ | ------------------ |
| `org.gnome.shell.extensions.anvil`             | `/org/gnome/shell/extensions/anvil/`             | Main settings      |
| `org.gnome.shell.extensions.anvil.keybindings` | `/org/gnome/shell/extensions/anvil/keybindings/` | Keyboard shortcuts |

In `src/prefs.ts`, both are loaded:

```ts
this.settings = this.getSettings(); // main schema
this.kbdSettings = this.getSettings("org.gnome.shell.extensions.anvil.keybindings");
```

Pages receive them via destructuring:

```ts
window.add(new SettingsPage(this as any));
// Page constructor: constructor({ settings, window, metadata, ... })
```

## Adding a New Setting (Boolean)

### 1. Add the GSettings key

In `src/schemas/org.gnome.shell.extensions.anvil.gschema.xml`:

```xml
<key type="b" name="my-new-setting">
    <default>true</default>
    <summary>Description of my new setting</summary>
</key>
```

Common types: `b` (boolean), `s` (string), `u` (uint32), `as` (string array).

### 2. Add the widget

In the appropriate page constructor (e.g. `SettingsPage`):

```ts
new SwitchRow({
  title: _("My New Setting"),
  subtitle: _("What it does"),
  experimental: true, // optional: shows a bug icon with tooltip
  settings,
  bind: "my-new-setting",
});
```

The widget library is in `src/lib/prefs/widgets.ts`.

## Widget Library Reference

All widgets are in `src/lib/prefs/widgets.ts`. Each extends a GTK/Adwaita class and registers
with `GObject.registerClass(this)`.

### `SwitchRow` (extends `Adw.ActionRow`)

Boolean toggle. Binds `Gtk.Switch.active` ↔ `Gio.Settings` key.

```ts
new SwitchRow({ title, settings, bind, subtitle, experimental });
```

### `SpinButtonRow` (extends `Adw.ActionRow`)

Numeric spinner. Two modes:

**Mode A: bind to GSettings** — settings key must be type `u`:

```ts
new SpinButtonRow({ title, range: [0, 32, 1], settings, bind: "window-gap-size" });
```

**Mode B: manual callback** — no settings binding, use `init` + `onChange`:

```ts
new SpinButtonRow({
  title,
  range: [0, 28, 1],
  init: currentRadius,
  onChange: (value) => {
    /* handle value change */
  },
});
```

### `DropDownRow` (extends `Adw.ActionRow`)

Dropdown selector. Must provide `type` (GVariant type string like `"s"`, `"u"`):

```ts
new DropDownRow({
  title,
  settings,
  bind: "dnd-center-layout",
  type: "s",
  items: [
    { id: "swap", name: _("Swap") },
    { id: "tabbed", name: _("Tabbed") },
  ],
});
```

Uses a `Gtk.StringList` model internally. The `id` values are written to GSettings.

### `ColorRow` (extends `Adw.ActionRow`)

Color picker with alpha. No settings binding — uses `onChange`:

```ts
new ColorRow({
  title: _("Border color"),
  init: theme.getCssProperty(selector, "border-color").value,
  onChange: (rgbaString) => {
    /* handle color change */
  },
});
```

The `colorButton` (a `Gtk.ColorButton`) is exposed as a public property for external
reset logic.

### `EntryRow` (extends `Adw.EntryRow`)

Text entry. For plain strings, no `map` needed:

```ts
new EntryRow({ title, settings, bind: "workspace-skip-tile" });
```

For complex type conversions, use `map.from` / `map.to`:

```ts
new EntryRow({
  title: key,
  settings: kbdSettings,
  bind: key,
  map: {
    from(settings, bind) {
      return settings.get_strv(bind).join(",");
    },
    to(settings, bind, value) {
      // parse and validate, then call settings.set_strv(bind, [...])
    },
  },
});
```

Each `EntryRow` automatically gets a `ClearButton` (sets text to "") and a `ResetButton`
(resets to GSettings default).

### `RadioRow` (extends `Adw.ActionRow`)

Set of `Gtk.ToggleButton` widgets bound to a string GSettings key:

```ts
new RadioRow({
  title: _("Modifier key"),
  settings: kbdSettings,
  bind: "mod-mask-mouse-tile",
  options: {
    Super: _("Super"),
    Ctrl: _("Ctrl"),
    Alt: _("Alt"),
    None: _("None"),
  },
});
```

The key (`Super`, `Ctrl`, etc.) is what gets stored in GSettings. The value is the label.

### `PreferencesPage` (extends `Adw.PreferencesPage`)

Base class for all pages. Provides `add_group()`:

```ts
this.add_group({
    title: _("Group Title"),
    description: _("Optional description"),
    header_suffix: someWidget,  // optional, e.g. About button or ResetButton
    children: [
        new SwitchRow(...),
        new SpinButtonRow(...),
    ],
})
```

### Utility widgets

- `ResetButton({ settings?, bind?, onReset })` — undo icon, calls `settings.reset(bind)` then `onReset()`
- `ClearButton({ onClear })` — clear icon (X), calls `onClear()`
- `RemoveItemRow({ title, subtitle?, onRemove })` — row with delete button
- `RemoveButton({ item, parent, onRemove })` — delete icon, calls `onRemove(item, parent)`

## CSS / Appearance Settings

CSS manipulation flows through `PrefsThemeManager` (`src/lib/prefs/prefs-theme-manager.ts`),
which extends `ThemeManagerBase` (`src/lib/shared/theme.ts`).

### How it works

1. `ThemeManagerBase.initializeStylesheet()` asks the migration service for the shipped base and
   user override files, then parses each available stylesheet into its own AST via
   `src/lib/css/index.ts`
2. `getCssProperty(selector, property)` reads the user override first and falls back to the shipped
   base AST
3. `setCssProperty(selector, property, value)` modifies the AST, writes it back to disk, then calls `reloadStylesheet()`
4. `PrefsThemeManager.reloadStylesheet()` sets the `css-updated` GSettings key to a timestamp, which signals the extension process to reload themes

### Common CSS selectors

| Selector                      | Scheme    | Use                    |
| ----------------------------- | --------- | ---------------------- |
| `.window-tiled-border`        | `tiled`   | Focused window border  |
| `.window-tabbed-border`       | `tabbed`  | Tabbed window border   |
| `.window-stacked-border`      | `stacked` | Stacked window border  |
| `.window-floated-border`      | `floated` | Floating window border |
| `.window-split-border`        | `split`   | Split direction hint   |
| `.window-tilepreview-tiled`   | `tiled`   | Drag preview           |
| `.window-tilepreview-stacked` | `stacked` | Drag preview           |
| `.window-tilepreview-tabbed`  | `tabbed`  | Drag preview           |

### Pattern for a color picker with reset

```ts
const row = new Adw.ExpanderRow({ title: _("Tiled window") });

const borderColorRow = new ColorRow({
  title: _("Border color"),
  init: theme.getCssProperty(selector, "border-color").value,
  onChange: (rgbaString) => {
    const rgba = new Gdk.RGBA();
    if (rgba.parse(rgbaString)) {
      theme.setCssProperty(selector, "border-color", rgba.to_string());
      // Also update preview variants with adjusted alpha...
    }
  },
});
borderColorRow.add_suffix(
  new ResetButton({
    onReset: () => {
      const defaultColor = theme.defaultPalette[scheme].color;
      // reset color and update the colorButton...
    },
  })
);

row.add_row(borderColorRow);
```

## Keyboard Shortcuts

Shortcuts use GSettings type `as` (string array) in the keybindings schema.
Keybinding GSettings key names follow a prefix pattern for grouping:

- `window-*` → "Tiling shortcuts"
- `con-*` → "Container shortcuts"
- `workspace-*` → "Workspace shortcuts"
- `focus-*` → "Appearance shortcuts"
- `prefs-*` → "Other shortcuts"

`KeyboardPage.createKeyList(settings, prefix)` filters `settings.list_keys()` by prefix.

### Adding a new keybinding

1. Add to `src/schemas/org.gnome.shell.extensions.anvil.gschema.xml`:

```xml
<key type="as" name="window-my-action">
    <default><![CDATA[['<Super>m']]]></default>
    <summary>My action description</summary>
</key>
```

1. Register the keybinding action in `src/lib/extension/keybindings.ts`.
2. The preferences UI auto-discovers it via the prefix — no widget code needed if the
   prefix matches an existing group.

### Shortcut validation

`Gtk.accelerator_parse()` parses the string, `Gtk.accelerator_valid()` checks validity,
`Gtk.accelerator_name()` normalizes back to display format. Invalid entries are rejected.

## File-based Config (Window Overrides)

`ConfigManager` (`src/lib/shared/settings.ts`) manages `$HOME/.config/anvil/config/windows.json`.
The default overrides live in `src/config/windows.json` and are copied to the build output.

### FloatingPage pattern

```ts
this.configMgr = new ConfigManager({ dir }); // dir = extension.get_dir()

// Read overrides
let overrides = this.configMgr.windowProps.overrides;

// Write overrides
this.configMgr.windowProps = { overrides: modified };
// Signal the extension to reload
this.settings.set_uint("window-overrides-reload-trigger", Math.floor(Date.now() / 1000));
```

Each override entry has `wmClass`, `wmTitle`, and `mode` ("float").

## Dev vs. Production Mode

`src/lib/shared/settings.ts` exports `production` (default `true`). `make dev` toggles it to
`false` via `sed`. Dev-only preferences (Logger page, About button) are conditionally
rendered:

```ts
if (!production) {
  this.add_group({
    title: _("Logger"),
    children: [
      /* DropDownRow for log level */
    ],
  });
}
```

## i18n

Import `gettext as _` from the prefs module (NOT from `src/extension.ts`):

```ts
import { gettext as _ } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";
```

Wrap all user-visible strings in `_()`.

## Accessibility

GTK4 and Adwaita have built-in accessible roles, relationships, and states for all
standard widgets. Accessibility issues almost always mean a design flaw, a missing role
on a custom widget, or a broken label relationship.

### Rules When Adding or Modifying Widgets

1. **Prefer standard GTK/Adwaita widgets** — `Gtk.Switch`, `Gtk.SpinButton`, `Gtk.ColorButton`,
   `Gtk.DropDown`, `Adw.ExpanderRow`, `Adw.EntryRow` all handle accessible roles, keyboard
   navigation, and state management automatically. Custom widgets must carry their own burden.

2. **`Adw.ActionRow` is the base for most rows** — it automatically links its title label to
   the activatable widget via the `label-actor` relationship. If you replace or rearrange
   children manually, you may break this linkage. All custom widgets in `widgets.ts`
   (`SwitchRow`, `SpinButtonRow`, `ColorRow`, `DropDownRow`, `RadioRow`, `RemoveItemRow`)
   extend `Adw.ActionRow` and use `add_suffix()` for the control — this preserves the label
   relationship.

3. **Custom widgets without an explicit `accessible_role`** — verify the role is correct.
   For example, a group of `Gtk.ToggleButton` widgets (like `RadioRow`) should each have
   the `RADIO_BUTTON` role. GTK derives this from `Gtk.ToggleButton` automatically, but if
   you build a widget from `St.Bin` or a bare container, you must set it:

   ```ts
   accessible_role: Atk.Role.CHECK_BOX,
   ```

4. **State toggles must update CSS pseudo-classes** — AT-SPI `checked`/`selected` states
   are driven by the CSS pseudo-classes `:checked` and `:selected`. If a widget manages
   its own toggle state outside of GSettings binding, it must add/remove the pseudo-class:

   ```ts
   if (state) this.add_style_pseudo_class("checked");
   else this.remove_style_pseudo_class("checked");
   ```

5. **Label every icon-only button** — buttons with just an icon (`ResetButton`, `ClearButton`,
   `RemoveButton`) must have a `tooltip_text` set. All current utility buttons do this.

6. **Experimental badge accessibility** — `SwitchRow` appends a bug icon (`bug-symbolic`)
   when `experimental: true`. The icon has a tooltip via `set_tooltip_markup()`, but
   confirm it is reachable via AT-SPI as a child of the row.

7. **Color contrast** — CSS color changes made via `PrefsThemeManager` update border colors
   on focus hints and previews. If adding new color settings, test with high-contrast
   and dark themes to ensure borders remain visible.

8. **Keyboard navigation** — all activatable widgets must be reachable via `Tab` / `Shift+Tab`.
   `activatable_widget` property on each row points the focus chain to the correct child.
   Don't remove or misdirect this property.

### Verifying Accessibility

Use Dogtail/AT-SPI to inspect the widget tree. From inside the E2E container or local session:

```bash
# Open prefs and inspect the AT-SPI tree
accerciser  # GUI browser for AT-SPI tree
```

In Dogtail (from E2E tests):

```python
from dogtail.tree import root
from dogtail.predicate import GenericPredicate

# Check all roles present
for app in root.children:
    for child in app.children:
        for widget in child.findChildren(GenericPredicate()):
            print(widget.roleName, widget.name)

# Verify a specific row has correct label-actor linkage
row = prefs_window.findChild(GenericPredicate(roleName="label"), "Show Indicator")
# The parent ActionRow should have the switch as its accessible child
```

### E2E Test Best Practices

- Try multiple AT-SPI role names when searching for widgets — GTK versions vary in
  how they expose roles (`"switch"`, `"toggle button"`, `"check box"`).
- GtkSwitch `.checked` is verified via the property, not click state,
  because AT-SPI clicks are no-ops on switches in headless mode.
- If adding a new page tab, add a Behave scenario to verify it appears in
  `test/e2e/features/preferences.feature`.

## Testing Preferences

### E2E (Behave + Dogtail/AT-SPI)

No keyboard/pixel/drag-drop testing possible in headless Wayland.

To verify a switch's state: write via gsettings, read `.checked` via AT-SPI.

```python
# Find switches (try multiple role names for GTK version compat)
for role in ("switch", "toggle button", "check box"):
    switches = prefs_window.findChildren(GenericPredicate(roleName=role))
widget.checked  # boolean
```

Page tabs found via `GenericPredicate(roleName="page tab")`, navigated with
`.doActionNamed("click")`.

Feature files: `test/e2e/features/preferences.feature` (9 scenarios).
Steps: `test/e2e/features/steps/preferences_steps.py`.

### Unit

Pure-logic tests in `test/unit/shared/theme.test.ts` verify default-palette derivation and CSS
persistence. `test/unit/prefs/appearance.test.ts` exercises the appearance reset consumer so the
shipped palette reaches both stylesheet updates and widget state. GSettings and GObject APIs are
mocked via `test/unit/__mocks__/`.

## Debugging

```bash
# Watch prefs process logs (separate from gnome-shell)
journalctl -f -o cat /usr/bin/gjs

# Watch GSettings changes live
dconf watch /org/gnome/shell/extensions/anvil/

# Open prefs from command line
gnome-extensions prefs anvil@GenKerensky.github.com
```
