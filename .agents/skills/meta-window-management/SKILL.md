---
name: meta-window-management
description: Window manipulation with Meta library — placing, resizing, moving, and managing windows for GNOME Shell tiling
license: MIT
compatibility: agents
---

# Meta Window Management

Deep reference for the Mutter/Meta library as it pertains to window management — placing, resizing, moving, focus navigation, workspace management, and stacking. This is the foundation of the Anvil tiling extension.

## Architecture

| Class                   | Access                                               | Role                                                                                   |
| ----------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `Meta.Display`          | `global.display`                                     | The display singleton — monitor info, window focus, tab lists, keybinding registration |
| `Meta.Window`           | Returned by display methods, window tracking signals | Core window object — move, resize, focus, maximize, workspace change                   |
| `Meta.WindowActor`      | `actor.get_meta_window()`                            | Clutter scene-graph wrapper for a Meta.Window — freeze/thaw geometry updates           |
| `Meta.Workspace`        | `workspaceMgr.get_workspace_by_index(n)`             | Individual workspace — work area, window listing, activation                           |
| `Meta.WorkspaceManager` | `global.workspace_manager`                           | Workspace management — active workspace, list, create, remove                          |
| `Mtk.Rectangle`         | Returned by geometry methods                         | Geometry struct — `x`, `y`, `width`, `height` with utility methods                     |

## Meta.Window

The core window object. All window operations in Anvil go through this class.

### Geometry query

```ts
const rect = metaWindow.get_frame_rect(); // Mtk.Rectangle — outer bounds
const workArea = metaWindow.get_work_area_current_monitor();
const monitor = metaWindow.get_monitor(); // number — monitor index
```

### Moving and resizing

Use `move_resize_frame` for a single atomic operation (preferred over `move_frame` + separate resize):

```ts
// Move AND resize — outer frame bounds (src/lib/extension/anvil-runtime.ts:1041)
metaWindow.move_resize_frame(true, x, y, width, height);

// Move only — useful for window repositioning without size change
metaWindow.move_frame(true, x, y);

// Move to a different monitor
metaWindow.move_to_monitor(monitorIndex);
```

### Focus and activation

```ts
// Activate (focus + raise) — most common pattern
metaWindow.activate(global.display.get_current_time());

// Focus only
metaWindow.focus(global.display.get_current_time());

// Raise in stacking order
metaWindow.raise();

// Lower in stacking order
metaWindow.lower();
```

### Maximization

```ts
import Meta from "gi://Meta";

// Check state
const isMaximized = metaWindow.is_maximized();

// Partially unmaximize before tiling (src/lib/extension/anvil-runtime.ts:848-850)
metaWindow.set_unmaximize_flags(Meta.MaximizeFlags.BOTH);
metaWindow.unmaximize(Meta.MaximizeFlags.BOTH);
```

### Stacking and floating

```ts
// Always-on-top (src/lib/extension/anvil-runtime.ts:594, src/lib/extension/tree.ts:594)
metaWindow.make_above();
metaWindow.unmake_above();
const isAbove = metaWindow.is_above();
```

### Workspace operations

```ts
// Move window to a workspace
metaWindow.change_workspace(workspace);
metaWindow.change_workspace_by_index(index, false);

// Query current workspace
const ws = metaWindow.get_workspace();
```

### Key properties

| Property          | Type              | Use                                            |
| ----------------- | ----------------- | ---------------------------------------------- |
| `title`           | `string`          | Window title                                   |
| `wm_class`        | `string \| null`  | WM_CLASS — used for floating override matching |
| `window_type`     | `Meta.WindowType` | Filter for tiling eligibility                  |
| `mapped`          | `boolean`         | Whether the window is mapped to the screen     |
| `above`           | `boolean`         | Always-on-top state                            |
| `minimized`       | `boolean`         | Minimized state                                |
| `resizeable`      | `boolean`         | Whether resizable                              |
| `fullscreen`      | `boolean`         | Fullscreen state                               |
| `appears_focused` | `boolean`         | Visual focus indicator                         |

### Capability queries

```ts
metaWindow.allows_move(); // Can the window be moved?
metaWindow.allows_resize(); // Can the window be resized?
metaWindow.can_close(); // Can it be closed?
metaWindow.can_maximize(); // Can it be maximized?
```

### Window type filtering for tiling

Anvil only tiles normal application windows (src/lib/extension/anvil-runtime.ts:1712-1720):

```ts
import Meta from "gi://Meta";

const windowType = metaWindow.window_type;
const tileable = windowType === Meta.WindowType.NORMAL || windowType === Meta.WindowType.MODAL_DIALOG || windowType === Meta.WindowType.DIALOG;
```

### Transient / parent relationships

```ts
metaWindow.get_transient_for(); // Parent window or null
metaWindow.is_attached_dialog(); // Whether attached to parent
metaWindow.has_attached_dialogs(); // Whether has children
```

## Meta.GrabOp

Describes window move/resize operations triggered by keyboard or mouse. Anvil uses grab ops extensively for keyboard-driven tiling (src/lib/extension/utils.ts:233-316, src/lib/extension/keybindings.ts).

### Mouse grab values

| Value                                                         | Meaning                            |
| ------------------------------------------------------------- | ---------------------------------- |
| `NONE`                                                        | No grab                            |
| `MOVING`                                                      | Moving with pointer                |
| `MOVING_UNCONSTRAINED`                                        | Moving without monitor constraints |
| `RESIZING_N` / `RESIZING_S` / `RESIZING_E` / `RESIZING_W`     | Edge resize                        |
| `RESIZING_NW` / `RESIZING_NE` / `RESIZING_SW` / `RESIZING_SE` | Corner resize                      |

### Keyboard grab values

| Value                                                                                             | Meaning                         |
| ------------------------------------------------------------------------------------------------- | ------------------------------- |
| `KEYBOARD_MOVING`                                                                                 | Keyboard move                   |
| `KEYBOARD_RESIZING_UNKNOWN`                                                                       | Keyboard resize (direction tbd) |
| `KEYBOARD_RESIZING_N` / `KEYBOARD_RESIZING_S` / `KEYBOARD_RESIZING_E` / `KEYBOARD_RESIZING_W`     | Edge resize                     |
| `KEYBOARD_RESIZING_NW` / `KEYBOARD_RESIZING_NE` / `KEYBOARD_RESIZING_SW` / `KEYBOARD_RESIZING_SE` | Corner resize                   |

### Grab-to-direction mapping (src/lib/extension/utils.ts:334-344)

```ts
import Meta from "gi://Meta";

function directionFromGrab(grabOp: Meta.GrabOp): Meta.MotionDirection | undefined {
  if (grabOp === Meta.GrabOp.KEYBOARD_RESIZING_N) return Meta.MotionDirection.UP;
  if (grabOp === Meta.GrabOp.KEYBOARD_RESIZING_S) return Meta.MotionDirection.DOWN;
  if (grabOp === Meta.GrabOp.KEYBOARD_RESIZING_W) return Meta.MotionDirection.LEFT;
  if (grabOp === Meta.GrabOp.KEYBOARD_RESIZING_E) return Meta.MotionDirection.RIGHT;
  return undefined;
}
```

### Starting a grab operation

```ts
metaWindow.begin_grab_op(
  Meta.GrabOp.KEYBOARD_RESIZING_E,
  null, // Clutter.Sprite — null for keyboard grabs
  timestamp, // global.display.get_current_time()
  null // Graphene.Point — position hint, null for keyboard
);
```

## Meta.MotionDirection

Directional navigation for focus movement and window swapping.

| Value        | Use              |
| ------------ | ---------------- |
| `UP`         | Move focus up    |
| `DOWN`       | Move focus down  |
| `LEFT`       | Move focus left  |
| `RIGHT`      | Move focus right |
| `UP_LEFT`    | Diagonal         |
| `UP_RIGHT`   | Diagonal         |
| `DOWN_LEFT`  | Diagonal         |
| `DOWN_RIGHT` | Diagonal         |

### Used in tree navigation (src/lib/extension/tree.ts:820)

```ts
import Meta from "gi://Meta";

// Move focus in a direction — returns the next node or null
const nextNode = tree.focus(currentNode, Meta.MotionDirection.RIGHT);

// Swap windows (src/lib/extension/tree.ts:1181)
tree.swap(node, Meta.MotionDirection.LEFT);
```

## Meta.Display

The display singleton — accessed via `global.display`. In TypeScript code, always cast:

```ts
const display = global.display as Meta.Display;
```

### Monitor geometry

```ts
// Get monitor rect (src/lib/extension/anvil-runtime.ts:955)
const monitorRect = display.get_monitor_geometry(monitorIndex);

// Neighbor monitor (src/lib/extension/utils.ts:1080)
const neighborIndex = display.get_monitor_neighbor_index(monitorIndex, Meta.DisplayDirection.RIGHT);

// Counts and sizes
const nMonitors = display.get_n_monitors();
const [totalW, totalH] = display.get_size();
const primaryMonitor = display.get_primary_monitor();
```

### Window queries

```ts
// Currently focused window
const focusWindow = display.get_focus_window();

// All windows in tab-switching order (src/lib/extension/anvil-runtime.ts:934-937)
const windowsAll = display.get_tab_list(Meta.TabList.NORMAL_ALL, workspace);

// Stacking order
const sorted = display.sort_windows_by_stacking(windows);

// Current timestamp for operations
const time = display.get_current_time();
```

### Keybinding registration

```ts
// Register a keybinding (src/lib/extension/keybindings.ts:116-117)
const action = display.grab_accelerator(accelerator, Meta.KeyBindingFlags.NONE);

// Release
display.ungrab_accelerator(action);
```

## Meta.WorkspaceManager

Accessed via `global.workspace_manager`:

```ts
const wsm = global.workspace_manager as Meta.WorkspaceManager;

// Active workspace
const activeIndex = wsm.get_active_workspace_index();
const activeWs = wsm.get_workspace_by_index(activeIndex);

// Total count
const nWorkspaces = wsm.get_n_workspaces();

// Create/remove
const newWs = wsm.append_new_workspace(true); // true = activate immediately
wsm.remove_workspace(workspace, timestamp);
```

### Signal: workspace switched

```ts
wsm.connect("workspace-switched", (_wsm, from, to, direction) => {
  // from: number — source workspace index
  // to: number — destination workspace index
  // direction: Meta.MotionDirection — direction of the switch
});
```

## Meta.Workspace

```ts
const ws = wsm.get_workspace_by_index(index);

// Work area (in screen coordinates)
const workArea = ws.get_work_area_all_monitors();

// Windows on this workspace
const windows = ws.list_windows();

// Activation
ws.activate_with_focus(window, global.display.get_current_time());

// Neighbor workspace
const neighbor = ws.get_neighbor(Meta.MotionDirection.RIGHT);
```

## Meta.MaximizeFlags

Used for partial maximize/unmaximize:

| Flag         | Value                                    |
| ------------ | ---------------------------------------- |
| `HORIZONTAL` | Maximized horizontally                   |
| `VERTICAL`   | Maximized vertically                     |
| `BOTH`       | Fully maximized (HORIZONTAL \| VERTICAL) |

```ts
// Unmaximize before tiling (src/lib/extension/anvil-runtime.ts:848-850)
metaWindow.set_unmaximize_flags(Meta.MaximizeFlags.BOTH);
metaWindow.unmaximize(Meta.MaximizeFlags.BOTH);

// Partially unmaximize
metaWindow.unmaximize(Meta.MaximizeFlags.HORIZONTAL);
```

## Meta.TabList

Controls which windows appear in the tab-switching list:

| Value            | Windows included                                                            |
| ---------------- | --------------------------------------------------------------------------- |
| `NORMAL`         | Normal windows                                                              |
| `DOCKS`          | Dock windows                                                                |
| `GROUP`          | Window groups                                                               |
| `NORMAL_ALL`     | All normal windows — used by anvil (src/lib/extension/anvil-runtime.ts:934) |
| `NORMAL_ALL_MRU` | All normal windows in MRU order                                             |

```ts
const windows = display.get_tab_list(Meta.TabList.NORMAL_ALL, workspace);
```

## Meta.KeyBindingFlags

Used when registering keybindings with `grab_accelerator`:

| Flag                | Use                                                         |
| ------------------- | ----------------------------------------------------------- |
| `NONE`              | Default behavior — used by anvil for all custom keybindings |
| `IGNORE_AUTOREPEAT` | Don't repeat on key hold                                    |
| `PER_WINDOW`        | Binding is per-window                                       |

## Mtk.Rectangle

Not in the `Meta` namespace but essential for geometry. Returned by all Meta.Window geometry methods.

```ts
const rect = metaWindow.get_frame_rect();

// Fields
rect.x;
rect.y;
rect.width;
rect.height;

// Utility methods
rect.contains_point(x, y); // boolean — point containment
rect.overlap(otherRect); // boolean — overlap check
rect.area(); // number — total area
rect.copy(); // Mtk.Rectangle — deep copy
const [ok, intersect] = rect.intersect(otherRect);
const union = rect.union(otherRect);
```

## Common Patterns

### Global object access with TypeScript

```ts
// Display singleton (src/lib/extension/anvil-runtime.ts)
const display = global.display as Meta.Display;

// Workspace manager
const wsm = global.workspace_manager as Meta.WorkspaceManager;
```

### Signal connection

Meta objects are GObjects — connect and disconnect follow standard GObject patterns:

```ts
// Connect (src/lib/extension/anvil-runtime.ts:1521)
const windowSignals = [];
windowSignals.push(metaWindow.connect("size-changed", () => { ... }));
windowSignals.push(metaWindow.connect("position-changed", () => { ... }));

// Disconnect (src/lib/extension/anvil-runtime.ts:1567)
for (const signal of windowSignals) {
  metaWindow.disconnect(signal);
}
```

Key signals for window tracking:

- `"position-changed"` — window moved
- `"size-changed"` — window resized
- `"workspace-changed"` — window moved to different workspace
- `"unmanaging"` — window about to be destroyed (cleanup opportunity)
- `"focus"` — window gained focus

### Window → actor → window chain

```ts
// From Meta.Window to Clutter.Actor
const actors = global.get_window_actors(); // Clutter.Actor[]
for (const actor of actors) {
  const metaWindow = (actor as Meta.WindowActor).get_meta_window();
}

// From Clutter.Actor to Meta.Window directly
const metaWindow = (actor as Meta.WindowActor).get_meta_window();

// From node tree to window to actor back (src/lib/extension/anvil-runtime.ts:1722)
const windowActor = (actor as Meta.WindowActor).get_meta_window();
```

### Freeze / thaw for batched updates

When performing multiple geometry changes in rapid succession, freeze the actor to prevent redundant relayouts:

```ts
const actor = global.get_window_actors().find(a => ...);
(actor as Meta.WindowActor).freeze();   // Begin batch
// ... perform move/resize operations ...
(actor as Meta.WindowActor).thaw();     // Apply accumulated changes
```

## Putting It Together

A complete window tiling flow from anvil's codebase (src/lib/extension/anvil-runtime.ts:1286-1365):

```ts
import Meta from "gi://Meta";

function showWindowBorders() {
  const display = global.display as Meta.Display;

  for (const windowActor of global.get_window_actors()) {
    const metaWindow = (windowActor as Meta.WindowActor).get_meta_window();
    if (!metaWindow) continue;

    // Skip non-tileable windows
    const windowType = metaWindow.window_type;
    if (windowType !== Meta.WindowType.NORMAL && windowType !== Meta.WindowType.MODAL_DIALOG && windowType !== Meta.WindowType.DIALOG) continue;

    // Unmaximize if needed before tiling
    if (metaWindow.is_maximized()) {
      metaWindow.set_unmaximize_flags(Meta.MaximizeFlags.BOTH);
      metaWindow.unmaximize(Meta.MaximizeFlags.BOTH);
    }

    // Move and resize atomically
    const targetRect = calculateTileRect(metaWindow); // Mtk.Rectangle
    metaWindow.move_resize_frame(true, targetRect.x, targetRect.y, targetRect.width, targetRect.height);
  }
}
```
