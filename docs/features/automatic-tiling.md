# Automatic tiling

Anvil automatically adds normal application windows to a tree rooted at the window's workspace and monitor. Each branch is a layout container, and each leaf is a window. Resizing or rearranging a container updates every tiled window inside it.

## How new windows are placed

With **Quarter tiling** enabled—the default—Anvil splits around the focused window when a new window opens. Wide focused windows split side by side; tall focused windows split top to bottom. This produces balanced nested layouts without requiring a manual split before every new window.

When automatic splitting is disabled, new windows join the current monitor container's active layout.

## Toggle tiling

- Press <kbd>Super</kbd>+<kbd>W</kbd> to toggle tiling globally.
- Use the Anvil tile in GNOME Quick Settings.
- Press <kbd>Shift</kbd>+<kbd>Super</kbd>+<kbd>W</kbd> to exclude or restore only the active workspace.

Turning tiling off floats the managed windows. Turning it back on restores the tiled structure.

## Windows Anvil does not tile

Anvil ignores desktop surfaces and other Shell-owned windows that should not participate in a layout. It also ships with a default window-rules file for common dialogs, utilities, and transient windows that work better floating. You can add or remove floating rules from **Anvil Preferences → Windows**.

## Related guides

- [Automatic splitting](automatic-splitting.md)
- [Split layouts](split-layouts.md)
- [Floating windows](floating-windows.md)
- [Workspaces](workspaces.md)
