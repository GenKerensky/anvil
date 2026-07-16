# Product and Design Follow-ups

This backlog owns ideas and design questions that are not confirmed defects or active technical
debt. Each item names the responsible boundary and the condition for reconsidering it so production
code does not carry ambiguous `TODO` markers.

## Appearance: independent preview-hint color

- **Owner:** Preferences appearance UI and the stylesheet/theme managers.
- **Why deferred:** The preview hint currently shares established theme tokens; a new selector needs
  a product decision about defaults, migration, and whether it is user CSS or GSettings state.
- **Next decision point:** When appearance customization is next expanded or a user-facing request
  defines the desired color contract.

## Persistence: restore a legacy Tree from JSON

- **Owner:** Tiling-state persistence design, not `AnvilRuntime` or legacy `Tree` reload scheduling.
- **Why deferred:** The existing reload operation rebuilds observed GNOME topology. Adding a second
  serialized legacy-state source would conflict with the portable state-machine migration unless a
  durable persistence contract is designed first.
- **Next decision point:** When session/layout persistence is prioritized in the portable-core plan.

## Overview transition thrash guards

- **Owner:** `SignalManager` for Shell overview events and `PointerPolicy` for focus behavior.
- **Why deferred:** The removed flags had no readers and there is no current reproducible overview
  transition defect. Reintroducing speculative state would violate one-owner and unused-code rules.
- **Next decision point:** A reproducible focus/render regression identifies the exact transition
  that needs suppression and supplies an E2E case.

## Tree Node GObject property declarations

- **Owner:** Legacy `Node` structural representation.
- **Why deferred:** The fields are internal TypeScript state and do not currently participate in
  GObject property binding or introspection. Converting them provides no behavior or interface
  improvement while the legacy tree is scheduled for eventual retirement.
- **Next decision point:** A GNOME/GJS upgrade requires registered properties, or the Node API is
  otherwise redesigned before retirement.

## Contributor metadata from a remote source

- **Owner:** Release/build tooling.
- **Why deferred:** Metadata is generated deterministically from the local Git history. Network
  fetching would make normal builds non-hermetic and introduces authentication and availability
  failure modes without a current release requirement.
- **Next decision point:** Release provenance requirements identify information unavailable from the
  checked-out repository and specify a reproducible cache/fallback policy.
