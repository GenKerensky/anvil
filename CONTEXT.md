# Anvil

A GNOME Shell tiling extension that arranges windows in a hierarchical layout tree and keeps geometry in sync with Mutter.

## Language

**Tiling Tree**:
The hierarchical structure of containers and participating tiled windows that Anvil uses to decide
one Tiling Surface's layout.
_Avoid_: DOM tree, widget tree, scene graph

**Node**:
A single element in the Tiling Tree — a container or participating tiled window.
_Avoid_: Element, item, tree entry

**Pointer Policy**:
The rules that decide whether the mouse cursor warps when focus changes, including keyboard focus, workspace transitions, and overview exit.
_Avoid_: cursor manager, pointer service, focus-follows-mouse

**Tiling Render**:
The deterministic derivation that turns Tiling State, Tiling Policy, and surface facts into a Tiling
Render Plan. Anvil Runtime applies the resulting Tiling Intentions.
_Avoid_: repaint, redraw, layout pass (too generic)

**Tiling State Machine**:
The authoritative owner of Tiling State and its revision sequence. It processes Tiling Events in
order and produces the next Tiling Tree together with the Tiling Intentions required to present it.
_Avoid_: reducer, layout engine, pure tiling core

**Tiling State**:
The authoritative, platform-independent snapshot held by the Tiling State Machine. Every entity in
it is referenced by Tiling Identity, and it contains no live platform objects.
_Avoid_: runtime cache, GNOME model, serialized Tree

**Tiling Event**:
A platform-independent input that may change authoritative tiling state. Anvil Runtime submits
events derived from user commands and Platform Facts; the Tiling State Machine alone processes
them and may derive Reconciliation Events.
_Avoid_: AnvilAction, callback, Meta signal

**Tiling Transition**:
The atomic result of processing one Tiling Event. It commits the next Tiling State and Tiling
Revision before yielding the changed Tiling Intentions for Anvil Runtime to apply.
_Avoid_: callback, transaction rollback, render pass

**Tiling Policy**:
The authoritative policy values that govern tiling transitions, including layout availability,
gaps, constraints, automatic splitting, and global or per-surface tiling.
_Avoid_: GSettings, preferences, presentation settings

**Tiling Intention**:
A requested platform effect produced by the Tiling State Machine, such as applying a changed
window frame or changing container presentation. It belongs to a committed Tiling Revision;
delayed, clamped, or failed application never rolls that revision back.
_Avoid_: side effect, callback, command

**Tiling Render Plan**:
The complete desired geometry and tiling presentation derived for a Tiling Revision from the
authoritative state, Tiling Policy, and current Tiling Surface facts. The plan is available for
diagnostics and reconciliation; Anvil Runtime normally applies only its changed Tiling Intentions.
_Avoid_: observed frames, actor state, incremental patch, Mutter layout

**Tiling Identity**:
An opaque, session-local identity by which the Tiling State Machine knows a window, surface,
container, or operation. Anvil Runtime maps platform-backed identities to live objects without
exposing those objects or the composition of a Tiling Surface to Tiling State.
_Avoid_: Meta ID, workspace index, monitor connector, composite location string

**Tiling Participation**:
Whether a known window currently belongs to exactly one active Tiling Tree. A window may retain a
tiling policy decision while effectively not participating during surface loss; Anvil Runtime owns
all behavior while it does not participate.
_Avoid_: floating mode, exempt window, skipped Node

**Tiling Availability**:
Whether a participating window currently contributes to layout geometry. Minimized or
platform-suspended windows retain logical placement but consume no active allocation.
_Avoid_: Tiling Participation, visibility actor state, floating mode

**Tiling Placement Hint**:
An opaque, advisory description of a window's former logical position in the Tiling Tree. It may
restore that position on re-admission when the referenced topology still exists.
_Avoid_: saved Node, floating position, mandatory insertion point

**Tiling Operation**:
A platform-neutral, reversible tiling interaction in progress, such as resize or drag placement.
Anvil Runtime owns the platform mechanics that produce its updates.
_Avoid_: Meta GrabOp, pointer session, GLib loop

**Tiling Revision**:
A session-local identity that orders authoritative Tiling Tree transitions and relates their Tiling
Intentions to later Platform Facts.
_Avoid_: timestamp, Wayland serial, persisted version

**Tiling Selection**:
The selected participating child of a stacked or tabbed container. Tiling Selection affects tiling
presentation but is distinct from compositor focus.
_Avoid_: focused window, active Meta window, pointer target

**Tiling Surface**:
A window-manager-defined rectangular tiling coordinate space where one Tiling Tree layout is
presented. Its composition is opaque to the core: it may represent one output region, a workspace
spanning outputs, or another placement space chosen by the adapter.
_Avoid_: monitor-workspace Node, composite location string, physical output

**Surface Evacuation Hint**:
A session-local, inactive advisory record of topology removed from an unavailable Tiling Surface.
It enables eligible windows to return without becoming a second active Tiling Tree.
_Avoid_: persisted layout, duplicate Tiling Tree, mandatory restoration

**Platform Fact**:
A normalized observation from Anvil Runtime about a Tiling Surface, window, or applied platform
effect. Platform Facts never contain live GNOME objects or surface-composition details and may
report the observed result of an earlier Tiling Intention.
_Avoid_: Meta object, global state, platform event

**Reconciliation Event**:
A tiling event derived from Platform Facts when the observed platform state persistently differs
from the authoritative Tiling Tree.
_Avoid_: rollback, retry callback, corrective side effect

**Workspace Transition**:
The period between an active-workspace change and shell animation settle, during which hover-focus and pointer rules are guarded.
_Avoid_: workspace switch handler, ws change event

**Grab-Resize**:
A user drag-resize of a tiled window that redistributes space between adjacent windows in the tree.
_Avoid_: window resize, mutter grab

**Anvil Runtime**:
The active, GNOME-aware tiling system that owns subsystem composition, platform adapters, and
coordinated enable/disable lifecycle around the Tiling State Machine.
_Avoid_: window manager, global controller, Tiling State Machine

## Tree / render invariants

1. Every participating window belongs to exactly one **Tiling Surface**.
2. After redistribute, tiled sibling **percents** sum to ~1. Unset = `undefined` (equal share).
3. Every window in the Tiling Tree participates in tiled layout; non-participating windows are absent.
4. **Tiling Render** is the only path that writes frame geometry (constraints clamp applied rects).
5. User actions are **AnvilAction** values handled by **CommandBus**.

See `.agents/rules/architecture.md` (agent rules), `.agents/context/architecture.md`
(seams map), and `.agents/memory/decisions.md` (historical decisions).
