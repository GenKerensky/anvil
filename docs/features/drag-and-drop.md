# Drag and drop

Dragging a tiled window over another tile activates drop regions that can insert, split, swap, stack, or tab the window. A colored preview shows the geometry Anvil will apply when you release the pointer.

## Drop regions

- Drop on the **left** or **right** edge to insert the window into a horizontal split.
- Drop on the **top** or **bottom** edge to insert it into a vertical split.
- Drop in the **center** to use the configured center action: **Swap**, **Tabbed**, or **Stacked**.
- Drag from the side of a stacked or tabbed group to detach the window into a split.

The default center action is **Tabbed**.

## Modifier key

By default, no modifier is required: moving a tiled window activates Anvil's drop behavior immediately. Under **Anvil Preferences → Keyboard → Drag-and-drop modifier key**, you can require <kbd>Super</kbd>, <kbd>Ctrl</kbd>, or <kbd>Alt</kbd> instead.

## Configure drag behavior

- Choose the center action under **Preferences → Tiling → Drag-and-drop behavior**.
- Toggle the colored geometry preview under **Preferences → Appearance → Preview hint**.
- Customize the preview's color and border under **Preferences → Appearance → Color**.

Drag-and-drop behavior and pixel-perfect preview rendering require a normal interactive GNOME Shell session; they cannot be fully exercised by Anvil's headless tests.
