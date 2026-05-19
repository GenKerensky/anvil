---
name: dialogs
description: Create modal and non-modal dialogs in GNOME Shell using Dialog and ModalDialog modules
license: MIT
compatibility: opencode
---

# Dialogs

Guide for creating modal and non-modal dialogs in GNOME Shell. Dialogs use the Shell
`Dialog` and `ModalDialog` modules — they run in the `gnome-shell` process (not the prefs
GTK process) and use Clutter/St actors, not GTK widgets.

> Some `Dialog` module classes are pure JavaScript and do not support GObject features
> like property bindings.

## Imports

```ts
import St from "gi://St";
import Clutter from "gi://Clutter";
import * as Dialog from "resource:///org/gnome/shell/ui/dialog.js";
import * as ModalDialog from "resource:///org/gnome/shell/ui/modalDialog.js";
```

## `Shell.ActionMode`

Controls when actions (keybindings, gestures) are handled. Pass to `ModalDialog` or
use when adding keybindings that should not fire during a dialog.

| Constant        | When action is allowed               |
| --------------- | ------------------------------------ |
| `NONE`          | Never                                |
| `NORMAL`        | Window mode (focus in an app window) |
| `OVERVIEW`      | Overview active                      |
| `LOCK_SCREEN`   | Screen locked                        |
| `UNLOCK_SCREEN` | Unlock dialog shown                  |
| `LOGIN_SCREEN`  | Login screen                         |
| `SYSTEM_MODAL`  | System modal dialog open             |
| `LOOKING_GLASS` | Looking Glass open                   |
| `POPUP`         | Shell menu open                      |
| `ALL`           | Always                               |

## `Dialog.Dialog`

A layout widget with a content area and a button area. Not modal on its own — usually
wrapped by `ModalDialog.ModalDialog` or added directly to a shell actor.

```ts
// Constructor: new Dialog.Dialog(parentActor, styleClass)
const layout = new Dialog.Dialog(parentActor, "my-dialog");

// Content area (St.BoxLayout)
layout.contentLayout.add_child(new St.Icon({ icon_name: "dialog-information-symbolic" }));

// Add buttons
layout.addButton({
  label: "Close",
  isDefault: true, // activated by Enter key, gets default focus
  action: () => layout.destroy(),
  key: Clutter.KEY_Escape, // optional keybinding
});

// Remove all buttons
layout.clearButtons();
```

### `Dialog.MessageDialogContent`

Simple title + description widget, like `Gtk.MessageDialog`.

```ts
const message = new Dialog.MessageDialogContent({
  title: "Important",
  description: "Something happened that you should know about!",
});
layout.contentLayout.add_child(message);
```

### `Dialog.ListSection` / `Dialog.ListSectionItem`

List of items with icon, title, and description.

```ts
const list = new Dialog.ListSection({ title: "Todo List" });
layout.contentLayout.add_child(list);

list.list.add_child(
  new Dialog.ListSectionItem({
    icon_actor: new St.Icon({ icon_name: "dialog-information-symbolic" }),
    title: "Task One",
    description: "The first thing I need to do",
  })
);
```

## `ModalDialog.ModalDialog`

Full modal dialog. Creates a `Dialog.Dialog` layout internally, manages open/close state
with fade animations, and blocks interaction with the rest of the shell.

```ts
const dialog = new ModalDialog.ModalDialog({
  shellReactive: false, // shell is insensitive while open (default)
  actionMode: Shell.ActionMode.SYSTEM_MODAL, // when actions fire
  shouldFadeIn: true, // animate open (default)
  shouldFadeOut: true, // animate close (default)
  destroyOnClose: false, // keep alive after close (default: true)
  styleClass: "my-dialog", // CSS class
});

// Add content via contentLayout (inherited from Dialog.Dialog)
dialog.contentLayout.add_child(listLayout);

// Set buttons (replaces existing)
dialog.setButtons([
  { label: "Close", action: () => dialog.destroy() },
  { label: "Later", isDefault: true, action: () => dialog.close(global.get_current_time()) },
]);

// Lifecycle signals
dialog.connect("opened", () => log("dialog opened"));
dialog.connect("closed", () => log("dialog closed"));

// Open (on primary monitor by default)
dialog.open(global.get_current_time(), true);

// Close
dialog.close(global.get_current_time());

// Focus an actor when opened
dialog.setInitialKeyFocus(someActor);
```

### `ModalDialog.State`

| State       | Meaning          |
| ----------- | ---------------- |
| `OPENED`    | Dialog is open   |
| `CLOSED`    | Dialog is closed |
| `OPENING`   | Fading in        |
| `CLOSING`   | Fading out       |
| `FADED_OUT` | Faded out        |

## Extension Lifecycle

Dialogs must be created in `enable()` and destroyed in `disable()`. If
`destroyOnClose: false`, handle cleanup manually:

```ts
enable() {
    this._dialog = new ModalDialog.ModalDialog({ destroyOnClose: false });
    // ... setup ...
}

disable() {
    this._dialog?.destroy();
    this._dialog = null;
}
```

For reusable dialogs, connect to the `destroy` signal to null the reference:

```ts
dialog.connect("destroy", () => {
  this._dialog = null;
});
```

## Testing

Dialogs cannot be tested headless (no keyboard/pixel). AT-SPI inspection via Dogtail
may detect dialog actors if they have accessible roles set, but visual/behavioral
testing requires a real session.
