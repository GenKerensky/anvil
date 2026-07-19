# Keybindings

Anvil uses Vim-style direction keys: <kbd>H</kbd> is left, <kbd>J</kbd> is down, <kbd>K</kbd> is up, and <kbd>L</kbd> is right. Every keyboard shortcut can be changed or cleared from **Anvil Preferences → Keyboard → Shortcuts**.

## Contents

- [Focus, move, and swap](#focus-move-and-swap)
- [Layouts](#layouts)
- [Windows](#windows)
- [Resize](#resize)
- [Workspace and extension controls](#workspace-and-extension-controls)
- [Drag-and-drop modifier](#drag-and-drop-modifier)
- [Customize a shortcut](#customize-a-shortcut)
- [GNOME shortcuts disabled by Anvil](#gnome-shortcuts-disabled-by-anvil)

## Focus, move, and swap

| Action                           | Default                                        |
| -------------------------------- | ---------------------------------------------- |
| Focus left                       | <kbd>Super</kbd>+<kbd>H</kbd>                  |
| Focus down                       | <kbd>Super</kbd>+<kbd>J</kbd>                  |
| Focus up                         | <kbd>Super</kbd>+<kbd>K</kbd>                  |
| Focus right                      | <kbd>Super</kbd>+<kbd>L</kbd>                  |
| Move window left                 | <kbd>Shift</kbd>+<kbd>Super</kbd>+<kbd>H</kbd> |
| Move window down                 | <kbd>Shift</kbd>+<kbd>Super</kbd>+<kbd>J</kbd> |
| Move window up                   | <kbd>Shift</kbd>+<kbd>Super</kbd>+<kbd>K</kbd> |
| Move window right                | <kbd>Shift</kbd>+<kbd>Super</kbd>+<kbd>L</kbd> |
| Swap window left                 | <kbd>Ctrl</kbd>+<kbd>Super</kbd>+<kbd>H</kbd>  |
| Swap window down                 | <kbd>Ctrl</kbd>+<kbd>Super</kbd>+<kbd>J</kbd>  |
| Swap window up                   | <kbd>Ctrl</kbd>+<kbd>Super</kbd>+<kbd>K</kbd>  |
| Swap window right                | <kbd>Ctrl</kbd>+<kbd>Super</kbd>+<kbd>L</kbd>  |
| Swap with the last active window | <kbd>Super</kbd>+<kbd>Enter</kbd>              |

Moving changes the window's position in the tiling tree. Swapping exchanges two window positions without changing the surrounding layout.

## Layouts

| Action                           | Default                                        |
| -------------------------------- | ---------------------------------------------- |
| Split container horizontally     | <kbd>Super</kbd>+<kbd>Z</kbd>                  |
| Split container vertically       | <kbd>Super</kbd>+<kbd>V</kbd>                  |
| Toggle horizontal/vertical split | <kbd>Super</kbd>+<kbd>G</kbd>                  |
| Toggle stacked layout            | <kbd>Shift</kbd>+<kbd>Super</kbd>+<kbd>S</kbd> |
| Toggle tabbed layout             | <kbd>Shift</kbd>+<kbd>Super</kbd>+<kbd>T</kbd> |
| Show or hide tab decoration      | <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>Y</kbd>    |

## Windows

| Action                                      | Default                                        |
| ------------------------------------------- | ---------------------------------------------- |
| Toggle floating for the active window       | <kbd>Super</kbd>+<kbd>C</kbd>                  |
| Toggle floating for the active window class | <kbd>Shift</kbd>+<kbd>Super</kbd>+<kbd>C</kbd> |
| Close the active window                     | <kbd>Super</kbd>+<kbd>Q</kbd>                  |
| Snap to the left third                      | <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>D</kbd>    |
| Snap to the left two-thirds                 | <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>E</kbd>    |
| Snap to the right third                     | <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>G</kbd>    |
| Snap to the right two-thirds                | <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>T</kbd>    |
| Snap to the center                          | <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>C</kbd>    |

Snap commands float a tiled window before positioning it in the monitor work area.

## Resize

The resize step is **15 pixels** by default. It is not currently exposed in the preferences UI; advanced users can change it with `gsettings set org.gnome.shell.extensions.anvil resize-amount 20`.

| Action                      | Default                                                        |
| --------------------------- | -------------------------------------------------------------- |
| Grow from the left edge     | <kbd>Ctrl</kbd>+<kbd>Super</kbd>+<kbd>Y</kbd>                  |
| Shrink from the left edge   | <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Super</kbd>+<kbd>O</kbd> |
| Grow from the bottom edge   | <kbd>Ctrl</kbd>+<kbd>Super</kbd>+<kbd>U</kbd>                  |
| Shrink from the bottom edge | <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Super</kbd>+<kbd>I</kbd> |
| Grow from the top edge      | <kbd>Ctrl</kbd>+<kbd>Super</kbd>+<kbd>I</kbd>                  |
| Shrink from the top edge    | <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Super</kbd>+<kbd>U</kbd> |
| Grow from the right edge    | <kbd>Ctrl</kbd>+<kbd>Super</kbd>+<kbd>O</kbd>                  |
| Shrink from the right edge  | <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Super</kbd>+<kbd>Y</kbd> |

## Workspace and extension controls

| Action                                 | Default                                        |
| -------------------------------------- | ---------------------------------------------- |
| Toggle tiling globally                 | <kbd>Super</kbd>+<kbd>W</kbd>                  |
| Toggle tiling for the active workspace | <kbd>Shift</kbd>+<kbd>Super</kbd>+<kbd>W</kbd> |
| Toggle the focused-window border       | <kbd>Super</kbd>+<kbd>X</kbd>                  |
| Increase gaps                          | <kbd>Ctrl</kbd>+<kbd>Super</kbd>+<kbd>+</kbd>  |
| Decrease gaps                          | <kbd>Ctrl</kbd>+<kbd>Super</kbd>+<kbd>-</kbd>  |
| Open Anvil preferences                 | <kbd>Super</kbd>+<kbd>.</kbd>                  |

Anvil deliberately leaves GNOME's workspace-switching and move-to-workspace shortcuts alone.

## Drag-and-drop modifier

The default drag-and-drop modifier is **None**, so moving a tiled window immediately activates Anvil's drop regions. You can require <kbd>Super</kbd>, <kbd>Ctrl</kbd>, or <kbd>Alt</kbd> from **Anvil Preferences → Keyboard → Drag-and-drop modifier key**.

## Customize a shortcut

1. Open **Anvil Preferences → Keyboard → Shortcuts**.
2. Expand a shortcut group.
3. Select a shortcut field and enter a GTK accelerator such as `<Super>h`.
4. Press <kbd>Enter</kbd> to apply it.

Clear the field and press <kbd>Enter</kbd> to disable an Anvil shortcut. Multiple accelerators can be entered as a comma-separated list.

## GNOME shortcuts disabled by Anvil

While Anvil is enabled, it clears the following GNOME keybindings so GNOME's built-in window placement does not compete with the tiling tree. Anvil saves the active values during startup and restores them when the extension is disabled.

| GNOME action             | GNOME schema key                                  | Typical GNOME default                                          |
| ------------------------ | ------------------------------------------------- | -------------------------------------------------------------- |
| Tile window left         | `org.gnome.mutter.keybindings toggle-tiled-left`  | <kbd>Super</kbd>+<kbd>Left</kbd>                               |
| Tile window right        | `org.gnome.mutter.keybindings toggle-tiled-right` | <kbd>Super</kbd>+<kbd>Right</kbd>                              |
| Maximize window          | `org.gnome.desktop.wm.keybindings maximize`       | <kbd>Super</kbd>+<kbd>Up</kbd>                                 |
| Restore window           | `org.gnome.desktop.wm.keybindings unmaximize`     | <kbd>Super</kbd>+<kbd>Down</kbd>, <kbd>Alt</kbd>+<kbd>F5</kbd> |
| Minimize window          | `org.gnome.desktop.wm.keybindings minimize`       | <kbd>Super</kbd>+<kbd>H</kbd>                                  |
| Toggle notification list | `org.gnome.shell.keybindings toggle-message-tray` | <kbd>Super</kbd>+<kbd>V</kbd>, <kbd>Super</kbd>+<kbd>M</kbd>   |

GNOME or a distribution may ship different defaults; the schema keys above are the authoritative list Anvil clears. Anvil also temporarily disables Mutter's `edge-tiling` and `auto-maximize` settings, restoring their previous values when Anvil is disabled.
