# Portable Tiling State Machine design and migration plan

**Status:** Experimental implementation; not approved as the default runtime

**Date:** 2026-07-13

**Scope:** Isolate Anvil's tiling decisions into a platform-independent, event-driven module without
GNOME, GJS, Mutter, Shell, GSettings, actor, timer, or filesystem dependencies.

## Outcome

> **Workstream boundary:** This document describes a separate experimental line of work. The
> production runtime remains authoritative. Portable-core development, default cutover, and legacy
> retirement must not be bundled into production bug fixes or broad cleanup work.

Anvil will gain one deep module, `TilingStateMachine`, that owns authoritative tiling state and
turns platform-independent events into committed revisions, changed intentions, and a queryable
render plan. `AnvilRuntime` will remain GNOME-aware and become the module's production adapter.

The module must be usable in a plain ES2022 JavaScript runtime. Another window manager could reuse
it by supplying its own identity registry, fact normalizer, policy translator, command translator,
and intention applier.

This is a behavioral replacement, not an attempt to remove GNOME fields from the existing
GObject-based `Tree` in place.

## Accepted decisions

These decisions are accepted:

1. The core uses a new platform-independent `TilingState`; retiring the current `Tree` is a future
   possibility requiring a separately accepted cutover plan, not an approved current action.
2. The state machine is the sole owner of Tiling State, revision ordering, and event processing.
3. Runtime observes GNOME and submits normalized events. It cannot mutate Tiling State directly.
4. Transitions commit synchronously before Runtime applies their intentions.
5. Delayed, clamped, or failed platform effects never roll a revision back. Runtime reports what
   happened as later Platform Facts, and persistent divergence is reconciled later.
6. `SurfaceId` is the core's sole placement-space identity. The adapter defines what comprises a
   Surface and translates its local geometry; no workspace, monitor, or output identity crosses the
   boundary.

The first three decisions are recorded in
[`docs/adr/0001-platform-independent-tiling-state.md`](../adr/0001-platform-independent-tiling-state.md).

The surface-rooted tree and separation of structural order from selection are recorded for review
as proposed
[`docs/adr/0002-surface-rooted-tiling-tree.md`](../adr/0002-surface-rooted-tiling-tree.md).

## Goals

- Put all logical topology, participation, layout, geometry, selection, resize, drag placement,
  policy evaluation, and reconciliation decisions behind one small interface.
- Make tiling behavior deterministic from an initial policy plus an ordered event log.
- Keep live platform objects and side effects entirely outside the module.
- Make ordinary tiling behavior testable in Node without GNOME mocks.
- Preserve Anvil's user-visible behavior through an incremental, reversible migration.
- Remove the legacy Tree/Layout/Render write paths after cutover.
- Make later extraction into a package possible without designing a package release now.

## Non-goals

- Supporting another window manager during this migration.
- Persisting layouts or replaying event logs across sessions.
- Replacing `AnvilRuntime`, extension lifecycle, keybindings, preferences, borders, pointer policy,
  or GNOME signal ownership.
- Modeling arbitrary compositor animations.
- Making platform effects transactional. Only Tiling State transitions are atomic.
- Improving every historical layout behavior during extraction. Behavioral changes require a
  separate decision after parity, unless an old behavior violates a new invariant.

## Current problem

The logical tiling behavior exists, but its data and effects are interleaved:

| Current module           | Portable behavior to move                                           | GNOME behavior to retain in Runtime                                     |
| ------------------------ | ------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `tree.ts`                | topology, lookup, normalization, placement hints                    | GObject nodes, Meta windows, St actors, workspace discovery, tab actors |
| `layout-engine.ts`       | split, move, swap, focus graph, shares, size allocation             | Meta directions, focus/raise, frame moves, St container creation        |
| `tiling-render.ts`       | render-plan derivation, gaps, constraints, split/stack/tab geometry | work-area reads, actor validity, frame apply, tab actors                |
| `rules-engine.ts`        | ordered participation-rule evaluation                               | Meta fact extraction, config file writes, logging                       |
| `drag-drop-tile.ts`      | hit regions, placement transaction, preview geometry                | pointer reads and preview actors                                        |
| `grab-resize-session.ts` | reversible resize state and share algebra                           | Meta grab recognition, GLib polling, direct frame apply                 |
| `focus-controller.ts`    | logical selection and directional target                            | activate/raise and delayed render scheduling                            |
| `workspace-mutations.ts` | surface reassignment and evacuation behavior                        | workspace/monitor reads and Meta movement                               |
| `command-handlers.ts`    | tiling command semantics                                            | preferences, closing, settings writes, snap-float behavior              |
| `window-tracker.ts`      | admission/removal semantics                                         | signal lifecycle, actor readiness, Meta fact normalization              |

The existing `TreeHost` seam removes a concrete `AnvilRuntime` import but does not provide platform
independence. `Tree` still stores `Meta.Window`, `St` actors, `Gio.Settings`, and presentation state;
`LayoutEngine` and `TilingRender` still call GNOME and mutate the same nodes.

## Target architecture

```text
GNOME signals / keybindings / GSettings / timers
                    |
                    v
          GNOME fact and command adapters
                    |
                    | TilingEvent (plain data)
                    v
        +--------------------------------+
        |      TilingStateMachine        |
        |                                |
        | state + policy + transitions   |
        | topology + layout + geometry   |
        | operations + reconciliation    |
        +--------------------------------+
             |                    |
             | TilingTransition   | inspect()
             v                    v
       changed intentions    snapshot + full plan
             |
             v
         GNOME intention applier
             |
             v
     Meta.Window / St / Shell effects
             |
             v
    observed-result Platform Facts
```

The seam lives at the `TilingStateMachine` interface. GNOME has one production adapter. Tests do
not need a mock adapter because the module has no effects or injected dependencies; they submit
plain events and inspect plain results directly.

## Source and dependency fence

The module will live under `src/lib/tiling/` rather than `src/lib/extension/`.

```text
src/lib/tiling/
  index.ts                    # the only external export surface
  state-machine.ts
  contracts/                  # events, intentions, policy, geometry, identities
  model/                      # internal state and topology
  transitions/               # internal event handlers
  render/                     # plan derivation and plan diff
  invariants.ts
```

The directory is one module even if its implementation is internally split. Callers and migrated
tests import only `src/lib/tiling/index.ts`.

Enforcement:

1. Add `tsconfig.tiling.json` with `rootDir: src/lib/tiling`, ES2022 libraries, and no GNOME path
   mappings. `tsconfig.src.json` references it and excludes the directory from duplicate emission.
2. Add an ESLint override for `src/lib/tiling/**/*.ts` that rejects:
   - `gi://*` and `resource:///*` imports;
   - imports from `src/lib/extension`, `src/lib/prefs`, or GJS-only shared modules;
   - `global`, `imports`, `log`, `logError`, `print`, and Node built-ins;
   - explicit `any` in the module's contracts.
3. Add `npm run check:tiling-boundary` to compile the isolated project and scan emitted imports.
4. Add a separate Vitest configuration with no GJS aliases or Anvil unit-test setup, expose it as
   `npm run test:tiling`, and include that command in the normal `npm test` gate.

Permitted dependencies are ES2022 language features and relative imports inside `src/lib/tiling/`.
No clock, random generator, scheduler, logger, filesystem, or callback is injected.

## External interface

The caller-facing interface has two operations:

```ts
export interface TilingStateMachine {
  dispatch(event: TilingEvent): TilingTransition;
  inspect(): TilingInspection;
}

export function createTilingStateMachine(initialPolicy: TilingPolicy): TilingStateMachine;
```

`dispatch` is the only state-change ingress. `inspect` returns an immutable, JSON-compatible copy of
the current revision, diagnostic snapshot, and complete render plan. Neither method exposes
internal maps, nodes, mutable references, or transition helpers.

The public exports from `index.ts` are limited to:

- `createTilingStateMachine` and `TilingStateMachine`;
- `TilingEvent`, `TilingTransition`, and `TilingInspection`;
- data contracts needed to construct events or interpret intentions: identities, geometry, policy,
  Platform Facts, Tiling Commands, Tiling Intentions, and diagnostic codes.

No internal transition function, tree primitive, rule helper, geometry helper, or invariant checker
is exported. The interface is also the core unit-test surface.

## Identity model

Use branded, opaque, session-local strings:

```ts
type WindowId = TilingIdentity<"window">;
type SurfaceId = TilingIdentity<"surface">;
type ContainerId = TilingIdentity<"container">;
type OperationId = TilingIdentity<"operation">;
```

Runtime creates opaque identities for platform-backed windows, window-manager-defined surfaces,
and operations and owns their mapping to live platform objects. The state machine becomes the
authoritative semantic owner of each identity after admission and creates only internal container
identities. Supplying an identity is not permission to mutate its state outside `dispatch`.

An adapter must never expose a raw `Meta.Window`, workspace index, monitor index, connector,
composite `mo{n}ws{n}` string, or output membership as the contract. Runtime allocates from
monotonic, kind-specific session registries, so object destruction and later platform-ID reuse
cannot alias an old identity.

Identity invariants:

- Identity values are unique by kind for one state-machine lifetime.
- A retired identity is never reused during that lifetime.
- A platform topology change does not change a Surface identity while the adapter considers the
  same semantic placement space alive; it updates that Surface's facts instead.
- Duplicate discovery of the same live window or adapter-defined Surface lifetime resolves to the
  existing identity in the Runtime identity registry before an event is submitted.
- Snapshot serialization preserves identities but does not promise their stability across enable
  cycles or process restarts.
- Runtime-supplied operation identities are required so late grab updates can be rejected without
  depending on a platform grab enum.

## State model

`TilingState` is private. Its diagnostic projection contains these concepts:

```ts
type TilingState = {
  revision: TilingRevision;
  policy: TilingPolicy;
  surfaces: Map<SurfaceId, SurfaceRecord>;
  windows: Map<WindowId, WindowRecord>;
  containers: Map<ContainerId, ContainerRecord>;
  operations: Map<OperationId, TilingOperation>;
  placementHints: Map<WindowId, TilingPlacementHint>;
  evacuationHints: Map<SurfaceId, SurfaceEvacuationHint>;
  observedEffects: Map<EffectKey, ObservedEffect>;
  renderPlan: TilingRenderPlan;
};
```

### Surfaces and topology

- A `TilingSurface` is a window-manager-defined rectangular tiling coordinate space on which one
  layout is presented.
- Its physical composition is opaque to the state machine. One adapter may use one Surface per
  workspace/output pair; another may use one workspace-spanning Surface across several outputs.
- Surface work areas, window frames, operation points, render-plan rectangles, and geometry
  intentions all use that Surface's local coordinate space. Runtime translates at ingress and
  egress.
- A genuinely non-rectangular or disconnected placement region is represented as multiple
  Surfaces in v1. Supporting a region set is a future geometry-model change, not a reason to expose
  monitor identities.
- Each available surface owns exactly one permanent root container.
- A Tiling Tree contains only containers and participating windows.
- Non-root empty containers are removed after every committed transition.
- A single-child split container collapses when doing so preserves child order and placement.
  Stacked/tabbed single-child containers follow explicit policy: they may retain presentation state
  or exit to a split layout. They are never collapsed unconditionally.
- Parent/child relationships use identities, never object references.
- Children have one stable structural order. Selection and stacking order do not rewrite that
  structural order.

### Windows

The state machine may know a window that is not in any Tiling Tree. A window record contains:

- normalized facts: application identity, title, role, transient parent, capabilities, observed
  frame, assigned surface, and availability;
- policy/manual participation decision, its rule source, and effective participation;
- current parent only when participating;
- manual per-window participation override, if any;
- latest effect observation and causal token;
- placement hint retained across temporary non-participation.

Runtime owns all platform behavior for non-participating windows. The state machine does not emit
tiled frames for them.

A window can retain a policy/manual decision that prefers tiling while being effectively
non-participating because its assigned surface is unavailable. That distinction preserves the
reason it should be restored later without allowing a window outside an available surface to remain
in active topology.

### Availability

Participation and availability are separate:

- `participating`: the window logically belongs to a Tiling Tree;
- `available`: the participating window currently contributes to layout geometry;
- `minimized` or `platform-suspended`: the window remains logically placed but is excluded from
  active size allocation until it becomes available again.

This preserves topology across minimize/fullscreen/platform transitions while allowing visible
siblings to retile. A container is available when any descendant is available.

Surface loss is not window unavailability. It removes the active tree, makes affected windows
effectively non-participating, and records evacuation hints until a valid surface exists again.

### Containers, layouts, shares, and selection

Container layouts are `horizontal`, `vertical`, `stacked`, or `tabbed`. The old `ROOT`, `PRESET`,
`WORKSPACE`, and `MONITOR` node layouts do not cross into the new model.

- Split containers store positive finite child weights. Equal share is represented by missing
  weights, never zero.
- Effective shares are normalized over available children and sum to one within floating-point
  tolerance.
- Stacked/tabbed containers do not use split weights.
- `selectedChildId` is explicit and belongs to the container.
- Compositor focus is an observed fact. Tiling Selection is logical state and does not become a
  synonym for focus.
- Focus changes can update selection but cannot reorder structural children.

This deliberately changes the legacy stacked-focus behavior that appended a focused child to the
structural list. Structural navigation order now stays stable; selection and desired stacking order
carry presentation changes. Phase 0 must approve this difference rather than hide it as an
accidental parity failure.

### Placement and evacuation hints

A `TilingPlacementHint` is advisory data, not a detached Node. It records the former surface,
parent-container identity, nearest before/after sibling anchors, former weight, and selected state.
Restoration tries the former parent, then a surviving sibling anchor on the same surface, then the
surface's selected container, and finally the surface root.

A `SurfaceEvacuationHint` is a session-only, inactive normalized topology fragment for one withdrawn
surface. It is never traversed as a second active tree. It may be restored only when the same
surface identity returns and only for windows whose latest facts still assign them there. Invalid
references are dropped, never fabricated.

Admission has no global mutable `attachNode`. A returning window first uses a valid placement hint.
A newly participating window targets the selected container associated with the latest participating
focus on its assigned surface, otherwise the surface root. An attach target must resolve inside that
same active surface at commit time.

### Operations

Drag placement and resize are reversible `TilingOperation` records:

- `OperationStarted` captures the affected identities, base shares, and affected surface/container
  topology versions
  needed to validate later updates; it does not clone the whole state.
- `OperationUpdated` commits only an operation overlay. Render-plan derivation includes the overlay
  so live resize and preview remain responsive.
- `OperationCommitted` merges the overlay into base state and removes the operation.
- `OperationCancelled` discards the overlay, recomputes the plan from current base state, and
  removes the operation. It never reinstalls a stale whole-state snapshot.
- A window may belong to at most one operation. Anvil's GNOME adapter runs at most one grab, while
  the core model does not require a global single-operation assumption.
- Active operations may coexist only when their affected windows and containers are disjoint.
- Updates for unknown, completed, or cancelled operation identities are ignored diagnostically.
- Any event that withdraws an operation window, removes its surface, or changes the affected
  topology implicitly cancels that operation before applying the new event. An update or commit
  whose recorded affected-topology version no longer matches is rejected rather than rebased
  silently. Unrelated revisions on other surfaces do not invalidate it.

## Platform facts

Runtime converts live platform observations into this union. Facts contain only primitives,
identities, arrays, and records.

| Fact                         | Required content                                                           | Purpose                                          |
| ---------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------ |
| `SurfaceObserved`            | identity, local work area, directional neighbors, capabilities             | define or update one layout coordinate space     |
| `SurfaceWithdrawn`           | identity                                                                   | suspend/evacuate its tree                        |
| `WindowObserved`             | identity, surface, role, capabilities, metadata, local frame, availability | register or update a window atomically           |
| `WindowWithdrawn`            | identity                                                                   | remove the window and normalize topology         |
| `WindowAvailabilityObserved` | identity, availability                                                     | minimize, restore, or platform suspension        |
| `WindowSurfaceObserved`      | window and surface identities                                              | reassign a window's placement space              |
| `FocusObserved`              | optional window identity                                                   | track compositor focus separately from selection |
| `FrameObserved`              | window, surface-local rectangle, optional causal token                     | report actual platform geometry                  |
| `EffectFailed`               | causal token and portable failure code                                     | report an intention that could not be applied    |

Runtime may submit several facts in one `FactsObserved` event. Topology changes that are observed as
one platform action should be batched so the state machine never commits an avoidable half-updated
surface graph.

Directional surface adjacency is an explicit normalized fact. The core does not call a compositor
neighbor query and does not invent a second geometric-neighbor policy. Adapters may derive it from
their private workspace/output model or another platform topology API before submission.

An initial `PlatformSnapshotObserved` event replaces all platform facts atomically and is the only
bootstrap path. The state machine does not enumerate surfaces or windows itself.

Runtime binds/buffers signal ingress before taking the synchronous snapshot, dispatches the
snapshot before applying any core intention, and then drains facts captured during bootstrap. On
disable it stops ingress and clears queued facts before discarding the machine and identity maps.

## Events and commands

The external event union is deliberately grouped:

```ts
type TilingEvent = { type: "PlatformSnapshotObserved"; snapshot: PlatformSnapshot } | { type: "FactsObserved"; facts: readonly PlatformFact[] } | { type: "PolicyReplaced"; policy: TilingPolicy } | { type: "CommandRequested"; command: TilingCommand } | { type: "OperationStarted"; operation: OperationStart } | { type: "OperationUpdated"; operationId: OperationId; update: OperationUpdate } | { type: "OperationCommitted"; operationId: OperationId } | { type: "OperationCancelled"; operationId: OperationId } | { type: "ReconcileRequested"; scope?: ReconcileScope };
```

The state machine does not consume `AnvilAction` directly. Runtime translates only tiling commands:

- focus direction;
- move direction;
- swap direction or swap with previous selection;
- split or toggle split orientation;
- set/toggle stacked or tabbed layout;
- set a window's session participation override;
- set a surface's tiling participation;
- resize by edge and amount;
- apply a drag placement;
- cancel the current operation.

These remain Runtime commands and never enter the state machine:

- open preferences or close a window;
- border, tab-decoration visibility, CSS, quick-settings, or pointer-policy commands;
- persistent window-rule editing;
- GSettings writes;
- snap placement of a non-participating window.

If a non-participation action includes a requested free-window rectangle, Runtime first commits the
participation command and then applies that rectangle under its non-participant ownership. The
rectangle never enters Tiling State or becomes a second tiled-frame writer.

After a successful persistent setting/config write, Runtime submits a `PolicyReplaced` event. The
active policy inside the state machine is authoritative for tiling; GSettings and `windows.json`
remain Runtime's persistence mechanisms.

## Policy

`TilingPolicy` is a complete immutable value. `PolicyReplaced` avoids partial setting order races.
Runtime translates GNOME settings and config data into:

- global and per-surface tiling enablement keyed by stable identities;
- allowed layouts and default split/drop layout;
- gap policy, including hide-when-single;
- automatic split and single-tab exit policy;
- normalized tab/stack header extents in layout coordinate units;
- layout constraints keyed by `SurfaceId`;
- ordered participation rules;
- reconciliation attempt budget;
- any behavior-parity flags that cannot be removed during migration.

The generic rule evaluator matches portable window facts such as application identity, title, role,
transience, resizability, tags, and explicit identity. Anvil-specific defaults (PIP, Blender, Steam,
ephemeral helpers) are policy entries constructed by the GNOME adapter, not hard-coded branches in
the portable module. Explicit force-tile rules retain precedence over automatic float rules.

Presentation-only policy remains in Runtime: border colors, corner masks, pointer warping,
always-on-top behavior, quick settings, CSS, and whether a preview actor is visible.

Disabling global or per-surface tiling changes effective participation without overwriting the
underlying rule decision or manual override. A platform-level workspace toggle is translated by
Runtime into policy for the Surfaces it currently comprises. Re-enabling reevaluates current facts
and restores via placement hints. This replaces destructive `floatAllWindows`/`prevFloat`
bookkeeping.

## Transition contract

```ts
type TilingTransition =
  | {
      status: "committed";
      revision: TilingRevision;
      intentions: readonly TilingIntention[];
      diagnostics: readonly TilingDiagnostic[];
    }
  | {
      status: "ignored" | "rejected";
      revision: TilingRevision;
      intentions: readonly [];
      diagnostics: readonly TilingDiagnostic[];
    };
```

Processing rules:

1. `dispatch` is synchronous and non-reentrant.
2. Events are processed in call order through the single `dispatch` ingress. The state machine
   assigns an internal monotonic event sequence at ingress; Runtime cannot supply or rewrite event
   order or revisions.
3. The complete candidate state and render plan are derived before commit.
4. All invariants are checked against the candidate. Mutable records use copy-on-write; the
   committed state pointer is replaced only after validation, and mutable candidate aliases never
   escape.
5. A valid change commits state and increments revision exactly once.
6. An identical fact batch or semantic no-op is `ignored`; it does not increment revision.
7. A domain-invalid event is `rejected`; state and revision are unchanged.
8. An internal invariant failure throws `TilingInvariantError` before commit. Runtime catches it,
   logs the snapshot/event, and disables the core engine rather than applying partial intentions.
9. Persistent presentation intentions are derived by diffing the preceding and committed render
   plans. A committed command may also produce an explicit one-shot intention, such as focus.
10. Runtime cannot call back into `dispatch` while applying an intention batch. It queues resulting
    facts and submits them only after the entire batch has been attempted.

`dispatch` validates identity kinds, finite geometry, policy completeness, references, capabilities,
and event-specific preconditions before building a candidate. Well-formed stale observations are
usually ignored diagnostically; malformed or impossible domain values are rejected. TypeScript
types are not treated as sufficient runtime validation at the adapter seam.

The state machine never awaits an effect and never invokes a caller callback.

## Render plan

`TilingRenderPlan` is the complete desired presentation for one committed revision:

- each available surface and its work area;
- each participating, available window's desired surface-local frame;
- container layout rectangles and presentation metadata;
- selected child and desired stacking order for stacked/tabbed containers;
- tab/stack header reservation geometry;
- active operation preview geometry;
- intentionally suspended or non-participating windows with no tiled frame.

Geometry rules:

- All rectangles use integer layout coordinates.
- Split allocation floors each child allocation and gives the deterministic remainder to the last
  available child, preserving current behavior during migration.
- Gaps are applied without producing zero or negative frames.
- Surface constraints clamp the desired applied frame, not stored shares.
- Hidden/minimized/suspended descendants do not consume active split allocation.
- A surface with no available participants has an empty window plan.
- Render-plan generation is deterministic and has no dependency on observed iteration order.

`inspect()` returns the complete plan. Persistent presentation effects are emitted only when their
desired value changed from the prior plan; committed commands may additionally emit documented
one-shot intentions.

Compositor focus is not persistent desired geometry and is not reconciled against the render plan.
A focus command commits logical selection and emits one `FocusWindow` intention; later external
`FocusObserved` facts are accepted rather than fought.

## Intentions and causal observations

Every intention carries an `IntentionToken` composed of its committed revision and deterministic
ordinal. The initial intention set is:

| Intention                     | Runtime responsibility                                                 |
| ----------------------------- | ---------------------------------------------------------------------- |
| `WindowParticipationChanged`  | enter/leave GNOME tiling presentation and apply non-participant policy |
| `PlaceWindow`                 | unmaximize if required, remove transitions, request frame              |
| `FocusWindow`                 | activate and focus the mapped Meta window                              |
| `RaiseWindows`                | apply desired stacking order                                           |
| `PresentContainer`            | update tab/stack presentation from container metadata                  |
| `RemoveContainerPresentation` | destroy presentation for a container absent from the new plan          |
| `PresentPreview`              | show/update a drag preview if Runtime policy permits                   |
| `ClearPreview`                | hide the operation preview                                             |

Every geometry-bearing plan entry and intention identifies its `SurfaceId`; Runtime translates the
surface-local rectangle or point to the platform's coordinate space. No intention asks Runtime to
infer a target workspace or output from geometry.

Intentions are ordered by phase: participation, placement, container presentation, stacking,
focus, preview. Runtime attempts all intentions even if one fails and reports failures/results as
one later fact batch. There is no platform rollback.

Runtime checks normalized capability facts before applying a command or effect. The state machine
does not emit focus, raise, move, resize, or unsupported-layout intentions for a target whose facts
say the platform cannot perform them; it rejects the command or chooses a supported policy fallback
with a diagnostic.

`FrameObserved` and `EffectFailed` may echo an intention token. Facts not caused by Anvil have no
token. A stale acknowledgement can update observed platform state but cannot overwrite newer
desired state or cause an older render plan to become authoritative.

Intentions have exactly one source recorded in diagnostics: a persistent render-plan delta, a
one-shot committed command effect, or an observed-mismatch repair. One-shot focus is not retried by
geometry reconciliation.

## Reconciliation

The module has no clock or timer. Runtime owns settling delays and backoff through `EventScheduler`.
When Runtime believes platform effects have settled, it submits `ReconcileRequested`.

The state machine then compares the latest relevant Platform Facts with the current render plan:

- matching effects produce no intention;
- mismatched current effects commit updated retry metadata and emit explicit repair intentions with
  a new revision/token even though the desired render plan itself did not change;
- stale acknowledgements are diagnostic only;
- missing/withdrawn objects are never recreated by effect retry;
- retries stop at the policy attempt budget until a new fact or desired-state change resets the
  mismatch;
- topology reconciliation occurs through a fresh `PlatformSnapshotObserved`, not invented windows
  or surfaces.

This keeps policy for detecting divergence in the state machine while keeping elapsed time and
GNOME scheduling in Runtime.

Repair intentions are the sole exception to normal plan-delta emission. A reconcile request with no
current mismatch is ignored; it neither increments revision nor emits intentions. New relevant
facts or a desired-plan change reset the retry budget for that mismatch.

## State invariants

The invariant checker runs before every commit in development/tests and remains available in
production builds for fail-closed validation.

<!-- markdownlint-disable MD029 -->

### Identity and referential integrity

1. Every identity has exactly one kind and is unique for the machine lifetime.
2. Every reference resolves to a record of the expected kind.
3. Retired identities are not reused.
4. Runtime object references and workspace, monitor, or output identities never appear in state,
   events, intentions, plans, snapshots, or errors.

### Surface invariants

5. Every available surface has one finite, positive rectangular work area in its own coordinate
   space.
6. Every available surface has exactly one root container.
7. A root container belongs to exactly one surface and has no parent.
8. A withdrawn surface has no active tree; its recoverable topology exists only as an evacuation
   hint.
9. Every participating window belongs to exactly one available surface.

### Tree invariants

10. The topology is an acyclic forest rooted at surface root containers.
11. Every non-root node has exactly one parent and appears exactly once in that parent's children.
12. Only containers and participating windows appear in the forest.
13. Non-root containers are never empty. Single-child split containers collapse when safe;
    single-child stacked/tabbed containers obey explicit preservation/auto-exit policy.
14. Structural child order changes only through explicit move/swap/placement transitions.
15. Selection and focus never change structural child order.

### Participation and availability invariants

16. A participating window appears exactly once in a Tiling Tree.
17. A non-participating window appears in no Tiling Tree and receives no tiled frame.
18. An unavailable participating window retains logical placement but receives no frame and consumes
    no active allocation.
19. A window whose assigned surface is missing/unavailable becomes effectively non-participating,
    keeps its policy/manual participation decision and an evacuation hint, and cannot violate
    invariant 9. It is reevaluated when a valid surface fact arrives.
20. Manual overrides and policy classification have deterministic, recorded precedence.

### Layout invariants

21. Split weights are positive and finite when set; zero and negative values are invalid.
22. Effective shares of available children in a split container sum to one within epsilon.
23. Unavailable children do not consume effective share.
24. Stacked/tabbed containers have one valid selected child when any child is available.
25. Derived window frames have finite integer coordinates and positive dimensions.
26. Gaps and constraints modify derived frames, never stored topology weights.
27. The same state and policy always produce byte-equivalent canonical render plans.

### Transition and intention invariants

28. One accepted event commits at most one revision.
29. Ignored/rejected events do not change state or revision and emit no intentions.
30. Every intention belongs to the committed revision that created it; normal intentions cite that
    revision's plan diff and repair intentions cite that revision's observed mismatch.
31. A plan intention is emitted only when its desired effect changed; a one-shot intention is
    emitted only by the command that requested it; a repair intention is emitted only for a current
    observed mismatch within its retry budget.
32. Intention order is deterministic.
33. Platform acknowledgements never roll state backward.

### Operation invariants

34. Active operations have disjoint affected windows and containers.
35. Operation overlays do not mutate base topology until commit and are validated against
    affected-surface/container topology versions, not the unrelated global revision.
36. Cancel discards only the operation overlay and recomputes from current base state; it never
    restores a stale state snapshot.
37. Updates after completion/cancellation are ignored.
38. Operation previews never become structural placement without an explicit commit.
39. An event that invalidates an operation's base topology cancels the operation before its own
    transition is evaluated.
40. No command or intention requires a capability that the latest facts mark unsupported.
41. External inspection is canonically sorted and contains no mutable alias into committed state.
42. Each directional adjacency target resolves to a distinct available surface; no reciprocal
    relationship is assumed.

<!-- markdownlint-enable MD029 -->

## Runtime responsibilities after cutover

`AnvilRuntime` remains the GNOME-aware composition and lifecycle owner. Its collaborators become:

- `GnomeIdentityRegistry`: maps live Meta window objects and adapter-defined surface/grab lifetimes
  to opaque identities;
- `GnomeFactAdapter`: privately interprets Meta workspace/output state and emits only normalized
  surface/window facts and snapshots;
- `GnomePolicyAdapter`: converts GSettings and `windows.json` into one complete policy;
- `GnomeCommandAdapter`: routes only tiling-relevant `AnvilAction` values into Tiling Commands;
- `GnomeIntentionApplier`: maps identities back to live objects and applies intention batches;
- existing signal, event-scheduler, border, tab actor, pointer, keybinding, preferences, and
  lifecycle modules.

Runtime owns:

- signal connect/disconnect and actor readiness;
- batching/coalescing raw GNOME signals into facts;
- timers, settle windows, backoff, and retries scheduling;
- live object lifetime and identity mapping;
- direct frame/focus/raise/actor effects;
- GSettings/config persistence and policy translation;
- behavior of non-participating windows;
- borders, corner masks, pointer movement, Shell UI, and preferences;
- catching adapter/effect errors and reporting portable failures.

Runtime may coalesce consecutive observational facts for the same identity before dispatch, but it
may not reorder commands/operations or coalesce across discovery, withdrawal, identity retirement,
or a fact batch that represents one atomic topology change.

The effect applier treats an identity that disappears mid-batch as a portable `target-withdrawn`
failure, continues the rest of the batch, and queues that failure with the corresponding withdrawal
fact. It never holds a live-object reference inside a queued core event.

Runtime does not own logical topology, weights, selection, placement hints, layout geometry,
participation decisions, operation overlays, render-plan diffing, or reconciliation decisions.

## Migration rule: never two writers

The migration permits two implementations in the repository but only one authoritative engine in a
Runtime session.

- `legacy`: current Tree/Layout/TilingRender paths own state and effects.
- `shadow`: legacy remains sole writer; the core receives mirrored plain events and its intentions
  are discarded while plans are compared diagnostically.
- `core`: TilingStateMachine is sole state owner and only its intentions are applied.

The engine mode is selected once during enable and never changes mid-session. There is no
per-command fallback, per-window fallback, or legacy mutation after a core transition. Unsupported
core commands are rejected during development; they do not call legacy behavior.

During migration, a temporary internal Runtime driver owns the startup mode branch because legacy
and core are two real implementations. It is deleted with legacy mode rather than retained as a
permanent forwarding layer around the state machine's own interface.

Shadow events are captured at raw signal/command ingress before legacy mutation. The shadow model
must not infer inputs from a Tree that legacy code has already changed. Plan comparison happens
after the existing settle boundary so asynchronous GNOME application is not mistaken for a core
decision mismatch.

## Migration plan

Each numbered item is intended to be a reviewable conventional commit. A phase cannot advance until
its gate is green.

<!-- markdownlint-disable MD029 -->

### Phase 0 — freeze the contract and capture baseline

1. **`docs(architecture): record portable tiling state machine plan`**
   - Land this plan, glossary updates, accepted ADR, and proposed surface-tree ADR.
   - Update architecture routing to point tiling-core work here.
2. **`test(e2e): capture core migration acceptance matrix`**
   - Map every existing unit/E2E behavior to a fact, command, operation, policy, or Runtime-only
     responsibility.
   - Add missing real-shell cases for late metadata reclassification, surface withdrawal, focus
     restoration, and operation cancellation before changing ownership.
3. **`test(tiling): add legacy event replay fixtures`**
   - Record small platform snapshots and command/fact sequences for admission, removal, minimize,
     split, move, swap, focus, stacked/tabbed, gaps, constraints, workspace changes, drag, and resize.
   - Store expected logical outcomes, not private legacy node serialization.

**Gate:** `npm test`, `npm run typecheck:e2e`, targeted E2E tags, and a reviewed behavior matrix.

### Phase 1 — establish the isolated module

4. **`build(tiling): enforce platform-independent dependency fence`**
   - Add isolated tsconfig, ESLint restrictions, boundary script, and plain Vitest config.
5. **`feat(tiling): define external event and inspection interface`**
   - Add identities, facts, commands, policy, transition, intention, inspection, and geometry
     contracts through `index.ts`.
6. **`feat(tiling): add transactional state machine shell`**
   - Implement synchronous dispatch, no-op/rejection behavior, revisioning, immutable inspection,
     and candidate-state commit.
7. **`test(tiling): enforce invariants across generated event sequences`**
   - Add seeded, dependency-free model sequences and run the invariant checker after every event.

**Gate:** `npm run check:tiling-boundary` and `npm run test:tiling` run without loading any GJS mock.

### Phase 2 — topology, surfaces, and participation

8. **`feat(tiling): model surfaces and evacuation`**
   - Implement atomic bootstrap, surface-local work areas, roots, adjacency, stable lifetimes,
     withdrawal, and evacuation hints.
9. **`feat(tiling): model window discovery and availability`**
   - Implement known-window records, participation-independent availability, minimize/restore, and
     withdrawal.
10. **`feat(tiling): evaluate ordered participation policy`**
    - Port generic title/application/role/capability matching and rule precedence.
    - Keep Anvil-specific policy construction outside the module.
11. **`feat(tiling): place and normalize participating windows`**
    - Add attach selection, placement-hint restoration, removal, container collapse, and focus
      restoration as pure transitions.

**Gate:** replay fixtures for admit/destroy/float/surface-reassignment/minimize pass at the module
interface.

### Phase 3 — render plan and intentions

12. **`feat(tiling): derive split geometry and deterministic shares`**
    - Port horizontal/vertical allocation and percent behavior with golden parity fixtures.
13. **`feat(tiling): derive stacked and tabbed presentation`**
    - Add explicit selection, stacking, header reservation, and container presentation data.
14. **`feat(tiling): apply gaps and surface constraints to plans`**
    - Port hide-single and resize-exemption behavior without platform reads.
15. **`feat(tiling): diff plans into causal intention batches`**
    - Add intention tokens, deterministic phases, immutable full-plan inspection, and no-op
      suppression.
16. **`feat(tiling): reconcile observed effects with desired plans`**
    - Add causal fact handling, stale acknowledgement policy, retry budgets, and scoped reconcile.

**Gate:** render plans are deterministic; unchanged facts emit no frame moves; all geometry fixtures
pass without GNOME mocks.

### Phase 4 — commands, selection, and operations

17. **`feat(tiling): handle focus move swap and split commands`**
    - Port directional graph behavior, stable child order, previous selection, and split toggles.
18. **`feat(tiling): handle stacked tabbed and tiling policy transitions`**
    - Port layout toggles, disabled-layout restoration, global/surface policy, and automatic split.
19. **`feat(tiling): model keyboard and pointer resize operations`**
    - Port share-delta math, constraints, overlays, commit, and cancellation.
20. **`feat(tiling): model drag placement and preview operations`**
    - Port hit testing, create/detach/swap/insert plans, preview geometry, commit, and cancellation.

**Gate:** all legacy command/drag/resize replay fixtures pass through `dispatch` and `inspect` only.

### Phase 5 — build the GNOME adapter in shadow mode

21. **`refactor(runtime): add GNOME identity and fact adapters`**
    - Create stable session mappings and normalized full-snapshot/fact batching.
    - Existing legacy behavior remains unchanged.
22. **`refactor(runtime): translate settings and commands to core contracts`**
    - Build complete policy values and route tiling-relevant commands without changing the active
      engine.
23. **`refactor(tracker): emit normalized window and surface facts`**
    - Split signal/actor readiness from logical admission. Capture facts at ingress while legacy
      remains the writer.
24. **`refactor(grab): translate GNOME grabs into operation events`**
    - Keep Meta grab recognition, pointer sampling, and GLib scheduling in Runtime; mirror only
      identities, points, deltas, and targets into the core.
25. **`refactor(presentation): consume identity-based plan data`**
    - Make borders, tab/stack actors, pointer notifications, and test probes resolve opaque
      identities and plan metadata instead of traversing legacy Nodes.
26. **`feat(runtime): add read-only core shadow comparison`**
    - Mirror events into the state machine, discard its intentions, compare its plan with legacy
      desired/observed geometry, and expose structured mismatch diagnostics in test mode.
27. **`test(runtime): close shadow parity gaps`**
    - Run replay plus real-shell scenarios until all intentional differences are documented and all
      accidental differences are fixed.

Current real-shell parity evidence (2026-07-13):

- Settled two-window horizontal tiling, three-window swap, and three-window layout-toggle scenarios
  have zero geometry mismatches and zero rejected shadow events on GNOME Shell 50.1 in the Fedora
  Devbox.
- Snapshot and multi-window fact order is now a structural input independent of canonical identity
  sorting. New admissions insert after the selected child, and one batch cursor preserves the fact
  order when several windows target the same container.
- Window facts carry client minimum sizes normalized into frame dimensions with Mutter's
  client-to-frame conversion. This matches Nautilus's three-way vertical clamp without exposing
  GNOME decoration geometry to the core.

**Gate:** legacy remains the only writer; shadow mismatch count is zero for the acceptance matrix,
or each remaining mismatch has an approved behavior-change decision.

Before core mode can exist, every legacy Tree consumer must have a non-Tree path:

| Consumer              | Required core-mode path                                                |
| --------------------- | ---------------------------------------------------------------------- |
| `SignalManager`       | submit normalized facts/operations; no Node lookup or render call      |
| `WindowTracker`       | own Meta readiness/lifetime and fact production only                   |
| `SettingsBridge`      | submit complete policy values or run Runtime-only presentation effects |
| `CommandBus`/handlers | translate tiling actions to commands; keep Runtime-only actions local  |
| `TilingRender`        | replaced by render-plan derivation plus `GnomeIntentionApplier`        |
| `GrabResizeSession`   | reduced to GNOME operation recognition/sampling/application            |
| `DragDropTile`        | preview actor only; hit testing and placement live in core operations  |
| `FocusController`     | Meta activation/raise only; logical selection lives in core            |
| `WorkspaceMutations`  | platform moves/facts only; surface topology lives in core              |
| borders/decorations   | consume plan/identity presentation data, never logical Nodes           |
| Runtime test probes   | embed `inspect()`; never traverse legacy state in core mode            |

Core mode is not enabled until this table is complete. A module may temporarily support both paths,
but the selected session mode determines the sole state/effect writer.

### Phase 6 — implement core mode

28. **`feat(runtime): apply core intention batches`**
    - Add `GnomeIntentionApplier`, causal result facts, deterministic effect phases, and adapter
      error isolation.
29. **`refactor(runtime): remove Tree dependencies from core-mode ingress`**
    - Route SignalManager, WindowTracker, SettingsBridge, CommandBus, workspace changes, focus, and
      operation updates through facts/commands in core mode.
30. **`feat(runtime): add whole-session core engine mode`**
    - Bootstrap from one platform snapshot and route facts/commands/operations exclusively through
      the state machine. No legacy fallback is permitted in core mode.
31. **`test(e2e): run tiling suites in core mode`**
    - Parameterize the harness to run targeted suites in legacy and core modes.
    - Require lifecycle, tiling, focus, move, swap, layouts, floating participation, workspace,
      minimize, constraints, keyboard resize, and operation cancellation.
32. **`fix(tiling): resolve core-mode parity findings`**
    - Fix through the state-machine interface or GNOME adapter, never by restoring direct Runtime
      state writes.

**Gate:** `npm test`, `npm run check:tiling-boundary`, `npm run typecheck:e2e`, and the complete
real-shell suite pass in core mode twice consecutively.

Gate evidence (2026-07-13, Fedora Devbox, GNOME Shell/Mutter 50.1, commit `d0425ad`):

- `npm test`: 54 portable-core tests and 1009 Runtime/unit tests passed.
- `npm run check:tiling-boundary` and `npm run typecheck:e2e` passed.
- `python3 test/e2e/run.py --no-build --engine core` passed 128/128 twice consecutively from the
  same installed artifact and unchanged source revision.
- The matrix includes lifecycle, tiling, focus, move, swap, layouts, floating participation,
  workspace policy, minimize/restore, constraints, keyboard resize, and command cancellation.

**Phase 6 gate status:** complete.

### Phase 7 — default, soak, and retire legacy

**Deferred:** Phase 7 is not approved for implementation. The portable core remains experimental,
and the evidence below is retained only as development history. No production cleanup or bug-fix
series may perform these steps. Resuming this phase requires a new review, an accepted plan, and
explicit approval.

33. **`feat(runtime): make core mode the default tiling engine`**
    - Retain a startup-only emergency legacy switch until the documented core-default soak matrix
      is complete and legacy removal is explicitly approved.
    - Add diagnostics for transition rejection, invariant failure, effect failure, and reconcile
      exhaustion.
34. **`test(release): complete core default soak`**
    - Exercise enable/disable, lock/unlock, Xwayland late maps, dynamic workspaces, monitor changes,
      rapid minimize/restore, fullscreen, and repeated grabs on the real shell.
35. **`refactor(tiling)!: remove the legacy tiling engine`**
    - Delete GObject `Tree` as authoritative state, `LayoutEngine`, geometry portions of
      `TilingRender`, pure portions of drag/grab/focus/workspace modules, legacy engine selection,
      shadow comparison, and obsolete mocks/tests.
    - Keep only GNOME adapters and presentation controllers.
36. **`docs(architecture): make the portable state machine authoritative`**
    - Rewrite architecture rules, source map, test guidance, glossary links, and test probes.
    - Mark legacy extraction decisions as superseded where appropriate.

Core-default soak matrix (tracked independently from the Phase 6 functional matrix):

| Scenario                        | Current evidence                                                               | Status   |
| ------------------------------- | ------------------------------------------------------------------------------ | -------- |
| enable/disable with core writer | full E2E `Extension Lifecycle`                                                 | complete |
| fullscreen enter/exit           | full E2E border/window-state scenario                                          | complete |
| ordinary minimize/restore       | full E2E `Minimize Behavior`                                                   | complete |
| repeated keyboard resize        | 74-case full E2E resize matrix                                                 | complete |
| rapid minimize/restore churn    | five-cycle core E2E with diagnostic assertions                                 | complete |
| dynamic workspace create/remove | core E2E surface/window referential-integrity test                             | complete |
| monitor add/remove/reconfigure  | two-monitor mirror/linear core E2E preserves surface identities and invariants | partial  |
| Xwayland window mapped late     | late `xterm` admission core E2E                                                | complete |
| repeated pointer drag/resize    | headless `begin_grab_op` segfaults both engines; manual Devkit soak required   | pending  |
| lock/unlock                     | real Shell `unlock-dialog` session-mode push/pop preserves core identity       | complete |

The monitor test runs with two persistent virtual outputs, moves a live window to the second
output, collapses the topology to mirror mode, and restores linear mode. The core keeps its
surface identities stable, withdraws/restores topology without an invariant failure, and ends with
every participating window assigned to a live surface. Mutter 50.1 emits two stale work-area
assertions while collapsing a window-bearing second virtual output. The identical assertions occur
under the legacy writer, so they are recorded as a headless compositor limitation rather than a
core failure. Physical add/remove remains a manual cutover item.

The lock test drives the real GNOME Shell `SessionMode` stack through `unlock-dialog` and back to
`user`, which covers Anvil's extension persistence, indicator lifecycle, and retained core state.
The headless Shell has no `Main.screenShield` or GDM authentication service, so this does not claim
lock-screen UI or authentication coverage; those are outside the tiling engine's state boundary.

Combined automated evidence (2026-07-13, commits `f4d0458` through `7d2d20d`):

- `npm test` passed 55 portable-core tests and 1010 Runtime/unit tests; the boundary, lint, and all
  TypeScript projects were green.
- A fresh Fedora Devbox core run passed 132/132. The default one-monitor run includes every
  completed row above except the separately invoked two-monitor churn scenario.
- `python3 test/e2e/run.py --engine core --virtual-monitors 2 --tag monitor-churn` passed its
  surface-identity/integrity scenario; the legacy control passed with the same two Mutter
  work-area assertions.

Remaining manual cutover checklist:

1. Start an isolated core-mode Devkit session with
   `ANVIL_TILING_ENGINE=core .agents/skills/gnome-shell-debug/scripts/run-devkit-session.sh`.
2. Open at least three tiled windows. Perform ten pointer moves across split siblings and between
   outputs, including center, edge-insert, and swap drop zones; cancel at least two moves.
3. Perform ten pointer resizes from different edges/corners, including a cancel. After each group,
   verify no window disappears, shares remain positive, and subsequent keyboard focus/move works.
4. In a real user session with two physical outputs, unplug/replug or disable/re-enable one output
   while each output owns a tiled window. Verify the returned surface restores its windows and no
   transition, invariant, effect, or reconcile-exhaustion diagnostic appears.
5. Record GNOME Shell/Mutter version, display topology, the Devkit/session log path, and pass/fail
   result here before approving the core-default switch.

The engine does not become the production default until every pending or partial row has a
reproducible real-shell test or a recorded environment limitation plus an approved manual result.
Legacy removal still requires explicit approval after the default soak; passing this matrix alone
does not approve deletion.

**Final gate:** no production import outside `src/lib/tiling/` mutates logical topology, shares,
selection, or render plans; no file inside imports GNOME; full unit/build/E2E validation is green.

<!-- markdownlint-enable MD029 -->

## Test migration

### Core tests

New tests live under `test/tiling/` and use the isolated Vitest configuration. They test only
`dispatch` and `inspect`:

- example event traces for every command/fact/operation;
- deterministic replay: same policy and events yield byte-equivalent inspection;
- duplicate and stale fact behavior;
- generated valid and invalid event sequences with invariant checks;
- surface evacuation/restoration and identity stability;
- explicit directional adjacency across non-rectangular Surface graphs;
- minimize/suspend availability without topology loss;
- placement-hint invalidation and fallback;
- exact transition status/revision/intention delta behavior;
- geometry properties: positive frames, no unintended overlap, fill, stable remainder, constraints;
- operation cancellation and stale updates;
- implicit operation cancellation on topology/policy invalidation;
- capability rejection for unsupported focus/move/resize/layout effects;
- reconcile retry and causal-token behavior.

Internal files are not imported by tests. If a test requires an internal import, deepen or simplify
the external interface instead.

### Runtime adapter tests

GJS mocks remain only for:

- Meta/Shell fact normalization;
- identity registry lifetime and object-finalization handling;
- GSettings/config-to-policy translation;
- `AnvilAction`-to-command translation;
- intention ordering and Meta/St effect application;
- lifecycle connect/disconnect and queued fact submission.

### E2E tests

Real-shell tests prove integrated behavior, not layout algebra. Prefer relative geometry and the
official `inspect()` test projection. During migration, each E2E run declares legacy or core mode;
there is never an implicit fallback.

The pre-cutover release gate is the full suite in core mode twice consecutively. The post-cutover
gate adds monitor/workspace churn and enable/disable soak scenarios.

### Test deletion

After cutover, delete legacy tests that reach into `Tree`, `LayoutEngine`, `TilingRender`,
`GrabResizeSession`, or Runtime private state when equivalent behavior is covered through the state
machine interface. Preserve adapter and real-shell tests that validate GNOME translation/effects.

## Observability and test probes

`inspect()` is the only logical-state probe. Runtime's `getStateJson()` will embed its immutable
inspection plus Runtime lifecycle diagnostics; E2E helpers will not traverse private nodes.

Inspection contains:

- schema version and revision;
- canonical, sorted surface/window/container records;
- participation rule sources and placement hints;
- active operation summaries;
- full current render plan;
- bounded recent diagnostics, but no unbounded event log;
- no live object details beyond opaque identities and portable metadata already in facts.

Runtime logs transition rejection, invariant failure, intention failure, stale acknowledgement, and
reconcile exhaustion with revision and identity context. Logging remains outside the module.

## Performance constraints

- `dispatch` performs no I/O, timer work, logging, or platform calls.
- Ordinary window/command events recompute only affected surfaces; policy replacement and bootstrap
  may recompute all surfaces.
- Canonical inspection may be O(total state) because it is diagnostic and not on the render hot path.
- Plan diff is linear in affected plan entries.
- No event history grows without bound. Diagnostics are bounded. No-reuse comes from monotonic
  internal counters and Runtime identity registries, so the core does not retain an ever-growing
  tombstone record merely to allocate its next identity.
- Performance fixtures cover at least 100 windows, 20 surfaces, 1000 mixed events, and repeated
  resize updates. The plan sets behavior and complexity expectations; measured budgets are recorded
  after the first implementation benchmark rather than invented here.

## Rollback and failure policy

- Before default cutover, select legacy mode at enable time to roll back. Never switch an enabled
  session between engines.
- Core-mode invariant failure commits nothing and applies no intentions for that event. Runtime logs
  the event and inspection, disables core tiling effects, and requires a clean re-enable; it does not
  silently fall back with live windows.
- Individual intention failures do not stop later intentions in the same batch and do not roll state
  back. They become facts and diagnostics.
- After legacy deletion, rollback is a normal source revert, not a hidden second writer.

## Completion criteria

The migration is complete only when all are true:

- `src/lib/tiling/` compiles and tests without GNOME aliases or mocks.
- Its external interface remains `dispatch` plus `inspect`.
- All logical tiling state has one owner: `TilingStateMachine`.
- Runtime contains no direct topology, share, selection, or render-plan mutation.
- GNOME dependencies are confined to adapters, lifecycle, and presentation modules.
- Every current user-visible tiling behavior is mapped to a core test, adapter test, E2E test, or an
  explicit Runtime-only classification.
- Full core-mode E2E passes twice consecutively and the soak matrix is complete.
- Legacy state modules, compatibility facades, private-state tests, and GJS mocks needed only for
  pure logic are deleted.
- Architecture rules and context documents describe the new owners rather than the migration.

## Self-grill record

The first draft was challenged one dependency at a time. Each answer below was folded back into the
design and invariants before the plan was marked final.

1. **Does `inspect()` make the module shallow by exposing its implementation?** No. It returns a
   versioned diagnostic projection and canonical plan, never internal maps or mutable nodes.
   Production effects use transition intentions, not inspection.
2. **Who allocates identities if the state machine owns them?** Runtime allocates opaque identities
   for platform-backed lifetimes; the state machine becomes their sole semantic owner after
   admission. Only internal container identities are core-allocated. This avoids adding an identity
   registration interface or leaking live handles.
3. **Does Runtime still control event ordering?** Runtime determines when it calls the single ingress,
   but the state machine serializes those calls, assigns event sequence/revision, and rejects
   reentrancy. Atomic platform actions are submitted as fact batches.
4. **Can an invariant exception leave partially mutated state?** No. Transitions use a copy-on-write
   candidate and swap the committed state reference only after full validation.
5. **Can a participating window exist after its surface disappears?** No. It becomes effectively
   non-participating while retaining its rule/manual decision and evacuation hint. This repaired a
   contradiction between surface and participation invariants.
6. **Can every single-child container be collapsed?** No. Split containers collapse when safe;
   stacked/tabbed containers obey explicit preservation/auto-exit policy.
7. **Does focus reorder topology in stacked/tabbed layouts?** No. Selection and desired stacking are
   explicit. This is an intentional change from the legacy append-on-focus behavior and must be
   approved in the behavior matrix.
8. **How can a portable core move between placement spaces without `Meta` neighbor queries?**
   Surface facts include directional adjacency. An adapter may normalize its native neighbor API or
   derive the fact from private output/workspace topology before submission; the core has only one
   adjacency policy.
9. **Can operation cancellation restore a stale snapshot after unrelated events?** No. Operations
   are overlays tied to affected-surface/container topology versions. Cancellation discards the
   overlay and recomputes; topology-invalidating events cancel the operation first, while unrelated
   surfaces can continue changing.
10. **How can reconciliation reapply an unchanged desired frame if normal intentions are delta-only?**
    Repair intentions are an explicit exception. A mismatch commits retry metadata in a new
    revision; a reconcile request with no mismatch is ignored.
11. **Can effect acknowledgements re-enter dispatch during batch application?** No. Runtime attempts
    the whole batch, then queues one result-fact batch. The state machine invokes no callbacks.
12. **What if a target is destroyed halfway through an intention batch?** The adapter records a
    portable `target-withdrawn` failure, continues the batch, and submits the withdrawal/result facts
    afterward.
13. **Can bootstrap miss windows between snapshot and signal binding?** Runtime binds and buffers
    ingress first, captures and dispatches one synchronous snapshot, then drains buffered facts
    before normal application.
14. **Can shadow mode accidentally become a second writer or observe already-mutated legacy state?**
    No. Shadow intentions are discarded, and mirrored inputs are captured at raw ingress before
    legacy mutation. Comparison waits for the existing settle boundary.
15. **Can core mode still depend on Tree through borders, tabs, grabs, tracker, or probes?** No. The
    cutover checklist requires identity/plan paths for every consumer before core mode is enabled.
16. **Should a permanent generic engine interface wrap both legacy and core?** No. A temporary mode
    driver is justified while two implementations exist and is deleted with legacy mode.
17. **Who owns persistent settings if active policy is authoritative in the core?** Runtime owns
    persistence and submits a complete policy only after a successful write. The state machine owns
    the active policy used for transitions; duplicate setting notifications are semantic no-ops.
18. **Do Anvil-specific PIP/Blender/Steam rules make the module GNOME-specific?** No. The core owns a
    generic ordered rule evaluator; the GNOME policy adapter supplies Anvil's default rule data.
19. **Can the core request effects unsupported by another window manager?** No. Capability facts and
    supported-layout policy gate commands and intentions; violations are rejected diagnostically.
20. **Does no-reuse require unbounded identity tombstones?** No. Runtime registries and internal
    monotonic counters guarantee no reuse for the machine lifetime; only bounded diagnostics remain.
21. **Can global or platform workspace tiling toggles destroy a manual participation decision?** No.
    Global policy or the adapter's translation of that workspace setting into per-Surface policy
    changes effective participation while preserving the underlying decision and placement hint.
22. **Can a requested floating rectangle become a second frame writer?** No. It is applied by Runtime
    only after the state machine commits non-participation; tiled frames remain exclusively plan
    derived.
23. **Can tests drift into internal helpers again?** No. Isolated core tests import only `index.ts`
    and use `dispatch`/`inspect`; GNOME mocks remain only at adapter and E2E layers.
24. **Can every intention honestly come from a render-plan diff?** No. Persistent presentation
    intentions do, but focus is a committed one-shot command effect and reconciliation creates
    explicit repair intentions. Each source is named and governed by separate invariants.
25. **Do `WorkspaceId` and `MonitorId` leak the adapter's composition decision into the core?** Yes,
    so they are removed. `SurfaceId` is the sole placement-space identity. Every Surface provides a
    rectangular local layout canvas and adjacency; its adapter may compose that from one output, a
    workspace spanning outputs, or something else. A genuinely non-rectangular region is multiple
    Surfaces in v1 rather than a hidden monitor model in the core.
