# Floating windows

Floating windows remain managed by GNOME but are excluded from Anvil's tiled size calculations. Anvil supports one-window exceptions, reusable application rules, and a persistent rules file.

## Toggle floating from the keyboard

| Action                                       | Default shortcut                               |
| -------------------------------------------- | ---------------------------------------------- |
| Toggle only the active window                | <kbd>Super</kbd>+<kbd>C</kbd>                  |
| Toggle the active window's application class | <kbd>Shift</kbd>+<kbd>Super</kbd>+<kbd>C</kbd> |

The first action records an exception for that specific window identity. The class action affects matching windows from the same application class.

## Manage floating applications

Open **Anvil Preferences → Windows** to see the floating-window list.

- Select **Add**, then choose a visible window to add its application class.
- Remove a row to let that application tile again.
- Use **Reset** to restore Anvil's packaged default rules.

Rules are stored in:

```text
~/.config/anvil/config/windows.json
```

Each rule can match a window class and optionally a title or window identity. A rule's mode is either `float` or `tile`.

## Always on top

**Anvil Preferences → Tiling → Always on Top mode for floating windows** keeps floating windows above tiled windows. It is enabled by default and currently marked experimental in preferences.

Snap commands also convert a tiled window to floating before placing it at the requested fraction of the work area.
