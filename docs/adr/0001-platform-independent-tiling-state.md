# Use a platform-independent Tiling State

Anvil will introduce a new platform-independent Tiling State keyed exclusively by Tiling Identity
and retire the existing GObject-based Tree as the authoritative model. We will not remove GNOME
dependencies from the existing Node hierarchy in place: it combines logical topology with live
windows, actors, settings, and presentation state, while a new model makes the Anvil Runtime
boundary structural and keeps GNOME objects outside the Tiling State Machine.

The Tiling State Machine is the sole owner of that state, its revision sequence, event ordering,
and event processing. Anvil Runtime translates user commands and GNOME observations into
platform-independent Tiling Events and applies returned Tiling Intentions, but it cannot mutate
Tiling State directly. The state machine may derive Reconciliation Events from submitted Platform
Facts.

Event processing uses commit-first semantics: each synchronous Tiling Transition commits its state
and revision before returning Tiling Intentions to Anvil Runtime. Delayed, clamped, or failed GNOME
effects never roll the committed state back. Runtime reports observed outcomes as Platform Facts,
allowing the state machine to reconcile persistent divergence in a later transition.
