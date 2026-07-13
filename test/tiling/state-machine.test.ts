import { describe, expect, it } from "vitest";

import {
  createTilingStateMachine,
  surfaceId,
  windowId,
  type TilingPolicy,
} from "../../src/lib/tiling/index.js";

const policy: TilingPolicy = {
  enabled: true,
  surfaceTiling: {},
  allowedLayouts: ["horizontal", "vertical", "stacked", "tabbed"],
  defaultLayout: "horizontal",
  gap: 0,
  hideGapWhenSingle: false,
  autoSplit: false,
  singleTabExit: "preserve",
  headerExtent: 0,
  constraints: {},
  participationRules: [],
  reconcileAttempts: 3,
};

describe("TilingStateMachine", () => {
  it("starts with one immutable empty revision", () => {
    const machine = createTilingStateMachine(policy);

    expect(machine.inspect()).toEqual({
      schemaVersion: 1,
      revision: 0,
      policy,
      surfaces: [],
      windows: [],
      containers: [],
      operations: [],
      placementHints: [],
      evacuationHints: [],
      renderPlan: {
        revision: 0,
        surfaces: [],
        windows: [],
        containers: [],
        previews: [],
      },
      diagnostics: [],
    });
  });

  it("observes a Surface as one root layout coordinate space", () => {
    const machine = createTilingStateMachine(policy);
    const primary = surfaceId("primary");

    const transition = machine.dispatch({
      type: "PlatformSnapshotObserved",
      snapshot: {
        surfaces: [
          {
            id: primary,
            workArea: { x: 0, y: 0, width: 1920, height: 1080 },
            neighbors: {},
            capabilities: { focus: true, raise: true, move: true, resize: true },
          },
        ],
        windows: [],
      },
    });

    expect(transition).toEqual({
      status: "committed",
      revision: 1,
      intentions: [],
      diagnostics: [],
    });
    expect(machine.inspect()).toMatchObject({
      revision: 1,
      surfaces: [
        {
          id: primary,
          workArea: { x: 0, y: 0, width: 1920, height: 1080 },
          rootId: "container:1",
          neighbors: {},
        },
      ],
      containers: [
        {
          id: "container:1",
          surfaceId: primary,
          layout: "horizontal",
          childIds: [],
        },
      ],
      renderPlan: {
        revision: 1,
        surfaces: [{ id: primary, workArea: { x: 0, y: 0, width: 1920, height: 1080 } }],
        windows: [],
      },
    });
  });

  it("accepts exactly one bootstrap snapshot per machine lifetime", () => {
    const machine = createTilingStateMachine(policy);
    const primary = surfaceId("primary");
    const snapshot = {
      surfaces: [
        {
          id: primary,
          workArea: { x: 0, y: 0, width: 1920, height: 1080 },
          neighbors: {},
          capabilities: { focus: true, raise: true, move: true, resize: true },
        },
      ],
      windows: [],
    } as const;
    machine.dispatch({ type: "PlatformSnapshotObserved", snapshot });

    expect(machine.dispatch({ type: "PlatformSnapshotObserved", snapshot })).toMatchObject({
      status: "rejected",
      revision: 1,
      diagnostics: [{ code: "already-bootstrapped" }],
    });
    expect(machine.inspect().surfaces[0].rootId).toBe("container:1");
  });

  it("does not consume container identities when a candidate is rejected", () => {
    const machine = createTilingStateMachine(policy);
    const primary = surfaceId("primary");
    const missing = surfaceId("missing");
    const capabilities = { focus: true, raise: true, move: true, resize: true };
    machine.dispatch({ type: "PlatformSnapshotObserved", snapshot: { surfaces: [], windows: [] } });

    expect(
      machine.dispatch({
        type: "FactsObserved",
        facts: [
          {
            type: "SurfaceObserved",
            surface: {
              id: primary,
              workArea: { x: 0, y: 0, width: 1000, height: 800 },
              neighbors: { right: missing },
              capabilities,
            },
          },
        ],
      })
    ).toMatchObject({ status: "rejected" });

    machine.dispatch({
      type: "FactsObserved",
      facts: [
        {
          type: "SurfaceObserved",
          surface: {
            id: primary,
            workArea: { x: 0, y: 0, width: 1000, height: 800 },
            neighbors: {},
            capabilities,
          },
        },
      ],
    });
    expect(machine.inspect().surfaces[0].rootId).toBe("container:1");
  });

  it("admits available windows and derives split geometry", () => {
    const machine = createTilingStateMachine(policy);
    const primary = surfaceId("primary");
    const left = windowId("left");
    const right = windowId("right");
    const capabilities = { focus: true, raise: true, move: true, resize: true };

    const transition = machine.dispatch({
      type: "PlatformSnapshotObserved",
      snapshot: {
        surfaces: [
          {
            id: primary,
            workArea: { x: 0, y: 0, width: 1920, height: 1080 },
            neighbors: {},
            capabilities,
          },
        ],
        windows: [
          {
            id: left,
            surfaceId: primary,
            frame: { x: 100, y: 100, width: 600, height: 400 },
            available: true,
            capabilities,
          },
          {
            id: right,
            surfaceId: primary,
            frame: { x: 200, y: 100, width: 600, height: 400 },
            available: true,
            capabilities,
          },
        ],
      },
    });

    expect(transition.intentions).toEqual([
      {
        type: "WindowParticipationChanged",
        revision: 1,
        ordinal: 0,
        windowId: left,
        participating: true,
      },
      {
        type: "WindowParticipationChanged",
        revision: 1,
        ordinal: 1,
        windowId: right,
        participating: true,
      },
      {
        type: "PlaceWindow",
        revision: 1,
        ordinal: 2,
        windowId: left,
        surfaceId: primary,
        frame: { x: 0, y: 0, width: 960, height: 1080 },
      },
      {
        type: "PlaceWindow",
        revision: 1,
        ordinal: 3,
        windowId: right,
        surfaceId: primary,
        frame: { x: 960, y: 0, width: 960, height: 1080 },
      },
    ]);
    expect(machine.inspect()).toMatchObject({
      windows: [
        {
          id: left,
          surfaceId: primary,
          parentId: "container:1",
          participating: true,
          available: true,
        },
        {
          id: right,
          surfaceId: primary,
          parentId: "container:1",
          participating: true,
          available: true,
        },
      ],
      containers: [{ id: "container:1", childIds: [left, right] }],
      renderPlan: {
        windows: [
          {
            id: left,
            surfaceId: primary,
            frame: { x: 0, y: 0, width: 960, height: 1080 },
          },
          {
            id: right,
            surfaceId: primary,
            frame: { x: 960, y: 0, width: 960, height: 1080 },
          },
        ],
      },
    });
  });

  it("keeps windows outside topology when placement capabilities are unavailable", () => {
    const machine = createTilingStateMachine(policy);
    const primary = surfaceId("primary");
    const fixed = windowId("fixed");
    machine.dispatch({
      type: "PlatformSnapshotObserved",
      snapshot: {
        surfaces: [
          {
            id: primary,
            workArea: { x: 0, y: 0, width: 1000, height: 800 },
            neighbors: {},
            capabilities: { focus: true, raise: true, move: true, resize: true },
          },
        ],
        windows: [
          {
            id: fixed,
            surfaceId: primary,
            frame: { x: 0, y: 0, width: 400, height: 300 },
            available: true,
            capabilities: { focus: true, raise: true, move: true, resize: false },
          },
        ],
      },
    });

    expect(machine.inspect()).toMatchObject({
      windows: [{ id: fixed, policyParticipation: true, participating: false }],
      containers: [{ childIds: [] }],
      renderPlan: { windows: [] },
    });
  });

  it("reevaluates participation when Surface capabilities change", () => {
    const machine = createTilingStateMachine(policy);
    const primary = surfaceId("primary");
    const terminal = windowId("terminal");
    const surface = {
      id: primary,
      workArea: { x: 0, y: 0, width: 1000, height: 800 },
      neighbors: {},
      capabilities: { focus: true, raise: true, move: true, resize: true },
    } as const;
    machine.dispatch({
      type: "PlatformSnapshotObserved",
      snapshot: {
        surfaces: [surface],
        windows: [
          {
            id: terminal,
            surfaceId: primary,
            frame: { x: 0, y: 0, width: 1000, height: 800 },
            available: true,
            capabilities: surface.capabilities,
          },
        ],
      },
    });

    const disabled = machine.dispatch({
      type: "FactsObserved",
      facts: [
        {
          type: "SurfaceObserved",
          surface: {
            ...surface,
            capabilities: { ...surface.capabilities, resize: false },
          },
        },
      ],
    });

    expect(disabled).toMatchObject({
      status: "committed",
      intentions: [
        { type: "WindowParticipationChanged", windowId: terminal, participating: false },
      ],
    });
    expect(machine.inspect()).toMatchObject({
      windows: [{ id: terminal, participating: false }],
      containers: [{ childIds: [] }],
      renderPlan: { windows: [] },
    });

    machine.dispatch({ type: "FactsObserved", facts: [{ type: "SurfaceObserved", surface }] });
    expect(machine.inspect()).toMatchObject({
      windows: [{ id: terminal, participating: true }],
      containers: [{ childIds: [terminal] }],
    });
  });

  it("retains placement while an unavailable window leaves allocation", () => {
    const machine = createTilingStateMachine(policy);
    const primary = surfaceId("primary");
    const left = windowId("left");
    const right = windowId("right");
    const capabilities = { focus: true, raise: true, move: true, resize: true };
    machine.dispatch({
      type: "PlatformSnapshotObserved",
      snapshot: {
        surfaces: [
          {
            id: primary,
            workArea: { x: 0, y: 0, width: 1000, height: 800 },
            neighbors: {},
            capabilities,
          },
        ],
        windows: [left, right].map((id) => ({
          id,
          surfaceId: primary,
          frame: { x: 0, y: 0, width: 500, height: 800 },
          available: true,
          capabilities,
        })),
      },
    });

    const transition = machine.dispatch({
      type: "FactsObserved",
      facts: [{ type: "WindowAvailabilityObserved", windowId: left, available: false }],
    });

    expect(transition).toMatchObject({
      status: "committed",
      revision: 2,
      intentions: [
        {
          type: "PlaceWindow",
          windowId: right,
          surfaceId: primary,
          frame: { x: 0, y: 0, width: 1000, height: 800 },
        },
      ],
    });
    expect(machine.inspect()).toMatchObject({
      windows: [
        { id: left, participating: true, available: false, parentId: "container:1" },
        { id: right, participating: true, available: true, parentId: "container:1" },
      ],
      containers: [{ childIds: [left, right] }],
      renderPlan: {
        windows: [
          {
            id: right,
            surfaceId: primary,
            frame: { x: 0, y: 0, width: 1000, height: 800 },
          },
        ],
      },
    });

    expect(
      machine.dispatch({
        type: "FactsObserved",
        facts: [{ type: "WindowAvailabilityObserved", windowId: left, available: false }],
      })
    ).toEqual({ status: "ignored", revision: 2, intentions: [], diagnostics: [] });
  });

  it("preserves participation intent across per-Surface policy changes", () => {
    const machine = createTilingStateMachine(policy);
    const primary = surfaceId("primary");
    const terminal = windowId("terminal");
    const capabilities = { focus: true, raise: true, move: true, resize: true };
    machine.dispatch({
      type: "PlatformSnapshotObserved",
      snapshot: {
        surfaces: [
          {
            id: primary,
            workArea: { x: 0, y: 0, width: 1200, height: 900 },
            neighbors: {},
            capabilities,
          },
        ],
        windows: [
          {
            id: terminal,
            surfaceId: primary,
            frame: { x: 0, y: 0, width: 1200, height: 900 },
            available: true,
            capabilities,
          },
        ],
      },
    });

    const disabled = machine.dispatch({
      type: "PolicyReplaced",
      policy: { ...policy, surfaceTiling: { [primary]: false } },
    });

    expect(disabled).toMatchObject({
      status: "committed",
      revision: 2,
      intentions: [
        {
          type: "WindowParticipationChanged",
          windowId: terminal,
          participating: false,
        },
      ],
    });
    expect(machine.inspect()).toMatchObject({
      windows: [{ id: terminal, participating: false }],
      containers: [{ childIds: [] }],
      placementHints: [
        { windowId: terminal, surfaceId: primary, parentId: "container:1", selected: false },
      ],
      renderPlan: { windows: [] },
    });

    const enabled = machine.dispatch({ type: "PolicyReplaced", policy });
    expect(enabled).toMatchObject({
      status: "committed",
      revision: 3,
      intentions: [
        {
          type: "WindowParticipationChanged",
          windowId: terminal,
          participating: true,
        },
        {
          type: "PlaceWindow",
          windowId: terminal,
          surfaceId: primary,
          frame: { x: 0, y: 0, width: 1200, height: 900 },
        },
      ],
    });
    expect(machine.inspect()).toMatchObject({
      windows: [{ id: terminal, participating: true, parentId: "container:1" }],
      containers: [{ childIds: [terminal] }],
    });
  });

  it("withdraws a window before retiling its surviving sibling", () => {
    const machine = createTilingStateMachine(policy);
    const primary = surfaceId("primary");
    const removed = windowId("removed");
    const survivor = windowId("survivor");
    const capabilities = { focus: true, raise: true, move: true, resize: true };
    machine.dispatch({
      type: "PlatformSnapshotObserved",
      snapshot: {
        surfaces: [
          {
            id: primary,
            workArea: { x: 0, y: 0, width: 1000, height: 800 },
            neighbors: {},
            capabilities,
          },
        ],
        windows: [removed, survivor].map((id) => ({
          id,
          surfaceId: primary,
          frame: { x: 0, y: 0, width: 500, height: 800 },
          available: true,
          capabilities,
        })),
      },
    });

    const transition = machine.dispatch({
      type: "FactsObserved",
      facts: [{ type: "WindowWithdrawn", windowId: removed }],
    });

    expect(transition).toMatchObject({
      status: "committed",
      revision: 2,
      intentions: [
        {
          type: "PlaceWindow",
          windowId: survivor,
          frame: { x: 0, y: 0, width: 1000, height: 800 },
        },
      ],
    });
    expect(machine.inspect()).toMatchObject({
      windows: [{ id: survivor }],
      containers: [{ childIds: [survivor] }],
      renderPlan: { windows: [{ id: survivor }] },
    });
  });

  it("evacuates and restores a Surface without exposing its platform composition", () => {
    const machine = createTilingStateMachine(policy);
    const primary = surfaceId("primary");
    const terminal = windowId("terminal");
    const capabilities = { focus: true, raise: true, move: true, resize: true };
    const surface = {
      id: primary,
      workArea: { x: 0, y: 0, width: 1200, height: 900 },
      neighbors: {},
      capabilities,
    } as const;
    machine.dispatch({
      type: "PlatformSnapshotObserved",
      snapshot: {
        surfaces: [surface],
        windows: [
          {
            id: terminal,
            surfaceId: primary,
            frame: { x: 0, y: 0, width: 1200, height: 900 },
            available: true,
            capabilities,
          },
        ],
      },
    });

    const withdrawn = machine.dispatch({
      type: "FactsObserved",
      facts: [{ type: "SurfaceWithdrawn", surfaceId: primary }],
    });
    expect(withdrawn).toMatchObject({
      status: "committed",
      revision: 2,
      intentions: [
        {
          type: "WindowParticipationChanged",
          windowId: terminal,
          participating: false,
        },
      ],
    });
    expect(machine.inspect()).toMatchObject({
      surfaces: [],
      containers: [],
      windows: [{ id: terminal, surfaceId: primary, participating: false }],
      evacuationHints: [
        {
          surfaceId: primary,
          rootId: "container:1",
          windowIds: [terminal],
          containers: [
            {
              id: "container:1",
              layout: "horizontal",
              childIds: [terminal],
            },
          ],
        },
      ],
      renderPlan: { surfaces: [], windows: [], containers: [] },
    });

    const restored = machine.dispatch({
      type: "FactsObserved",
      facts: [{ type: "SurfaceObserved", surface }],
    });
    expect(restored).toMatchObject({
      status: "committed",
      revision: 3,
      intentions: [
        {
          type: "WindowParticipationChanged",
          windowId: terminal,
          participating: true,
        },
        {
          type: "PlaceWindow",
          windowId: terminal,
          surfaceId: primary,
          frame: { x: 0, y: 0, width: 1200, height: 900 },
        },
      ],
    });
    expect(machine.inspect()).toMatchObject({
      surfaces: [{ id: primary, rootId: "container:1" }],
      containers: [{ id: "container:1", childIds: [terminal], layout: "horizontal" }],
      windows: [{ id: terminal, participating: true, parentId: "container:1" }],
      evacuationHints: [],
    });
  });

  it("keeps manual participation separate from ordered rule classification", () => {
    const pipPolicy: TilingPolicy = {
      ...policy,
      participationRules: [{ id: "float-pip", action: "float", role: "picture-in-picture" }],
    };
    const machine = createTilingStateMachine(pipPolicy);
    const primary = surfaceId("primary");
    const pip = windowId("pip");
    const capabilities = { focus: true, raise: true, move: true, resize: true };
    machine.dispatch({
      type: "PlatformSnapshotObserved",
      snapshot: {
        surfaces: [
          {
            id: primary,
            workArea: { x: 0, y: 0, width: 1200, height: 900 },
            neighbors: {},
            capabilities,
          },
        ],
        windows: [
          {
            id: pip,
            surfaceId: primary,
            frame: { x: 900, y: 600, width: 300, height: 300 },
            available: true,
            capabilities,
            applicationId: "org.example.Player",
            role: "picture-in-picture",
          },
        ],
      },
    });
    expect(machine.inspect()).toMatchObject({
      windows: [
        {
          id: pip,
          participating: false,
          policyParticipation: false,
          participationSource: "rule:float-pip",
        },
      ],
    });

    const forced = machine.dispatch({
      type: "CommandRequested",
      command: { type: "SetParticipation", windowId: pip, participating: true },
    });
    expect(forced).toMatchObject({
      status: "committed",
      revision: 2,
      intentions: [
        {
          type: "WindowParticipationChanged",
          windowId: pip,
          participating: true,
        },
        {
          type: "PlaceWindow",
          windowId: pip,
          frame: { x: 0, y: 0, width: 1200, height: 900 },
        },
      ],
    });
    expect(machine.inspect()).toMatchObject({
      windows: [
        {
          id: pip,
          manualParticipation: true,
          policyParticipation: false,
          participationSource: "manual",
          participating: true,
        },
      ],
    });
  });

  it("gives matching force-tile rules precedence over automatic float rules", () => {
    const overridePolicy: TilingPolicy = {
      ...policy,
      participationRules: [
        { id: "float-dialog", action: "float", tags: ["dialog"] },
        { id: "force-special", action: "tile", applicationId: "~special-app" },
      ],
    };
    const machine = createTilingStateMachine(overridePolicy);
    const primary = surfaceId("primary");
    const special = windowId("special");
    const capabilities = { focus: true, raise: true, move: true, resize: true };

    machine.dispatch({
      type: "PlatformSnapshotObserved",
      snapshot: {
        surfaces: [
          {
            id: primary,
            workArea: { x: 0, y: 0, width: 1000, height: 800 },
            neighbors: {},
            capabilities,
          },
        ],
        windows: [
          {
            id: special,
            surfaceId: primary,
            frame: { x: 0, y: 0, width: 500, height: 500 },
            available: true,
            capabilities,
            applicationId: "ORG.EXAMPLE.SPECIAL-APP",
            tags: ["dialog"],
          },
        ],
      },
    });

    expect(machine.inspect()).toMatchObject({
      windows: [
        {
          id: special,
          participating: true,
          policyParticipationSource: "rule:force-special",
        },
      ],
    });
  });

  it("applies gaps and Surface constraints only to derived frames", () => {
    const primary = surfaceId("primary");
    const constrainedPolicy: TilingPolicy = {
      ...policy,
      gap: 10,
      constraints: { [primary]: { maxWidth: 600, maxHeight: 0 } },
    };
    const machine = createTilingStateMachine(constrainedPolicy);
    const terminal = windowId("terminal");
    const capabilities = { focus: true, raise: true, move: true, resize: true };

    machine.dispatch({
      type: "PlatformSnapshotObserved",
      snapshot: {
        surfaces: [
          {
            id: primary,
            workArea: { x: 0, y: 0, width: 1000, height: 800 },
            neighbors: {},
            capabilities,
          },
        ],
        windows: [
          {
            id: terminal,
            surfaceId: primary,
            frame: { x: 0, y: 0, width: 500, height: 500 },
            available: true,
            capabilities,
          },
        ],
      },
    });

    expect(machine.inspect()).toMatchObject({
      containers: [{ weights: {} }],
      renderPlan: {
        windows: [
          {
            id: terminal,
            frame: { x: 200, y: 10, width: 600, height: 780 },
          },
        ],
      },
    });
  });

  it("reflects known client minimum sizes in desired applied frames", () => {
    const primary = surfaceId("primary");
    const machine = createTilingStateMachine({ ...policy, defaultLayout: "vertical" });
    const capabilities = { focus: true, raise: true, move: true, resize: true };
    const windows = [windowId("first"), windowId("second"), windowId("third")];

    machine.dispatch({
      type: "PlatformSnapshotObserved",
      snapshot: {
        surfaces: [
          {
            id: primary,
            workArea: { x: 0, y: 0, width: 1000, height: 1048 },
            neighbors: {},
            capabilities,
          },
        ],
        windows: windows.map((id) => ({
          id,
          surfaceId: primary,
          frame: { x: 0, y: 0, width: 1000, height: 380 },
          available: true,
          capabilities,
          minimumSize: { width: 120, height: 380 },
        })),
      },
    });

    expect(machine.inspect().renderPlan.windows).toEqual([
      { id: windows[0], surfaceId: primary, frame: { x: 0, y: 0, width: 1000, height: 380 } },
      {
        id: windows[1],
        surfaceId: primary,
        frame: { x: 0, y: 349, width: 1000, height: 380 },
      },
      {
        id: windows[2],
        surfaceId: primary,
        frame: { x: 0, y: 698, width: 1000, height: 380 },
      },
    ]);
  });

  it("discovers and reassigns a window using only Surface identities", () => {
    const machine = createTilingStateMachine(policy);
    const left = surfaceId("left");
    const right = surfaceId("right");
    const terminal = windowId("terminal");
    const capabilities = { focus: true, raise: true, move: true, resize: true };
    machine.dispatch({
      type: "PlatformSnapshotObserved",
      snapshot: {
        surfaces: [
          {
            id: left,
            workArea: { x: 0, y: 0, width: 1000, height: 800 },
            neighbors: { right },
            capabilities,
          },
          {
            id: right,
            workArea: { x: 0, y: 0, width: 1200, height: 900 },
            neighbors: { left },
            capabilities,
          },
        ],
        windows: [],
      },
    });

    const discovered = machine.dispatch({
      type: "FactsObserved",
      facts: [
        {
          type: "WindowObserved",
          window: {
            id: terminal,
            surfaceId: left,
            frame: { x: 20, y: 20, width: 500, height: 400 },
            available: true,
            capabilities,
            applicationId: "org.example.Terminal",
          },
        },
      ],
    });
    expect(discovered).toMatchObject({
      status: "committed",
      revision: 2,
      intentions: [
        { type: "WindowParticipationChanged", windowId: terminal, participating: true },
        {
          type: "PlaceWindow",
          windowId: terminal,
          surfaceId: left,
          frame: { x: 0, y: 0, width: 1000, height: 800 },
        },
      ],
    });

    const reassigned = machine.dispatch({
      type: "FactsObserved",
      facts: [{ type: "WindowSurfaceObserved", windowId: terminal, surfaceId: right }],
    });
    expect(reassigned).toMatchObject({
      status: "committed",
      revision: 3,
      intentions: [
        {
          type: "PlaceWindow",
          windowId: terminal,
          surfaceId: right,
          frame: { x: 0, y: 0, width: 1200, height: 900 },
        },
      ],
    });
    expect(machine.inspect()).toMatchObject({
      windows: [{ id: terminal, surfaceId: right, parentId: "container:2" }],
      containers: [
        { id: "container:1", surfaceId: left, childIds: [] },
        { id: "container:2", surfaceId: right, childIds: [terminal] },
      ],
    });
  });

  it("observes compositor focus as selection without reordering topology", () => {
    const machine = createTilingStateMachine(policy);
    const primary = surfaceId("primary");
    const first = windowId("first");
    const second = windowId("second");
    const capabilities = { focus: true, raise: true, move: true, resize: true };
    machine.dispatch({
      type: "PlatformSnapshotObserved",
      snapshot: {
        surfaces: [
          {
            id: primary,
            workArea: { x: 0, y: 0, width: 1000, height: 800 },
            neighbors: {},
            capabilities,
          },
        ],
        windows: [first, second].map((id) => ({
          id,
          surfaceId: primary,
          frame: { x: 0, y: 0, width: 500, height: 800 },
          available: true,
          capabilities,
        })),
        focusedWindowId: first,
      },
    });

    expect(machine.inspect().renderPlan.containers[0]).toMatchObject({
      selectedChildId: first,
      stackingOrder: [first, second],
    });
    const before = machine.inspect().containers[0].childIds;
    const transition = machine.dispatch({
      type: "FactsObserved",
      facts: [{ type: "FocusObserved", windowId: second }],
    });

    expect(transition).toMatchObject({ status: "committed", revision: 2, intentions: [] });
    expect(machine.inspect()).toMatchObject({
      focusedWindowId: second,
      containers: [{ selectedChildId: second, childIds: before }],
    });
  });

  it("does not reinterpret metadata observation as a structural move", () => {
    const machine = createTilingStateMachine(policy);
    const primary = surfaceId("primary");
    const first = windowId("first");
    const second = windowId("second");
    const capabilities = { focus: true, raise: true, move: true, resize: true };
    machine.dispatch({
      type: "PlatformSnapshotObserved",
      snapshot: {
        surfaces: [
          {
            id: primary,
            workArea: { x: 0, y: 0, width: 1000, height: 800 },
            neighbors: {},
            capabilities,
          },
        ],
        windows: [first, second].map((id) => ({
          id,
          surfaceId: primary,
          frame: { x: 0, y: 0, width: 500, height: 800 },
          available: true,
          capabilities,
        })),
      },
    });

    machine.dispatch({
      type: "FactsObserved",
      facts: [
        {
          type: "WindowObserved",
          window: {
            id: first,
            surfaceId: primary,
            frame: { x: 0, y: 0, width: 500, height: 800 },
            available: true,
            capabilities,
            title: "metadata arrived",
          },
        },
      ],
    });

    expect(machine.inspect().containers[0].childIds).toEqual([first, second]);
  });

  it("inserts an observed window batch after selection in fact order", () => {
    const machine = createTilingStateMachine(policy);
    const primary = surfaceId("primary");
    const first = windowId("first");
    const second = windowId("second");
    const third = windowId("third");
    const last = windowId("last");
    const capabilities = { focus: true, raise: true, move: true, resize: true };
    const observed = (id: typeof first) => ({
      id,
      surfaceId: primary,
      frame: { x: 0, y: 0, width: 250, height: 800 },
      available: true,
      capabilities,
    });
    machine.dispatch({
      type: "PlatformSnapshotObserved",
      snapshot: {
        surfaces: [
          {
            id: primary,
            workArea: { x: 0, y: 0, width: 1000, height: 800 },
            neighbors: {},
            capabilities,
          },
        ],
        windows: [observed(first), observed(last)],
        focusedWindowId: first,
      },
    });

    machine.dispatch({
      type: "FactsObserved",
      facts: [
        { type: "WindowObserved", window: observed(second) },
        { type: "WindowObserved", window: observed(third) },
      ],
    });

    expect(machine.inspect().containers[0].childIds).toEqual([first, second, third, last]);
  });

  it("preserves snapshot admission order independently of canonical identity sorting", () => {
    const machine = createTilingStateMachine(policy);
    const primary = surfaceId("primary");
    const capabilities = { focus: true, raise: true, move: true, resize: true };
    const orderedIds = Array.from({ length: 11 }, (_, index) => windowId(`window:${index + 1}`));

    machine.dispatch({
      type: "PlatformSnapshotObserved",
      snapshot: {
        surfaces: [
          {
            id: primary,
            workArea: { x: 0, y: 0, width: 1100, height: 800 },
            neighbors: {},
            capabilities,
          },
        ],
        windows: orderedIds.map((id) => ({
          id,
          surfaceId: primary,
          frame: { x: 0, y: 0, width: 100, height: 800 },
          available: true,
          capabilities,
        })),
      },
    });

    expect(machine.inspect().containers[0].childIds).toEqual(orderedIds);
    expect(machine.inspect().windows.map((window) => window.id)).toEqual(
      [...orderedIds].sort((left, right) => left.localeCompare(right))
    );
  });
});
