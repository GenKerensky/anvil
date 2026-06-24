# Looking Glass (REPL + Inspector)

Press `Alt+F2`, enter `lg` to open Looking Glass.

**Devkit gotcha:** Click the nested desktop inside the mutter-devkit window first so it has keyboard focus. Otherwise `Alt+F2` opens the host session's run dialog.

## Evaluator tab (default)

Run arbitrary JS in the running GNOME Shell process. Pre-imported: `GLib`, `GObject`, `Gio`, `Clutter`, `Meta`, `St`, `Shell`, `Main`.

Built-in helpers:

- `r(index)` — retrieve a previous return value by index
- `inspect(x, y)` — `Clutter.Actor` at screen coordinates
- `stage` — alias for `global.stage`

Use the target icon (⌖) to click screen elements and inspect them.

## Other tabs

| Tab            | Use for                                           |
| -------------- | ------------------------------------------------- |
| **Windows**    | Open windows, inspect `Meta.Window` / `Shell.App` |
| **Extensions** | Extension status, errors, open source directory   |
| **Actors**     | Full Clutter actor tree                           |
| **Flags**      | Clutter/Mutter debug flags (use with care)        |

## Anvil quick checks

1. Extensions tab → Anvil → **Errors**
2. Evaluator: `Main.extensionManager.lookup('anvil@GenKerensky.github.com')`
3. Evaluator: `global.display.get_focus_window()?.get_title()`
