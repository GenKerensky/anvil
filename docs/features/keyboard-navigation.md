# Keyboard navigation

Anvil's keyboard controls use the directional pattern <kbd>H</kbd>/<kbd>J</kbd>/<kbd>K</kbd>/<kbd>L</kbd> for left/down/up/right.

## Focus a window

Hold <kbd>Super</kbd> and press a direction key. Anvil follows the tiling tree in that direction, skips minimized windows, and activates the next eligible tile. Navigation can cross nested containers and neighboring monitors.

## Move a window

Hold <kbd>Shift</kbd>+<kbd>Super</kbd> and press a direction key. Moving rewrites the window's position in the tiling tree. Depending on the target, that can reorder siblings, enter another container, or cross to another monitor.

## Swap windows

Hold <kbd>Ctrl</kbd>+<kbd>Super</kbd> and press a direction key to exchange the focused tile with its directional neighbor while preserving the surrounding container.

Press <kbd>Super</kbd>+<kbd>Enter</kbd> to swap the focused window with GNOME's previous normal-window target on the active workspace. This is useful for quickly exchanging the two windows you are working between.

## Close a window

Press <kbd>Super</kbd>+<kbd>Q</kbd> to ask the active application window to close.

Every default and customization instruction is listed in the [keybindings reference](../keybindings.md).
