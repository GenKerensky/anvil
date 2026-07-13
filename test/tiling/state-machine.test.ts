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
});
