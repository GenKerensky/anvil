# Workspaces

Anvil maintains tiling state per workspace and monitor. Moving to another workspace reveals that workspace's own layout rather than reusing the visible tree from the previous workspace.

## Disable tiling on selected workspaces

Press <kbd>Shift</kbd>+<kbd>Super</kbd>+<kbd>W</kbd> to toggle tiling for the active workspace. Windows on a skipped workspace float until the workspace is returned to tiling.

You can also enter a comma-separated list under **Anvil Preferences → Tiling → Non-tiling workspaces**. Workspace indexes start at zero, so `0,1,2` skips the first three workspaces.

> [!TIP]
> GNOME can renumber workspaces when dynamic workspaces are inserted or removed. Review an index-based skip list if its meaning changes after reorganizing workspaces.

## Dynamic workspaces

Anvil listens for workspaces being created and removed and reconciles its per-workspace surfaces. Newly opened windows are admitted to the workspace and monitor where GNOME reports them.

## GNOME workspace shortcuts

Anvil does not replace GNOME's shortcuts for switching workspaces or moving windows between them. Configure those in **GNOME Settings → Keyboard → View and Customize Shortcuts**.
