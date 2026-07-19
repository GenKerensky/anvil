# Window resizing

Anvil preserves the proportions of tiled siblings when you resize a shared boundary. You can resize with GNOME's normal pointer grab or use directional keyboard commands.

## Pointer resizing

Drag an edge of a tiled window as usual. During an active resize, Anvil updates the affected tiled neighbors so the container follows the pointer instead of waiting until the grab ends.

Only boundaries with an eligible adjacent tiled sibling can redistribute space. Windows still obey their minimum size and any configured monitor constraints.

## Keyboard resizing

The default keyboard step is 15 pixels.

| Edge   | Grow                                          | Shrink                                                         |
| ------ | --------------------------------------------- | -------------------------------------------------------------- |
| Left   | <kbd>Ctrl</kbd>+<kbd>Super</kbd>+<kbd>Y</kbd> | <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Super</kbd>+<kbd>O</kbd> |
| Bottom | <kbd>Ctrl</kbd>+<kbd>Super</kbd>+<kbd>U</kbd> | <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Super</kbd>+<kbd>I</kbd> |
| Top    | <kbd>Ctrl</kbd>+<kbd>Super</kbd>+<kbd>I</kbd> | <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Super</kbd>+<kbd>U</kbd> |
| Right  | <kbd>Ctrl</kbd>+<kbd>Super</kbd>+<kbd>O</kbd> | <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Super</kbd>+<kbd>Y</kbd> |

To change the step for all eight commands:

```bash
gsettings set org.gnome.shell.extensions.anvil resize-amount 20
```

## Monitor constraints

The **Monitors** preferences page can cap tiled width and height per connector. With **Resize exemption** enabled, a manually resized window can exceed that monitor's cap after the resize is recognized. See [Multiple monitors](multiple-monitors.md).
