import { describe, expect, it } from "vitest";

import {
  createTilingStateMachine,
  operationId,
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

function resizeMachine() {
  const machine = createTilingStateMachine(policy);
  const surface = surfaceId("surface");
  const first = windowId("first");
  const second = windowId("second");
  const capabilities = { focus: true, raise: true, move: true, resize: true };
  machine.dispatch({
    type: "PlatformSnapshotObserved",
    snapshot: {
      surfaces: [
        {
          id: surface,
          workArea: { x: 0, y: 0, width: 1000, height: 800 },
          neighbors: {},
          capabilities,
        },
      ],
      windows: [first, second].map((id) => ({
        id,
        surfaceId: surface,
        frame: { x: 0, y: 0, width: 500, height: 800 },
        available: true,
        capabilities,
      })),
    },
  });
  return { machine, surface, first, second };
}

describe("Tiling Operations", () => {
  it("resizes two nested axes under one operation identity", () => {
    const { machine, surface, first, second } = resizeMachine();
    machine.dispatch({
      type: "FactsObserved",
      facts: [{ type: "FocusObserved", windowId: first }],
    });
    machine.dispatch({
      type: "CommandRequested",
      command: { type: "Split", windowId: first, layout: "vertical" },
    });
    const third = windowId("third");
    machine.dispatch({
      type: "FactsObserved",
      facts: [
        {
          type: "WindowObserved",
          window: {
            id: third,
            surfaceId: surface,
            frame: { x: 0, y: 0, width: 500, height: 400 },
            available: true,
            capabilities: { focus: true, raise: true, move: true, resize: true },
          },
        },
      ],
    });

    const operation = operationId("nested-ancestor");
    expect(
      machine.dispatch({
        type: "OperationStarted",
        operation: {
          id: operation,
          kind: "resize",
          windowId: first,
          directions: ["down", "right"],
        },
      })
    ).toMatchObject({ status: "committed" });
    expect(machine.inspect().operations).toEqual([
      expect.objectContaining({
        id: operation,
        windowId: first,
        boundaries: [
          expect.objectContaining({
            neighborWindowId: second,
            containerId: "container:1",
            primaryChildId: "container:2",
            neighborChildId: second,
          }),
          expect.objectContaining({
            neighborWindowId: third,
            containerId: "container:2",
            primaryChildId: first,
            neighborChildId: third,
          }),
        ],
      }),
    ]);

    machine.dispatch({
      type: "OperationUpdated",
      operationId: operation,
      update: { shareDeltas: { right: 0.1, down: 0.1 } },
    });
    expect(machine.inspect().renderPlan.windows).toEqual([
      expect.objectContaining({ id: first, frame: { x: 0, y: 0, width: 600, height: 480 } }),
      expect.objectContaining({ id: second, frame: { x: 600, y: 0, width: 400, height: 800 } }),
      expect.objectContaining({ id: third, frame: { x: 0, y: 480, width: 600, height: 320 } }),
    ]);

    expect(machine.dispatch({ type: "OperationCommitted", operationId: operation })).toMatchObject({
      status: "committed",
    });
    expect(machine.inspect()).toMatchObject({
      operations: [],
      containers: [
        { id: "container:1", weights: { "container:2": 0.6, [second]: 0.4 } },
        { id: "container:2", weights: { [first]: 0.6, [third]: 0.4 } },
      ],
    });
  });

  it("rejects a two-axis start unless both resize boundaries resolve", () => {
    const { machine, first } = resizeMachine();

    const transition = machine.dispatch({
      type: "OperationStarted",
      operation: {
        id: operationId("partial-diagonal"),
        kind: "resize",
        windowId: first,
        directions: ["right", "down"],
      },
    });

    expect(transition).toMatchObject({
      status: "rejected",
      diagnostics: [{ code: "missing-resize-neighbor" }],
    });
    expect(machine.inspect().operations).toEqual([]);
  });

  it("rejects malformed operation events without changing revision", () => {
    const { machine, first } = resizeMachine();
    const revision = machine.inspect().revision;

    expect(
      machine.dispatch({
        type: "OperationStarted",
        operation: {
          id: operationId("malformed"),
          kind: "resize",
          windowId: first,
          directions: ["sideways"],
        },
      } as never)
    ).toMatchObject({
      status: "rejected",
      revision,
      diagnostics: [{ code: "invalid-operation-directions" }],
    });
    expect(machine.inspect().revision).toBe(revision);
  });

  it("rejects empty and irrelevant updates and ignores repeated overlays", () => {
    const { machine, first } = resizeMachine();
    const operation = operationId("validated-update");
    machine.dispatch({
      type: "OperationStarted",
      operation: { id: operation, kind: "resize", windowId: first, directions: ["right"] },
    });
    const revision = machine.inspect().revision;

    for (const shareDeltas of [{}, { down: 0.1 }, { sideways: 0.1 }]) {
      expect(
        machine.dispatch({
          type: "OperationUpdated",
          operationId: operation,
          update: { shareDeltas },
        } as never)
      ).toMatchObject({
        status: "rejected",
        revision,
        diagnostics: [{ code: "invalid-operation-update" }],
      });
    }

    expect(
      machine.dispatch({
        type: "OperationUpdated",
        operationId: operation,
        update: { shareDeltas: { right: 0.1 } },
      })
    ).toMatchObject({ status: "committed", revision: revision + 1 });
    expect(
      machine.dispatch({
        type: "OperationUpdated",
        operationId: operation,
        update: { shareDeltas: { right: 0.1 } },
      })
    ).toEqual({
      status: "ignored",
      revision: revision + 1,
      intentions: [],
      diagnostics: [],
    });
  });

  it("previews resize weights and cancels back to current base state", () => {
    const { machine, first, second } = resizeMachine();
    const operation = operationId("resize-1");

    expect(
      machine.dispatch({
        type: "OperationStarted",
        operation: {
          id: operation,
          kind: "resize",
          windowId: first,
          directions: ["right"],
        },
      })
    ).toEqual({ status: "committed", revision: 2, intentions: [], diagnostics: [] });

    const updated = machine.dispatch({
      type: "OperationUpdated",
      operationId: operation,
      update: { shareDeltas: { right: 0.1 } },
    });
    expect(updated).toMatchObject({
      status: "committed",
      revision: 3,
      intentions: [
        {
          type: "PlaceWindow",
          windowId: first,
          frame: { x: 0, y: 0, width: 600, height: 800 },
        },
        {
          type: "PlaceWindow",
          windowId: second,
          frame: { x: 600, y: 0, width: 400, height: 800 },
        },
      ],
    });
    expect(machine.inspect()).toMatchObject({
      operations: [
        {
          id: operation,
          kind: "resize",
          windowId: first,
          boundaries: [
            {
              containerId: "container:1",
              baseWeights: { [first]: 0.5, [second]: 0.5 },
              overlayWeights: { [first]: 0.6, [second]: 0.4 },
            },
          ],
        },
      ],
      containers: [{ weights: {} }],
    });

    const cancelled = machine.dispatch({ type: "OperationCancelled", operationId: operation });
    expect(cancelled).toMatchObject({
      status: "committed",
      revision: 4,
      intentions: [
        {
          type: "PlaceWindow",
          windowId: first,
          frame: { x: 0, y: 0, width: 500, height: 800 },
        },
        {
          type: "PlaceWindow",
          windowId: second,
          frame: { x: 500, y: 0, width: 500, height: 800 },
        },
      ],
    });
    expect(machine.inspect().operations).toEqual([]);
  });

  it("resolves an outer resize edge to the opposite sibling", () => {
    const { machine, first, second } = resizeMachine();

    expect(
      machine.dispatch({
        type: "OperationStarted",
        operation: {
          id: operationId("outer-edge"),
          kind: "resize",
          windowId: second,
          directions: ["right"],
        },
      })
    ).toMatchObject({ status: "committed" });
    expect(machine.inspect().operations).toEqual([
      expect.objectContaining({
        windowId: second,
        boundaries: [expect.objectContaining({ neighborWindowId: first, direction: "left" })],
      }),
    ]);
  });

  it("cancels an operation inside a topology-invalidating transition", () => {
    const { machine, first, second } = resizeMachine();
    const operation = operationId("resize-1");
    machine.dispatch({
      type: "OperationStarted",
      operation: { id: operation, kind: "resize", windowId: first, directions: ["right"] },
    });

    const transition = machine.dispatch({
      type: "FactsObserved",
      facts: [{ type: "WindowWithdrawn", windowId: second }],
    });

    expect(transition).toMatchObject({
      status: "committed",
      revision: 3,
      intentions: [
        {
          type: "PlaceWindow",
          windowId: first,
          frame: { x: 0, y: 0, width: 1000, height: 800 },
        },
      ],
    });
    expect(machine.inspect()).toMatchObject({
      operations: [],
      windows: [{ id: first }],
      containers: [{ childIds: [first] }],
    });
  });

  it("cancels an operation when another sibling changes the container topology", () => {
    const { machine, surface, first } = resizeMachine();
    const third = windowId("third");
    const capabilities = { focus: true, raise: true, move: true, resize: true };
    machine.dispatch({
      type: "FactsObserved",
      facts: [
        {
          type: "WindowObserved",
          window: {
            id: third,
            surfaceId: surface,
            frame: { x: 0, y: 0, width: 300, height: 800 },
            available: true,
            capabilities,
          },
        },
      ],
    });
    const operation = operationId("resize-sibling");
    machine.dispatch({
      type: "OperationStarted",
      operation: { id: operation, kind: "resize", windowId: first, directions: ["right"] },
    });

    machine.dispatch({
      type: "FactsObserved",
      facts: [{ type: "WindowWithdrawn", windowId: third }],
    });

    expect(machine.inspect().operations).toEqual([]);
    expect(
      machine.dispatch({
        type: "OperationUpdated",
        operationId: operation,
        update: { shareDeltas: { right: 0.1 } },
      })
    ).toMatchObject({ status: "ignored" });
  });

  it("rejects resize when an affected window cannot resize", () => {
    const { machine, surface, first } = resizeMachine();
    machine.dispatch({
      type: "FactsObserved",
      facts: [
        {
          type: "WindowObserved",
          window: {
            id: first,
            surfaceId: surface,
            frame: { x: 0, y: 0, width: 500, height: 800 },
            available: true,
            capabilities: { focus: true, raise: true, move: true, resize: false },
          },
        },
      ],
    });

    expect(
      machine.dispatch({
        type: "OperationStarted",
        operation: {
          id: operationId("unsupported"),
          kind: "resize",
          windowId: first,
          directions: ["right"],
        },
      })
    ).toMatchObject({
      status: "rejected",
      diagnostics: [{ code: "capability-unsupported" }],
    });
  });

  it("cancels a resize before changing its container layout", () => {
    const { machine, first } = resizeMachine();
    const operation = operationId("resize-layout");
    machine.dispatch({
      type: "OperationStarted",
      operation: { id: operation, kind: "resize", windowId: first, directions: ["right"] },
    });

    machine.dispatch({
      type: "CommandRequested",
      command: { type: "SetLayout", windowId: first, layout: "vertical" },
    });

    expect(machine.inspect().operations).toEqual([]);
    expect(
      machine.dispatch({
        type: "OperationUpdated",
        operationId: operation,
        update: { shareDeltas: { right: 0.1 } },
      })
    ).toMatchObject({ status: "ignored" });
  });
});
