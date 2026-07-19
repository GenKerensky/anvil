# Split layouts

Split containers are the foundation of Anvil's tiling tree. A horizontal split places children side by side; a vertical split places them from top to bottom. Splits can be nested to build layouts such as a large editor beside two stacked terminals.

## Choose the next split

| Action                             | Default shortcut              |
| ---------------------------------- | ----------------------------- |
| Horizontal split                   | <kbd>Super</kbd>+<kbd>Z</kbd> |
| Vertical split                     | <kbd>Super</kbd>+<kbd>V</kbd> |
| Toggle the current split direction | <kbd>Super</kbd>+<kbd>G</kbd> |

Choosing a split sets the container that receives the next tiled window. If the focused window is the only child, Anvil can reuse its parent; otherwise it creates a nested container around the focused window.

## Rearrange a split

- Move a window with <kbd>Shift</kbd>+<kbd>Super</kbd> plus <kbd>H</kbd>, <kbd>J</kbd>, <kbd>K</kbd>, or <kbd>L</kbd>.
- Swap adjacent windows with <kbd>Ctrl</kbd>+<kbd>Super</kbd> plus a direction key.
- Drag a window onto the edge of another tile to insert it on that side.
- Resize a boundary with the pointer or the keyboard.

When a nested container is left with one child, Anvil simplifies the tree so empty layout layers do not accumulate.
