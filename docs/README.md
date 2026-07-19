# Anvil manual

Anvil is a tree-based tiling window manager implemented as a GNOME Shell extension. This manual is organized around tasks and user-facing features; each feature has a focused page that explains what it does, how to use it, and which preferences affect it.

## Contents

- [Start here](#start-here)
- [Layouts](#layouts)
- [Window control](#window-control)
- [Desktop integration](#desktop-integration)
- [Appearance](#appearance)
- [Project documentation](#project-documentation)

## Start here

| Guide                                                  | What it covers                                                           |
| ------------------------------------------------------ | ------------------------------------------------------------------------ |
| [Automatic tiling](features/automatic-tiling.md)       | How Anvil places new windows and maintains its tiling tree               |
| [Keybindings](keybindings.md)                          | Every default shortcut, customization, and GNOME shortcut Anvil disables |
| [Keyboard navigation](features/keyboard-navigation.md) | Focus, move, swap, close, and last-active-window controls                |
| [Preferences](features/preferences.md)                 | Where settings live and how preference changes are applied               |

## Layouts

| Feature                                     | Guide                                                  |
| ------------------------------------------- | ------------------------------------------------------ |
| Horizontal and vertical containers          | [Split layouts](features/split-layouts.md)             |
| Automatic quarter-style placement           | [Automatic splitting](features/automatic-splitting.md) |
| Overlapping windows with visible title bars | [Stacked layout](features/stacked-layout.md)           |
| Windows grouped as tabs                     | [Tabbed layout](features/tabbed-layout.md)             |
| Pointer-driven placement and layout changes | [Drag and drop](features/drag-and-drop.md)             |

## Window control

| Feature                                       | Guide                                              |
| --------------------------------------------- | -------------------------------------------------- |
| Persistent and per-window floating            | [Floating windows](features/floating-windows.md)   |
| Keyboard and pointer resizing                 | [Window resizing](features/window-resizing.md)     |
| One-third, two-thirds, and centered placement | [Snap layouts](features/snap-layouts.md)           |
| Focus follows pointer and pointer warping     | [Focus and pointer](features/focus-and-pointer.md) |

## Desktop integration

| Feature                                        | Guide                                              |
| ---------------------------------------------- | -------------------------------------------------- |
| Tiling policy per workspace                    | [Workspaces](features/workspaces.md)               |
| Independent monitor trees and size constraints | [Multiple monitors](features/multiple-monitors.md) |
| Fast controls in the system menu               | [Quick Settings](features/quick-settings.md)       |

## Appearance

| Feature                                         | Guide                                                |
| ----------------------------------------------- | ---------------------------------------------------- |
| Inner gaps and single-window gap behavior       | [Gaps](features/gaps.md)                             |
| Borders, colors, corners, previews, and shadows | [Appearance](features/appearance.md)                 |
| Advanced CSS overrides and update recovery      | [Custom stylesheets](features/custom-stylesheets.md) |

## Project documentation

- [Development and contributing](development.md)
- [Testing guide](testing/README.md)
- [Credits](project/credits.md)
- [Architecture decisions](adr/)
- [Portable tiling state-machine plan](plans/portable-tiling-state-machine.md)
- [Installed-package smoke checklist](testing/installed-package-smoke.md)
- [Stylesheet versioning contract](theme/stylesheet-versioning.md)
