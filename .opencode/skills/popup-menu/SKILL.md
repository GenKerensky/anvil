---
name: popup-menu
description: Create popup menus in GNOME Shell using PopupMenu, PopupMenuItem, PopupSwitchMenuItem, and related classes
license: MIT
compatibility: opencode
---

# Popup Menu

Guide for creating popup menus in GNOME Shell. Popup menus are attached to panel
buttons, quick settings toggles, or any `Clutter.Actor`. They use St widgets and
CSS, not GTK.

> Some `PopupMenu` classes are pure JavaScript and do not support GObject features
> like property bindings.

## Imports

```ts
import St from "gi://St";
import Clutter from "gi://Clutter";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";
import * as BoxPointer from "resource:///org/gnome/shell/ui/boxpointer.js";
```

## `PopupMenu.PopupMenu`

The main menu widget, anchored to a source actor with an arrow pointer.

```ts
const sourceActor = new St.Widget();
const menu = new PopupMenu.PopupMenu(sourceActor, 0.0, St.Side.TOP);
//                                    ^actor     ^arrow align  ^arrow side
```

| Method                                  | Description                                                          |
| --------------------------------------- | -------------------------------------------------------------------- |
| `addAction(title, callback, icon?)`     | Add a text item with callback. Returns the new item.                 |
| `addSettingsAction(title, desktopFile)` | Add an item that opens a GNOME Settings panel.                       |
| `addMenuItem(item, position?)`          | Add a pre-built item (or section).                                   |
| `moveMenuItem(item, position)`          | Reposition an existing item.                                         |
| `isEmpty()`                             | Returns `true` if menu has no items.                                 |
| `open(animate)`                         | Open the menu. Pass `true`/`false` or a `BoxPointer.PopupAnimation`. |
| `close(animate)`                        | Close the menu.                                                      |
| `removeAll()`                           | Remove and destroy all items.                                        |
| `toggle()`                              | Toggle open state.                                                   |
| `destroy()`                             | Destroy menu and all items.                                          |

### Animations

From `BoxPointer.PopupAnimation`:

| Constant | Effect         |
| -------- | -------------- |
| `NONE`   | No animation   |
| `SLIDE`  | Slide in/out   |
| `FADE`   | Fade in/out    |
| `FULL`   | Slide and fade |

```ts
menu.open(BoxPointer.PopupAnimation.FULL);
menu.close(BoxPointer.PopupAnimation.NONE);
```

### Signals

| Signal               | Args               | Fires when           |
| -------------------- | ------------------ | -------------------- |
| `activate`           | `(menu, menuItem)` | An item is activated |
| `active-changed`     | `(menu, menuItem)` | Active item changes  |
| `open-state-changed` | `(menu, open)`     | Menu opens or closes |
| `destroy`            | `(menu)`           | Menu is destroyed    |

## Menu Items

All item classes extend `PopupBaseMenuItem` (abstract, don't instantiate directly).

### `Ornament`

Small indicators before item content:

| Ornament | Appearance                          |
| -------- | ----------------------------------- |
| `NONE`   | None                                |
| `DOT`    | Small dot (radio button)            |
| `CHECK`  | Check mark                          |
| `HIDDEN` | Hides ornament, lets content expand |

```ts
item.setOrnament(PopupMenu.Ornament.CHECK);
```

### `PopupMenuItem`

Simple text label item.

```ts
const item = new PopupMenu.PopupMenuItem("Item Label", {
  active: false, // selected/hovered
  can_focus: true,
  hover: true, // respond to pointer
  reactive: true, // sensitive
  style_class: "my-menu-item",
});

item.connect("activate", (menuItem, event) => {
  if (event.get_type() === Clutter.EventType.BUTTON_PRESS) log("Pointer pressed!");
});

item.label.text = "New Label"; // update label
item.sensitive = false; // disable
```

### `PopupImageMenuItem`

Same as `PopupMenuItem` but with an icon before the label.

```ts
const item = new PopupMenu.PopupImageMenuItem("Item Label", "info-symbolic", {});
item.setIcon("info-symbolic"); // change icon
item.icon.icon_name = "info-symbolic"; // equivalent
```

### `PopupSwitchMenuItem`

Label + a toggle switch on the right. Emits `toggled` signal.

```ts
const item = new PopupMenu.PopupSwitchMenuItem("Item Label", true, {});
//                                                        ^initial state

item.connect("toggled", (menuItem, state) => {
  menuItem.setStatusText(state ? "On" : "Off");
});

item.toggle(); // toggle state
item.setToggleState(false); // set state directly
```

### `PopupSubMenuMenuItem`

Item that opens a submenu (with expander arrow).

```ts
const subItem = new PopupMenu.PopupSubMenuMenuItem("Sub Menu", true);
subItem.icon.icon_name = "info-symbolic";
subItem.menu.addAction(_("Sub Item 1"), () => log("activated"));
subItem.menu.addAction(_("Sub Item 2"), () => log("activated"));
```

### `PopupSeparatorMenuItem`

Visual separator with optional label.

```ts
const sep = new PopupMenu.PopupSeparatorMenuItem("Optional Label");
sep.label.text = "New Label";
```

### `PopupMenuSection`

A menu that acts as an item — used to group items within a parent menu.

```ts
const section = new PopupMenu.PopupMenuSection();
section.addAction(_("Grouped Item 1"), () => {});
section.addAction(_("Grouped Item 2"), () => {});
menu.addMenuItem(section);
```

## Anvil Usage

The existing implementation in `src/lib/extension/indicator.ts` demonstrates:

- **`FeatureMenuToggle`** (line 37) — extends `QuickMenuToggle`, uses `menu.setHeader()`,
  `menu.addMenuItem()` with `PopupSwitchMenuItem` subclasses, `PopupSeparatorMenuItem`,
  and `menu.addAction()` for a settings entry
- **`SettingsPopupSwitch`** (line 19) — extends `PopupSwitchMenuItem`, binds GSettings
  state to the switch via the `toggled` signal
- **Settings lock screen gating** (line 93) — `settingsItem.visible = Main.sessionMode.allowSettings`
  hides the settings action when the screen is locked

## Extension Lifecycle

Create menus in `enable()`, destroy in `disable()`:

```ts
enable() {
    this._indicator = new St.Widget();
    this._menu = new PopupMenu.PopupMenu(this._indicator, 0.5, St.Side.TOP);
    this._menu.addAction(_('Item'), () => {});
    Main.panel.addToStatusArea(this.uuid, this._indicator);
}

disable() {
    this._menu?.destroy();
    this._menu = null;
    this._indicator?.destroy();
    this._indicator = null;
}
```

## Accessibility

`PopupSwitchMenuItem` has built-in `Atk.Role.CHECK_MENU_ITEM` and handles the
`CHECKED` state automatically when the switch toggles. If adding custom items that
manage their own toggle state, ensure CSS pseudo-classes (`:checked`) are updated
so AT-SPI states stay in sync.

## Testing

Popup menu items cannot be tested headless (no keyboard/virtual pointer). AT-SPI
inspection may find St actors but menu interactions require a real session.
