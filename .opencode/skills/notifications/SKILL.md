---
name: notifications
description: Display notifications from GNOME Shell extensions using Main.notify and MessageTray APIs
license: MIT
compatibility: opencode
---

# Notifications

Guide for displaying notifications from GNOME Shell extensions. GNOME Shell acts as
the notification server, but extensions use Shell-internal APIs (not `Gio.Notification`)
to post notifications directly.

## Imports

```ts
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as MessageTray from "resource:///org/gnome/shell/ui/messageTray.js";
import Gio from "gi://Gio";
```

## Simple Notifications

For quick one-liners without source management:

```ts
// Basic notification
Main.notify("Title", "Notification body text");

// Error notification — also logs as a warning to the journal
try {
  throw Error("File not found");
} catch (e) {
  Main.notifyError("Failed", e.message);
}
```

The logged warning appears as:

```
GNOME Shell-Message: 00:00:00.000: error: Failed: File not found
```

## `MessageTray.Notification`

Full-featured notification with source, urgency, actions, and destroy reasons.

```ts
const notification = new MessageTray.Notification({
  source: someSource, // MessageTray.Source
  title: _("Custom Notification"),
  body: _("This notification uses a custom source"),
  gicon: new Gio.ThemedIcon({ name: "dialog-warning" }), // Gio.Icon
  iconName: "dialog-warning", // themed icon name
  urgency: MessageTray.Urgency.NORMAL,
});
```

### Urgency Levels

| Level      | Behavior                                            |
| ---------- | --------------------------------------------------- |
| `LOW`      | Shown in tray only, no popup                        |
| `NORMAL`   | Popup unless policy forbids it                      |
| `HIGH`     | Popup unless policy forbids it                      |
| `CRITICAL` | Always shown expanded, must be acknowledged by user |

### Actions

Every notification has a default action (fired when clicked):

```ts
notification.connect("activated", (_notification) => {
  log(`${notification.title}: notification activated`);
});
```

Up to 3 action buttons:

```ts
notification.addAction(_("Close"), () => {
  log('"Close" button activated');
});

notification.clearActions(); // remove all
```

### Destroy Reasons

Connect to the `destroy` signal to know why a notification was removed:

```ts
notification.connect("destroy", (_notification, reason) => {
  if (reason === MessageTray.NotificationDestroyedReason.DISMISSED)
    log("User closed the notification");
});
```

| Reason          | Meaning                               |
| --------------- | ------------------------------------- |
| `EXPIRED`       | Dismissed without user acknowledgment |
| `DISMISSED`     | Closed by the user                    |
| `SOURCE_CLOSED` | Closed by its source                  |
| `REPLACED`      | Replaced by a newer version           |

## Custom Sources

Create a `MessageTray.Source` for grouping notifications under a custom origin
(e.g. your extension's name). The source must be added to `Main.messageTray`.

```ts
let _source: MessageTray.Source | null = null;

function getSource(): MessageTray.Source {
  if (!_source) {
    _source = new MessageTray.Source({
      title: _("My Extension"),
      icon: new Gio.ThemedIcon({ name: "dialog-information" }),
      iconName: "dialog-information",
      policy: new MyNotificationPolicy(),
    });

    _source.connect("destroy", () => {
      _source = null;
    });
    Main.messageTray.add(_source);
  }
  return _source;
}
```

To post from the custom source:

```ts
const source = getSource();
source.addNotification(
  new MessageTray.Notification({
    source,
    title: _("Alert"),
    body: _("Something happened"),
  })
);
```

### Notification Policies

Control how and when notifications appear by subclassing
`MessageTray.NotificationPolicy`:

```ts
const MyNotificationPolicy = GObject.registerClass(
  class MyNotificationPolicy extends MessageTray.NotificationPolicy {
    get enable() {
      return true;
    } // show notifications
    get enableSound() {
      return true;
    } // play sound
    get showBanners() {
      return true;
    } // popup outside tray
    get forceExpanded() {
      return false;
    } // always show full banner
    get showInLockScreen() {
      return false;
    } // show on lock screen
    get detailsInLockScreen() {
      return false;
    } // show content on lock screen
  }
);
```

The default policy `MessageTray.NotificationGenericPolicy` follows desktop settings.

### System Source

For notifications that should appear to come from the system:

```ts
const systemSource = MessageTray.getSystemSource();
const notif = new MessageTray.Notification({
  source: systemSource,
  title: "System Notification",
  body: "This appears to come from the system",
});
systemSource.addNotification(notif);
```

## Extension Lifecycle

Sources added to `Main.messageTray` persist until the extension is disabled or the
source is destroyed. Clean up in `disable()`:

```ts
disable() {
    if (this._source) {
        this._source.destroy();
        this._source = null;
    }
}
```

If using `GLib.timeout_add_seconds` for reminder notifications, remove the source
ID in `disable()` with `GLib.Source.remove()`.

## Testing

Notification text cannot be inspected headless (no AT-SPI/DBus API for notification
content). Settings-level verification via gsettings is the only testable path.
