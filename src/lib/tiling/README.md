# Tiling

> [!WARNING]
> This library is experimental. It is not yet the default source of tiling behavior in Anvil, and
> its contracts and implementation may change while the migration is in progress.

This directory contains Anvil's platform-independent tiling library. We are building a
deterministic, event-driven state machine that owns the logical tiling state and decides how
windows should be arranged without depending on GNOME Shell, Mutter, GJS, or live window objects.

The goal is to separate tiling decisions from platform integration:

```text
platform events and observations
              |
              v
      TilingStateMachine
       state + policy
       layout + geometry
       active operations
       reconciliation
              |
              v
   platform-neutral intentions
```

Anvil's GNOME-aware runtime translates commands and observations into plain `TilingEvent` data,
dispatches those events to the state machine, and applies the returned `TilingIntention` values.
It then reports observed results back as `PlatformFact` values. The library never imports or
controls GNOME APIs directly.

## What this library is intended to provide

- One authoritative owner for tiling topology, policy, operations, and revision ordering.
- Deterministic behavior from an initial policy and an ordered sequence of events.
- Plain, immutable, JSON-compatible inputs and diagnostic snapshots.
- A complete `TilingRenderPlan` plus the changed intentions needed to present it.
- Tiling logic that can be tested in a normal ES2022 runtime without GNOME mocks.
- A boundary that could eventually support another window-manager adapter.

The public entry point is [`index.ts`](./index.ts). Its primary interface is deliberately small:

```ts
const machine = createTilingStateMachine(initialPolicy);

const transition = machine.dispatch(event);
const inspection = machine.inspect();
```

`dispatch()` is the only way to change authoritative tiling state. Each event commits a new
transition before its intentions are returned. Applying those intentions is the adapter's job;
platform failures or geometry clamps are reported in later observations rather than rolling the
state transition back.

## Boundary

Code in this directory may use ES2022 features and relative imports within the library. It must not
depend on GNOME, GJS, Mutter, Shell, GSettings, actors, timers, the filesystem, or Node-specific
APIs. Platform-aware code belongs in [`../extension/`](../extension/).

Callers should import from [`index.ts`](./index.ts) rather than reaching into implementation files.
The internal modules may be reorganized as the experiment evolves.

## Status and design documents

This is a behavioral replacement for the existing GNOME-coupled tiling implementation, not an
in-place cleanup of the legacy tree. Migration is incremental and reversible; replacing the
production implementation requires a separately approved cutover.

The accepted boundary and migration details are documented in:

- [`docs/adr/0001-platform-independent-tiling-state.md`](../../../docs/adr/0001-platform-independent-tiling-state.md)
- [`docs/plans/portable-tiling-state-machine.md`](../../../docs/plans/portable-tiling-state-machine.md)
- [`CONTEXT.md`](../../../CONTEXT.md)
