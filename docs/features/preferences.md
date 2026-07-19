# Preferences

Open Anvil preferences with <kbd>Super</kbd>+<kbd>.</kbd>, from the Extensions app, from Anvil's Quick Settings menu, or with:

```bash
gnome-extensions prefs anvil@GenKerensky.github.com
```

If the preferences window is already open, Anvil focuses and centers that window instead of opening a duplicate.

## Pages

| Page           | Settings                                                                                                                                       |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **Tiling**     | Focus and pointer behavior, automatic splitting, stacked/tabbed layouts, drag center action, floating always-on-top, and non-tiling workspaces |
| **Appearance** | Gaps, preview and focus hints, Quick Settings visibility, corners, layout colors, border widths, and shadows                                   |
| **Keyboard**   | Drag modifier and every Anvil accelerator                                                                                                      |
| **Windows**    | Persistent floating-window application rules                                                                                                   |
| **Monitors**   | Visual monitor selection and per-connector size constraints                                                                                    |

Preference search is enabled, so you can search by a setting's visible label.

## Where settings are stored

Most options use the `org.gnome.shell.extensions.anvil` GSettings schema. Keyboard accelerators use `org.gnome.shell.extensions.anvil.keybindings`.

Two editable files live under the user configuration directory:

```text
~/.config/anvil/config/windows.json
~/.config/anvil/stylesheet/anvil/stylesheet.css
```

Changes are generally applied to the running extension immediately. A Shell restart may still be useful after replacing the installed extension package or recovering from invalid custom CSS.
