# Anvil

A GNOME Shell tiling extension that arranges windows in a hierarchical layout tree and keeps geometry in sync with Mutter.

## Language

**Tiling Tree**:
The hierarchical structure of workspaces, monitors, containers, and windows that Anvil uses to decide layout.
_Avoid_: DOM tree, widget tree, scene graph

**Node**:
A single element in the Tiling Tree — a workspace, monitor, container, or tiled window.
_Avoid_: Element, item, tree entry

**Pointer Policy**:
The rules that decide whether the mouse cursor warps when focus changes, including keyboard focus, workspace transitions, and overview exit.
_Avoid_: cursor manager, pointer service, focus-follows-mouse

**Tiling Render**:
The pipeline that turns the Tiling Tree into on-screen window rectangles — float classification, layout geometry, gaps, monitor constraints, and apply.
_Avoid_: repaint, redraw, layout pass (too generic)

**Workspace Transition**:
The period between an active-workspace change and shell animation settle, during which hover-focus and pointer rules are guarded.
_Avoid_: workspace switch handler, ws change event

**Grab-Resize**:
A user drag-resize of a tiled window that redistributes space between adjacent windows in the tree.
_Avoid_: window resize, mutter grab

**Anvil Runtime**:
The active, GNOME-aware tiling system that owns subsystem composition, the Tiling Tree, and
coordinated enable/disable lifecycle.
_Avoid_: window manager, global controller, pure tiling core

## Tree / render invariants

1. Every **WINDOW** node has a **MONITOR** ancestor.
2. After redistribute, tiled sibling **percents** sum to ~1. Unset = `undefined` (equal share).
3. **FLOAT** windows may sit in the tree but skip size compute.
4. **Tiling Render** is the only path that writes frame geometry (constraints clamp applied rects).
5. User actions are **AnvilAction** values handled by **CommandBus**.

See `.agents/rules/architecture.md` (agent rules), `.agents/context/architecture.md`
(seams map), and `codebase-review.md` (historical review).
