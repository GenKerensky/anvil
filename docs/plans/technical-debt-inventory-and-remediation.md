# Technical debt inventory and remediation plan

**Status:** In progress — Stages 0 and 1 complete

**Date:** 2026-07-15

**Scope:** Production GNOME integration, preferences, shared configuration, tests, schemas, assets,
and developer tooling.

## Outcome

Anvil will remove confirmed correctness and lifecycle hazards first, then reduce dead compatibility
surface and stale packaged resources, and finally deepen the remaining large legacy modules. Each
stage is independently releasable and keeps the production runtime usable.

> **Workstream boundary:** The experimental platform-independent Tiling State Machine is governed
> by [`portable-tiling-state-machine.md`](./portable-tiling-state-machine.md) and the accepted
> architecture decisions in [`ADR 0001`](../adr/0001-platform-independent-tiling-state.md) and
> [`ADR 0002`](../adr/0002-surface-rooted-tiling-tree.md). Ordinary production debt remediation
> must not change engine selection, make the portable core the default, remove the legacy Tree, or
> create a second production writer.

## Why this plan exists

The configured project checks are healthy, but they do not expose every kind of debt. At the time
of this inventory:

- the normal TypeScript build and lint pass;
- 1,037 GNOME-adapter unit tests and 55 portable-tiling tests pass;
- 36 Python debug-harness tests pass;
- the portable dependency-boundary check passes;
- every source TypeScript module is reachable from `extension.ts` or `prefs.ts`;
- a stricter TypeScript pass still reports 19 unused declarations;
- several behavior gaps are explicitly left behind as TODOs; and
- configuration, resources, and debug tooling contain stale surfaces that normal compilation does
  not inspect.

This means the codebase is not in a broken state. The debt is concentrated in uncaught lifecycle
hazards, incomplete edge behavior, test-only compatibility code, oversized legacy modules, and
packaging/tooling residue.

## Principles and constraints

All remediation work must preserve these constraints:

1. Follow the owner table in [the architecture rules](../../.agents/rules/architecture.md). A fix
   must land in the module that owns the affected state.
2. Keep Tiling Render as the only production path that applies tiled window geometry.
3. Keep Tree structure, LayoutEngine percent algebra, RulesEngine classification, and
   GrabResizeSession operation state single-owned.
4. Pair every GNOME/GObject signal, GLib source, actor, and settings override with an explicit
   lifetime.
5. Test user commands through `AnvilAction` and CommandBus instead of adding direct runtime entry
   points.
6. Preserve the supported `AnvilExtension` test probe. Do not replace deleted private test helpers
   with broad runtime exposure.
7. Separate behavior fixes from structural refactors. A commit should either change behavior or
   move existing behavior, not both.
8. Treat user configuration as durable data. Upgrades must not silently overwrite it.
9. Use the terms in [`CONTEXT.md`](../../CONTEXT.md), especially Tiling Tree, Tiling Render,
   Grab-Resize, Tiling Surface, and Anvil Runtime.

## Priority model

| Priority | Meaning                                                               |
| -------- | --------------------------------------------------------------------- |
| P0       | User data, lifecycle, or correctness risk with a bounded fix          |
| P1       | Known user-visible behavior gap or missing regression coverage        |
| P2       | Dead code, stale configuration, packaging, or enforceability debt     |
| P3       | Structural debt that raises change cost but is not immediately unsafe |
| Tracked  | Deliberate debt managed by another plan or accepted boundary          |

## Inventory summary

| ID     | Status      | Priority | Area                  | Summary                                                         |
| ------ | ----------- | -------- | --------------------- | --------------------------------------------------------------- |
| TD-001 | Complete    | P0       | Window discovery      | Preferences-window lookup skips workspace zero                  |
| TD-002 | Complete    | P0       | Configuration         | Parsed window overrides bypass their runtime validator          |
| TD-003 | Complete    | P0       | Preferences lifecycle | Monitor settings signal is stored but never disconnected        |
| TD-004 | Open        | P0       | User data             | Stylesheet upgrade can overwrite customized CSS                 |
| TD-005 | Open        | P1       | Layout                | Cross-surface legacy swap is disabled because of a freeze       |
| TD-006 | Open        | P1       | Grab-Resize           | Ineligible adjacent windows stop resize-pair selection          |
| TD-007 | Open        | P2       | Runtime API           | Thirteen private compatibility members exist only for tests     |
| TD-008 | Complete    | P2       | Local APIs            | Unused drag parameter and SpinButtonRow options remain          |
| TD-009 | Open        | P2       | Shared helpers        | Several helpers and conversions have no production consumer     |
| TD-010 | In progress | P2       | Policy ownership      | Tested helpers are disconnected from their production owners    |
| TD-011 | Open        | P2       | GSettings             | Four schema keys have no source consumer                        |
| TD-012 | Open        | P2       | Resources             | Twenty-one packaged SVG icons have no repository reference      |
| TD-013 | Open        | P2       | Debug tooling         | Four stale root scripts duplicate the canonical skill scripts   |
| TD-014 | Open        | P2       | Build tooling         | Metadata generation is duplicated                               |
| TD-015 | In progress | P2       | Static enforcement    | Normal builds do not reject unused locals or parameters         |
| TD-016 | Complete    | P2       | Test orchestration    | Python tooling tests are outside the normal `npm test` gate     |
| TD-017 | Open        | P3       | Module depth          | Six production modules exceed the soft 500-line budget          |
| TD-018 | Open        | P3       | Tree ownership        | Legacy Tree still owns platform workspace/monitor orchestration |
| TD-019 | Open        | P3       | Grab-Resize design    | Pair selection and session mechanics remain interleaved         |
| TD-020 | Open        | P3       | Debt governance       | TODOs mix defects, features, stale notes, and design questions  |
| TD-021 | Tracked     | Tracked  | Vendored parser       | Third-party CSS parser remains under `@ts-nocheck`              |
| TD-022 | Tracked     | Tracked  | Portable core         | Experimental migration and proposed surface ADR remain open     |

## Detailed inventory

### TD-001: Preferences-window lookup skips workspace zero

**Evidence:** `src/lib/extension/utils/window-filters.ts` loops from `1` through
`get_n_workspaces()` inclusive. GNOME workspace indices are zero-based, so it skips the first valid
workspace and asks for one workspace beyond the valid range. Both the legacy and portable command
paths use this helper for `PrefsOpen`.

**Impact:** Invoking preferences can open a duplicate preferences window instead of activating the
existing window. Behavior on the final invalid lookup depends on how Mutter handles a null
workspace, which makes the current success path accidental.

**Remedy:** Enumerate `0 <= index < count`, or use one documented all-workspaces tab-list query.
Keep exact-title preference ahead of substring matching and define the behavior for an empty title.

**Acceptance criteria:**

- a preferences window on workspace zero is found;
- a preferences window on any later workspace is found;
- no out-of-range workspace lookup occurs;
- a missing window returns `undefined`; and
- `PrefsOpen` activates one existing window instead of opening another.

### TD-002: Window override parsing bypasses validation

**Evidence:** `src/lib/shared/settings.ts` defines `isWindowConfig()`, but `ConfigManager.windowProps`
returns `JSON.parse()` directly. RulesEngine and the preferences UI then assume `overrides` is an
array with usable `wmClass` and `mode` values.

**Impact:** Syntactically valid but structurally invalid JSON can cause failures far from the file
boundary, leave the shell and preferences processes with different assumptions, or make override
editing destructive.

**Remedy:** Validate immediately after parsing. Return a typed failure or a safe empty configuration,
log the rejected path and reason without logging sensitive window titles unnecessarily, and avoid
writing invalid data back. Apply the same validation to shipped defaults and user files.

**Acceptance criteria:**

- valid configuration round-trips unchanged;
- malformed JSON and structurally invalid JSON are distinguished in logs;
- missing `overrides`, non-array `overrides`, and invalid rows fail safely;
- RulesEngine receives a valid `WindowConfig`; and
- the preferences editor does not overwrite a rejected file merely by opening.

### TD-003: Monitor preferences retain a settings signal

**Evidence:** `src/lib/prefs/monitors.ts` assigns the result of
`changed::monitor-constraints` to `_settingsChangedId`, but never reads the field or disconnects the
handler.

**Impact:** Reopening preferences can retain page callbacks for longer than the page lifetime. At
minimum the field is misleading; at worst stale pages react to later GSettings changes.

**Remedy:** Bind the callback lifetime to the page object using an object-owned connection, or add
an explicit dispose/unmap path that disconnects the stored ID and clears it. Choose the same
lifetime convention used by other preferences pages.

**Acceptance criteria:**

- the handler is connected once per live page;
- disposing the page releases the connection exactly once;
- later settings changes do not call a disposed page; and
- reopening preferences still refreshes controls and the monitor drawing.

### TD-004: Stylesheet upgrades can overwrite user configuration

**Evidence:** `ThemeManagerBase.patchCss()` backs up the configured stylesheet and then copies the
shipped stylesheet over it whenever `css-last-update` differs from a hard-coded `cssTag`. The method
describes itself as breaking, and its TODO acknowledges the unresolved merge policy.

**Impact:** A release that increments `cssTag` can silently replace colors, radii, or other CSS
customizations. A backup limits data loss but does not make the upgrade behavior safe or clear.

**Remedy:** Introduce a content-aware migration contract:

1. distinguish the shipped stylesheet from the user stylesheet;
2. record the shipped-default version or digest from which the user file was created;
3. replace automatically only when the user file still matches the previous shipped default;
4. preserve customized files and make new selectors/defaults available without overwriting them;
5. keep a backup as disaster recovery, not as the primary merge strategy; and
6. remove constructor-time ambiguity by giving initialization and upgrade explicit entry points.

**Acceptance criteria:**

- first install creates or selects a valid stylesheet;
- an untouched old default upgrades automatically;
- a customized stylesheet remains byte-for-byte intact;
- backup or copy failure leaves the active file usable;
- `css-last-update` advances only after a successful migration; and
- both the shell and preferences process reload the chosen stylesheet.

### TD-005: Cross-surface legacy swap is disabled

**Evidence:** `LayoutEngine.swap()` returns before `swapPairs()` when two nodes do not share a parent
monitor, with a TODO documenting a freeze bug. Unit coverage currently treats the no-op as expected.

**Impact:** Directional swap appears to do nothing at a monitor boundary. The guard prevents the
known freeze but leaves an advertised window-management operation incomplete.

**Remedy:** First reproduce the freeze in an isolated multi-monitor session. Then define one atomic
legacy operation that validates both target surfaces, reparents or swaps nodes through LayoutEngine,
normalizes sibling percents on both sides, requests the platform move through the correct owner,
restores focus, and schedules one final Tiling Render. If reliable support is not possible, make
the rejection explicit and user-visible instead of returning silently.

**Acceptance criteria:**

- the operation never freezes GNOME Shell;
- each moved window has the correct monitor ancestor afterward;
- both affected parent percent sets normalize to approximately one;
- focus and pointer policy observe the final target once;
- rendering is not left frozen; and
- focused unit and multi-monitor E2E tests cover both directions.

### TD-006: Grab-Resize stops at an ineligible adjacent node

**Evidence:** The horizontal and vertical same-parent branches in
`src/lib/extension/grab-resize-session.ts` detect a floating or minimized resize candidate and then
do nothing. Both branches contain the same “try to get the next resize pair” TODO.

**Impact:** A visible tiled window may stop redistributing space even though another eligible tiled
neighbor exists beyond the skipped node. The duplicated branch logic can diverge between axes.

**Remedy:** Extract pure candidate selection that walks in the requested direction and returns the
first participating, available, tiled candidate with a compatible resize boundary. Use the same
selection for both axes, then leave percent application and session state in GrabResizeSession.

**Acceptance criteria:**

- floating and minimized nodes are skipped;
- a later eligible sibling is selected;
- no eligible candidate produces a deliberate no-op;
- horizontal and vertical paths share candidate-selection logic;
- nested-container and opposite-edge fallback behavior remains covered; and
- live resize stays smooth without reconcile-driven snap-back.

### TD-007: Private AnvilRuntime compatibility surface exists only for tests

**Evidence:** A strict unused-declaration pass reports thirteen private runtime members with no
production caller: `pointerPolicy`, `tilingRender`, `shouldFocusOnHover`, `toggleFloatingMode`,
`commandBus`, `resize`, `_stopLiveResizeLoop`, `getWindowsOnWorkspace`,
`isCurrentWorkspaceTiled`, `moveWindowToPointer`, `findNodeWindowAtPointer`, `_grabCleanup`, and
`currentWsNode`. Several are marked deprecated and explicitly retained for tests.

**Impact:** Tests preserve obsolete facade methods, make AnvilRuntime appear to own behavior that
has moved to deeper modules, and prevent unused-code enforcement from becoming a project gate.

**Remedy:** Move behavioral tests to the owning module fixtures. Keep only genuine composition and
lifecycle assertions at AnvilRuntime level. Use the narrow official test probe for E2E state rather
than adding new private facade accessors.

**Acceptance criteria:**

- owner-module tests cover every behavior formerly reached through a wrapper;
- the thirteen unused members are removed;
- no replacement test-only production methods are added;
- AnvilRuntime lifecycle and command delegation remain covered; and
- the supported extension test probe is unchanged or deliberately versioned.

### TD-008: Small unused local APIs remain

**Evidence:** `DragDropTile.updatePreview()` accepts an unused `previewTarget`, and
`SpinButtonRowOptions` accepts four underscored properties that the constructor destructures but
never applies.

**Impact:** Call sites imply behavior that does not exist, and future callers may believe those
properties configure the GTK widget.

**Remedy:** Remove `previewTarget`. For each SpinButton option, either implement it against the
created `Gtk.SpinButton` with tests or remove it from the interface and call sites. Do not retain
ignored compatibility arguments without a documented external contract.

### TD-009: Helpers with no production consumer

**Evidence:** Repository reference scans show these helpers are used only by their own tests:

- `Logger.format`;
- `allowResizeGrabOp`;
- `isGnome`;
- `RGBAToHexA` and `hexAToRGBA`; and
- ThemeManagerBase's `defaultPalette`/`getDefaultPalette()`/`getDefaults()` chain.

**Impact:** Tests create the appearance of supported behavior while production has no dependency
on it. Theme construction also performs unused CSS parsing work.

**Remedy:** Delete the helpers and their dedicated tests unless a near-term production consumer is
named. If retained, first wire the production consumer and test through that owner.

### TD-010: Tested policy helpers are disconnected from production

**Evidence:** `shouldMaskWindow()` is unit-tested but BorderController expresses the mask/border
eligibility rule independently. Conversely, `isWindowConfig()` is intended for production but is
not called or directly tested at its ingestion boundary.

**Impact:** Tests can pass while the actual production policy drifts.

**Remedy:** Make the production owner call the pure policy helper, or delete the helper and test the
owner directly. Wire and test `isWindowConfig()` as part of TD-002.

### TD-011: Four unused GSettings keys

**Evidence:** The schema defines `focus-border-size`, `focus-border-color`, `split-border-color`,
and `primary-layout-mode`, but no source, preferences, CSS, or configuration path references them.

**Impact:** The public configuration surface advertises ineffective controls and preserves values
that cannot change behavior.

**Remedy:** Verify that release documentation does not promise the keys as an external API, then
remove them from the schema. If compatibility requires retention, mark them deprecated in the
schema and document that they are ignored before removing them in a later release.

### TD-012: Twenty-one unreferenced icons are packaged

**Evidence:** Twenty-one SVGs under `src/resources/icons/hicolor/scalable/` have no reference in
source, tests, CSS, build files, or documentation. The build copies the whole resource directory.

**Impact:** The extension package carries inherited visual assets with unclear ownership and makes
resource review harder.

**Remedy:** Produce a generated used-icon inventory, smoke-test every preferences page and the
Quick Settings indicator, then delete the unreferenced set. Retain an icon only when its dynamic
lookup contract is documented.

### TD-013: Root debug scripts duplicate the canonical skill

**Evidence:** `scripts/run-devkit-session.sh`, `scripts/devkit-debug.sh`,
`scripts/start-debug-session.sh`, and `scripts/quick-debug-build.sh` duplicate newer scripts under
`.agents/skills/gnome-shell-debug/scripts/`. Three root scripts still `cd` to
`/var/home/falco/Projects/anvil`, which is not the current checkout path. Project guidance already
routes users to the skill-owned launcher.

**Impact:** Contributors can select a stale entry point, build the wrong checkout, or miss fixes in
the canonical launcher.

**Remedy:** Delete the stale copies. If a stable root command is desirable, replace each supported
entry point with a minimal forwarding wrapper and test that it resolves the repository root
without a hard-coded user path.

### TD-014: Metadata generation is duplicated

**Evidence:** The Makefile and quick debug build independently generate
`src/lib/prefs/metadata.js` using nearly identical shell pipelines.

**Impact:** Filtering, formatting, or contributor-attribution changes can drift between normal and
debug packages.

**Remedy:** Extract one repository-relative generator invoked by both build paths. The generated
file remains untracked and should be reproducible from the same Git history.

### TD-015: Unused declarations are not a normal build failure

**Evidence:** `tsconfig.src.json` enables strict TypeScript but not `noUnusedLocals` or
`noUnusedParameters`; ESLint reports unused variables as warnings. A one-off compiler pass finds
the 19 declarations described above.

**Impact:** Compatibility residue and ignored parameters can accumulate while all required checks
remain green.

**Remedy:** Remove or justify the current findings, enable both compiler options for production and
portable projects, and make unused-variable lint errors consistent with the compiler. Underscore
prefixes remain acceptable only for required callback parameters.

### TD-016: Tooling tests are outside the normal test gate

**Evidence:** `npm test` runs TypeScript, lint, portable boundary, portable tests, and unit tests,
but not the Python tests under `test/lib/`.

**Impact:** Debug-loop, host-guard, log-analysis, and shell-session regressions can merge while the
documented normal gate stays green.

**Remedy:** Add a named `test:tooling` command. Decide whether it belongs in `npm test` or a
separate CI job based on its host dependencies; pure Python tests must run everywhere, while
host-shell smoke tests may remain an explicit environment-qualified gate.

### TD-017: Production modules exceed the soft size budget

The architecture rules set a soft budget of roughly 500 lines. Current production outliers are:

| Module                   | Approximate lines | Dominant remaining concerns                              |
| ------------------------ | ----------------- | -------------------------------------------------------- |
| `anvil-runtime.ts`       | 1,496             | composition, adapters, legacy facade, engine routing     |
| `tree.ts`                | 1,071             | structure, traversal, workspace/monitor topology         |
| `grab-resize-session.ts` | 786               | session phases, pair selection, polling, percent updates |
| `tiling-shadow.ts`       | 776               | fact normalization, parity, operation bridging           |
| `layout-engine.ts`       | 619               | topology operations, percent algebra, movement           |
| `command-handlers.ts`    | 541               | heterogeneous command semantics                          |
| `tiling-render.ts`       | 533               | geometry derivation, constraints, frame application      |

Size alone is not sufficient reason to split a module. Extraction is warranted only where it
creates one deeper owner and reduces the interface exposed to callers.

### TD-018: Legacy Tree owns platform topology orchestration

**Evidence:** `tree.ts` contains TODOs to move monitor and workspace behavior, and directly creates,
removes, and reindexes workspace/monitor nodes using GNOME globals.

**Impact:** A nominally structural module still owns platform discovery and signal-adjacent
orchestration. This complicates unit fixtures and makes later legacy retirement harder.

**Remedy:** Extract a legacy `WorkspaceTopology` or equivalent adapter that owns GNOME workspace
and monitor discovery. Keep Tree responsible for node structure, traversal, identity, and
invariants. This is production legacy cleanup, not an attempt to turn the legacy GObject Tree into
the portable Tiling State.

### TD-019: Grab-Resize combines policy and mechanics

**Evidence:** GrabResizeSession owns grab recognition, neighbor discovery, reversible snapshots,
live polling, percent algebra, constraints, and cleanup.

**Impact:** Edge-case fixes require touching a large stateful module, and candidate-selection
behavior is difficult to test without constructing a full session.

**Remedy:** After TD-006, retain session lifecycle in GrabResizeSession but extract pure resize
boundary/candidate selection and percent-delta calculation. Do not create another timer or percent
writer.

### TD-020: TODOs do not have one meaning

Current TODOs include:

- confirmed defects: cross-monitor freeze and skipped resize candidates;
- architecture work: workspace/monitor extraction;
- data migration: CSS update policy;
- feature requests: separate preview-hint colors and JSON tree reload;
- hypothetical behavior: overview-thrash guards; and
- stale questions: constructor placement and generated metadata sourcing.

**Impact:** A TODO scan cannot distinguish urgent debt from an idea, accepted deferral, or obsolete
comment.

**Remedy:** During the stage that touches each area, either resolve the marker, replace it with a
stable debt ID or tracker reference, move the feature to a product backlog, or remove it after
proving it obsolete. Do not leave unowned prose TODOs in production modules.

### TD-021: Vendored CSS parser remains unchecked

`src/lib/css/index.ts` is approximately 955 lines of third-party parser code under `@ts-nocheck`.
This is accepted debt while it remains isolated, licensed, and covered by parser tests. Do not mix
opportunistic typing or formatting changes into theme fixes. Replace or type it only as a dedicated
vendor upgrade with fixture parity.

### TD-022: Portable-core migration remains experimental

Large files in `src/lib/tiling/`, `tiling-shadow.ts`, and GNOME adapter modules reflect an active
experimental migration. Their interface and cutover debt belongs to the portable migration plan.
This plan may improve shared test gates but must not use production cleanup as authorization to
change the default engine or retire the legacy writer.

## Staged remediation roadmap

- [x] Stage 0: Establish reproducible debt gates
- [x] Stage 1: Close bounded correctness and lifecycle hazards
- [ ] Stage 2: Make stylesheet upgrades non-destructive
- [ ] Stage 3: Finish interaction edge behavior
- [ ] Stage 4: Remove dead compatibility and enforce unused-code checks
- [ ] Stage 5: Remove stale schema, resources, and tool entry points
- [ ] Stage 6: Deepen legacy production modules
- [ ] Stage 7: Close the inventory and establish ongoing governance

### Stage 0: Establish reproducible debt gates

**Status:** Complete — reviewed with no blocking or important findings.

**Purpose:** Turn the inventory into repeatable evidence before changing behavior.

**Work:**

1. [x] Add targeted failing tests for TD-001, TD-002, and TD-003.
2. [x] Add a repository-local audit command for unused declarations, schema references, and packaged
       icon references. It may initially report an allowlisted baseline rather than fail.
3. [x] Add `test:tooling` for pure Python tooling tests and separate host-dependent smoke tests.
4. [x] Record the exact installed-package smoke procedure for preferences pages, indicator icons, and
       stylesheet reload.
5. [x] Preserve unrelated worktree state (the task began from a clean worktree).

**Exit gate:** Every later stage has a named validation command, and the first three correctness
findings have tests that fail for the intended reason.

**Completion evidence (2026-07-16):** `npm run check:debt`, `npm run test:tooling`, and
`npm run test:tooling:host` pass. The debt audit rejects unexpected and stale entries using tracked
repository inputs, and the installed-package smoke procedure is documented under `docs/testing/`.

**Suggested commits:**

- `test: cover preferences lookup and monitor page disposal`
- `test(settings): cover invalid window override files`
- `chore(test): add debt and tooling audit commands`

### Stage 1: Close bounded correctness and lifecycle hazards

**Status:** Complete — reviewed with no blocking or important findings.

**Purpose:** Remove high-confidence defects without changing layout architecture.

**Work order:**

1. [x] TD-001: correct preferences-window discovery.
2. [x] TD-002 and the configuration half of TD-010: validate window configuration at ingestion.
3. [x] TD-003: bind the monitor settings signal to page lifetime.
4. [x] TD-008: remove ignored parameters encountered in these paths.

**Why this order:** These fixes are local, can be proven with unit tests, and remove ambiguity before
the larger user-data migration.

**Exit gate:** Targeted tests, `npm test`, and a preferences open/close/reopen smoke test pass with
no stale callbacks or duplicate windows.

**Completion evidence (2026-07-16):** `npm test` passes with 55 portable tests, 1,064 unit tests,
and 40 tooling tests (two host-only cases intentionally skipped by the deterministic gate). The
Fedora Devbox `preferences` E2E passes the installed window open, reuse, close, and reopen lifecycle
and confirms GNOME's `Anvil` / `org.gnome.Shell.Extensions` window identity. Both the standards and
spec review axes passed after three remediation rounds.

**Suggested commits:**

- `fix(utils): search all valid workspaces`
- `fix(settings): validate window override configuration`
- `fix(prefs): release monitor settings connection`
- `refactor(prefs): remove ignored widget options`

### Stage 2: Make stylesheet upgrades non-destructive

**Purpose:** Resolve TD-004 before another release needs a stylesheet-version bump.

**Work:**

1. Define the shipped-default identity and user-customization detection contract.
2. Add migration fixtures for an untouched old default, customized old file, missing file,
   malformed file, and failed backup/copy.
3. Implement an explicit initialization/migration service used by both shell and preferences.
4. Remove the hard-coded constructor question and make reload happen only after successful file
   selection or migration.
5. Document backup recovery and what happens when new selectors are introduced.

**Exit gate:** Automated migration tests pass, custom CSS survives byte-for-byte, and a Devkit
preferences-to-shell reload shows the selected stylesheet without journal errors.

**Suggested commits:**

- `test(theme): define stylesheet migration contract`
- `fix(theme): preserve customized styles during upgrades`
- `docs(theme): document stylesheet recovery and versioning`

### Stage 3: Finish interaction edge behavior

**Purpose:** Resolve known behavior gaps without combining them with module extraction.

**Work order:**

1. TD-006: extract and use eligible resize-pair selection.
2. Verify live Wayland Grab-Resize remains smooth and reconciliation does not fight the operation.
3. TD-005: reproduce the cross-monitor freeze in isolation.
4. Implement atomic cross-surface swap or an explicit supported rejection contract.
5. Update tests that currently expect a silent cross-monitor no-op.

**Exit gate:** Unit tests prove topology and percent invariants; focused resize and swap E2E tests
pass; cross-monitor testing runs through the repository's dedicated fresh-process monitor gate to
avoid contaminating the rest of the E2E run with the known native Mutter monitor-churn failure.

**Suggested commits:**

- `test(resize): cover ineligible adjacent windows`
- `fix(resize): select the next eligible resize boundary`
- `test(layout): reproduce cross-monitor swap freeze`
- `fix(layout): complete cross-monitor swap atomically`

### Stage 4: Remove dead compatibility and enforce unused-code checks

**Purpose:** Resolve TD-007 through TD-010 and make recurrence a build failure.

**Work:**

1. Inventory which tests call each private AnvilRuntime compatibility member.
2. Move those assertions to the owning subsystem test suites.
3. Keep only composition, lifecycle, and delegation coverage on AnvilRuntime.
4. Delete the thirteen unused runtime members.
5. Delete helpers with no production consumer and their tests.
6. Connect any retained pure policy helper to its production owner.
7. Enable `noUnusedLocals` and `noUnusedParameters` and promote unused-variable lint findings to
   errors.

**Exit gate:** The strict unused-declaration compiler pass reports zero findings; `npm test` passes;
the public test probe remains narrow; and no production method exists solely because a unit test
reaches it through an `any` fixture.

**Suggested commits:**

- `test(runtime): target subsystem owners directly`
- `refactor(runtime): remove private compatibility surface`
- `refactor(shared): remove unused helpers`
- `build(ts): reject unused declarations`

### Stage 5: Remove stale schema, resources, and tool entry points

**Purpose:** Resolve TD-011 through TD-014 with packaging evidence.

**Work order:**

1. Verify the four schema keys are not documented external API; deprecate or remove them.
2. Generate the used-icon inventory and delete the twenty-one unreferenced SVGs.
3. Delete stale root debug scripts or replace only supported paths with forwarding wrappers.
4. Extract one metadata generator used by Make and quick debug builds.
5. Build and inspect the installed extension payload.

**Exit gate:** Schema compilation passes, preferences and Quick Settings icons render, the canonical
Devkit launcher starts from the current checkout, generated metadata is identical across build
paths, and no documentation points to a removed script.

**Suggested commits:**

- `chore(settings): remove unused schema keys`
- `chore(resources): remove unreferenced icons`
- `chore(debug): remove stale launcher copies`
- `build(metadata): share contributor metadata generation`

### Stage 6: Deepen legacy production modules

**Purpose:** Resolve TD-017 through TD-019 after correctness and dead-surface cleanup reduce the
amount of code being moved.

**Work order:**

1. Extract legacy workspace/monitor discovery and reindexing from Tree into one topology owner.
2. Reduce AnvilRuntime to composition, lifecycle, engine routing, and its intentional shell-facing
   facade.
3. Keep the Stage 3 resize selector pure and make GrabResizeSession the narrow session coordinator.
4. Split other modules only when a proposed interface hides meaningful complexity and preserves
   the owner table.

**Constraints:**

- do not move GNOME objects into `src/lib/tiling/`;
- do not introduce a second tree or percent writer;
- do not bundle portable-core cutover;
- preserve the official test probe and lifecycle; and
- add an architectural decision only when ownership or public contracts change.

**Exit gate:** Tree exposes structural operations rather than GNOME discovery, AnvilRuntime no
longer carries displaced subsystem behavior, GrabResizeSession delegates pure selection/math, and
all production modules either meet the soft budget or document why their deeper interface justifies
their size.

**Suggested commits:**

- `refactor(tree): extract legacy workspace topology`
- `refactor(runtime): narrow the shell composition facade`
- `refactor(resize): separate boundary selection from session mechanics`

### Stage 7: Close the inventory and establish ongoing governance

**Purpose:** Resolve TD-020 and prevent the plan from becoming a stale checklist.

**Work:**

1. Re-run the full debt audit and update each debt ID as complete, deferred, or superseded.
2. Remove resolved TODOs and convert remaining product ideas into tracked feature work.
3. Update `CHANGELOG.md` for user-visible fixes and removed settings.
4. Update architecture context and decisions for new module ownership.
5. Re-run package, unit, portable, tooling, and focused E2E validation.
6. Archive or replace this plan when no active stage remains.

**Exit gate:** No unowned TODO remains in production code, no high-priority debt ID is unresolved,
and deferred items name an owner, rationale, and next decision point.

## Dependency map

```text
Stage 0: evidence and gates
   |
   +--> Stage 1: bounded correctness/lifecycle
   |       |
   |       +--> Stage 2: stylesheet data migration
   |
   +--> Stage 3: interaction behavior
   |       |
   |       +--> Stage 6: deep module extraction
   |
   +--> Stage 4: dead surface + unused gate
           |
           +--> Stage 5: schema/assets/tooling cleanup
                   |
                   +--> Stage 7: closeout and governance
```

Stage 2 can proceed in parallel with Stage 3 after Stage 1. Stage 4 should precede Stage 6 so
structural work does not carry obsolete compatibility methods into new modules. Stage 5 should
follow the new unused/reference audits from Stage 0.

## Validation matrix

| Change area                          | Required validation                                                     |
| ------------------------------------ | ----------------------------------------------------------------------- |
| Pure helper or configuration parsing | Targeted Vitest, typecheck, lint                                        |
| Preferences lifecycle                | Unit test plus open/close/reopen preferences smoke                      |
| Stylesheet migration                 | File fixtures plus shell/prefs reload in Devkit                         |
| Grab-Resize                          | Unit invariants, focused resize E2E, live Wayland interaction           |
| Cross-monitor layout                 | Unit topology checks plus fresh-process multi-monitor E2E               |
| AnvilRuntime structural cleanup      | Unit suite, typecheck, lint; focused lifecycle E2E if shell API changes |
| GSettings schema                     | Schema compile and host-shell E2E                                       |
| Resource removal                     | Built payload inspection and visual preferences/indicator smoke         |
| Debug/build tooling                  | Python tooling tests and canonical launcher/package smoke               |
| Portable boundary-adjacent imports   | `npm run check:tiling-boundary` and `npm run test:tiling`               |
| Every TypeScript stage               | `npm test` before completion                                            |

## Definition of done for every debt item

A debt item is complete only when:

1. the reported behavior or structure is removed, fixed, or explicitly accepted;
2. the relevant owner module contains the final behavior;
3. regression coverage fails without the remedy and passes with it;
4. obsolete tests, comments, configuration, and resources are removed in the same slice;
5. validation appropriate to the matrix passes;
6. user-visible behavior or configuration changes are recorded in `CHANGELOG.md`; and
7. any new architectural trade-off is recorded in `.agents/memory/decisions.md` or an ADR.

## Explicit non-goals

- Making the portable Tiling State Machine the default.
- Retiring the legacy Tree before the separate cutover plan is accepted.
- Rewriting the vendored CSS parser as part of theme migration.
- Adding new preferences features while cleaning existing settings.
- Broad visual redesign of preferences or borders.
- Changing window-rule grammar while adding configuration validation.
- Treating file length alone as proof that a module must be split.
- Fixing native Mutter monitor churn inside Anvil unless new evidence places the fault in the
  extension.
