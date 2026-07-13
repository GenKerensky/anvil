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

function dragMachine() {
  const machine = createTilingStateMachine(policy);
  const surface = surfaceId("surface");
  const first = windowId("first");
  const second = windowId("second");
  const third = windowId("third");
  const capabilities = { focus: true, raise: true, move: true, resize: true };
  machine.dispatch({
    type: "PlatformSnapshotObserved",
    snapshot: {
      surfaces: [
        {
          id: surface,
          workArea: { x: 0, y: 0, width: 900, height: 600 },
          neighbors: {},
          capabilities,
        },
      ],
      windows: [first, second, third].map((id) => ({
        id,
        surfaceId: surface,
        frame: { x: 0, y: 0, width: 300, height: 600 },
        available: true,
        capabilities,
      })),
    },
  });
  return { machine, surface, first, second, third };
}

describe("Tiling Drag Operations", () => {
  it("previews, cancels, and commits a center swap", () => {
    const { machine, surface, first, second, third } = dragMachine();
    const cancelledOperation = operationId("cancelled-swap");

    expect(
      machine.dispatch({
        type: "OperationStarted",
        operation: {
          id: cancelledOperation,
          kind: "drag",
          windowId: first,
          centerAction: "swap",
        },
      })
    ).toMatchObject({ status: "committed" });
    const previewTransition = machine.dispatch({
      type: "OperationUpdated",
      operationId: cancelledOperation,
      update: { pointer: { surfaceId: surface, x: 450, y: 300 } },
    });
    expect(previewTransition).toMatchObject({
      status: "committed",
      intentions: [
        {
          type: "PresentPreview",
          operationId: cancelledOperation,
          surfaceId: surface,
          rect: { x: 300, y: 0, width: 300, height: 600 },
        },
      ],
    });
    const previewIntention = previewTransition.intentions[0];
    if (previewIntention?.type !== "PresentPreview") {
      throw new Error("expected preview intention");
    }
    (previewIntention.rect as { width: number }).width = 1;
    expect(machine.inspect().renderPlan.previews[0].rect.width).toBe(300);
    expect(machine.inspect()).toMatchObject({
      operations: [
        {
          id: cancelledOperation,
          kind: "drag",
          placement: {
            kind: "swap",
            targetWindowId: second,
            region: "center",
          },
        },
      ],
      renderPlan: {
        previews: [
          {
            operationId: cancelledOperation,
            surfaceId: surface,
            rect: { x: 300, y: 0, width: 300, height: 600 },
          },
        ],
      },
    });

    expect(
      machine.dispatch({ type: "OperationCancelled", operationId: cancelledOperation })
    ).toMatchObject({
      intentions: [{ type: "ClearPreview", operationId: cancelledOperation }],
    });
    expect(machine.inspect()).toMatchObject({
      operations: [],
      containers: [{ childIds: [first, second, third] }],
      renderPlan: { previews: [] },
    });

    const committedOperation = operationId("committed-swap");
    machine.dispatch({
      type: "OperationStarted",
      operation: {
        id: committedOperation,
        kind: "drag",
        windowId: first,
        centerAction: "swap",
      },
    });
    machine.dispatch({
      type: "OperationUpdated",
      operationId: committedOperation,
      update: { pointer: { surfaceId: surface, x: 450, y: 300 } },
    });
    expect(
      machine.dispatch({ type: "OperationCommitted", operationId: committedOperation })
    ).toMatchObject({
      status: "committed",
      intentions: expect.arrayContaining([
        expect.objectContaining({ type: "ClearPreview", operationId: committedOperation }),
      ]),
    });
    expect(machine.inspect()).toMatchObject({
      operations: [],
      containers: [{ childIds: [second, first, third] }],
      renderPlan: { previews: [] },
    });
  });

  it("creates a nested split for an incompatible edge drop", () => {
    const { machine, surface, first, second, third } = dragMachine();
    const operation = operationId("top-edge");
    machine.dispatch({
      type: "OperationStarted",
      operation: {
        id: operation,
        kind: "drag",
        windowId: first,
        centerAction: "tabbed",
      },
    });

    machine.dispatch({
      type: "OperationUpdated",
      operationId: operation,
      update: { pointer: { surfaceId: surface, x: 450, y: 10 } },
    });

    expect(machine.inspect()).toMatchObject({
      operations: [
        {
          placement: {
            kind: "split",
            targetWindowId: second,
            region: "up",
            layout: "vertical",
          },
        },
      ],
      renderPlan: {
        previews: [
          {
            operationId: operation,
            rect: { x: 300, y: 0, width: 300, height: 300 },
          },
        ],
      },
    });

    machine.dispatch({ type: "OperationCommitted", operationId: operation });

    expect(machine.inspect()).toMatchObject({
      operations: [],
      containers: [
        { id: "container:1", childIds: ["container:2", third] },
        {
          id: "container:2",
          parentId: "container:1",
          layout: "vertical",
          childIds: [first, second],
        },
      ],
      renderPlan: { previews: [] },
    });
  });

  it("preserves an explicit unary Split container during a cross-parent swap", () => {
    const { machine, surface, first, second, third } = dragMachine();
    machine.dispatch({
      type: "CommandRequested",
      command: { type: "Split", windowId: first, layout: "vertical" },
    });
    const operation = operationId("swap-from-explicit-split");
    machine.dispatch({
      type: "OperationStarted",
      operation: {
        id: operation,
        kind: "drag",
        windowId: first,
        centerAction: "swap",
      },
    });
    machine.dispatch({
      type: "OperationUpdated",
      operationId: operation,
      update: { pointer: { surfaceId: surface, x: 450, y: 300 } },
    });

    machine.dispatch({ type: "OperationCommitted", operationId: operation });

    expect(machine.inspect()).toMatchObject({
      containers: [
        { id: "container:1", childIds: ["container:2", first, third] },
        {
          id: "container:2",
          parentId: "container:1",
          layout: "vertical",
          childIds: [second],
        },
      ],
      windows: [
        { id: first, parentId: "container:1" },
        { id: second, parentId: "container:2" },
        { id: third, parentId: "container:1" },
      ],
    });
  });

  it("inserts beside a target when its split axis is compatible", () => {
    const { machine, surface, first, second, third } = dragMachine();
    const operation = operationId("right-insert");
    machine.dispatch({
      type: "OperationStarted",
      operation: {
        id: operation,
        kind: "drag",
        windowId: first,
        centerAction: "swap",
      },
    });

    machine.dispatch({
      type: "OperationUpdated",
      operationId: operation,
      update: { pointer: { surfaceId: surface, x: 590, y: 300 } },
    });

    expect(machine.inspect().operations).toEqual([
      expect.objectContaining({
        placement: expect.objectContaining({
          kind: "insert",
          targetWindowId: second,
          region: "right",
          referenceChildId: third,
        }),
      }),
    ]);
    machine.dispatch({ type: "OperationCommitted", operationId: operation });
    expect(machine.inspect()).toMatchObject({
      operations: [],
      containers: [{ id: "container:1", childIds: [second, first, third] }],
      windows: [
        { id: first, parentId: "container:1" },
        { id: second, parentId: "container:1" },
        { id: third, parentId: "container:1" },
      ],
      renderPlan: { previews: [] },
    });
  });

  it("rejects malformed pointers and ignores an unchanged target", () => {
    const { machine, first } = dragMachine();
    const operation = operationId("validated-pointer");
    machine.dispatch({
      type: "OperationStarted",
      operation: {
        id: operation,
        kind: "drag",
        windowId: first,
        centerAction: "swap",
      },
    });
    const revision = machine.inspect().revision;

    expect(
      machine.dispatch({
        type: "OperationUpdated",
        operationId: operation,
        update: { pointer: { surfaceId: "missing", x: Number.NaN, y: 10 } },
      } as never)
    ).toMatchObject({
      status: "rejected",
      revision,
      diagnostics: [{ code: "invalid-drag-update" }],
    });
    expect(
      machine.dispatch({
        type: "OperationUpdated",
        operationId: operation,
        update: { pointer: { surfaceId: surfaceId("surface"), x: 899, y: 599 } },
      })
    ).toMatchObject({ status: "committed" });
    const targetRevision = machine.inspect().revision;
    expect(
      machine.dispatch({
        type: "OperationUpdated",
        operationId: operation,
        update: { pointer: { surfaceId: surfaceId("surface"), x: 899, y: 599 } },
      })
    ).toMatchObject({ status: "ignored", revision: targetRevision });
  });

  it("does not clear a preview that was never presented", () => {
    const { machine, first } = dragMachine();
    const operation = operationId("no-preview");
    machine.dispatch({
      type: "OperationStarted",
      operation: {
        id: operation,
        kind: "drag",
        windowId: first,
        centerAction: "swap",
      },
    });

    expect(machine.dispatch({ type: "OperationCancelled", operationId: operation })).toMatchObject({
      status: "committed",
      intentions: [],
    });
  });

  it("detaches horizontal edge drops from stacked presentation containers", () => {
    const { machine, surface, first, second, third } = dragMachine();
    machine.dispatch({
      type: "FactsObserved",
      facts: [{ type: "FocusObserved", windowId: second }],
    });
    machine.dispatch({
      type: "CommandRequested",
      command: { type: "SetLayout", windowId: second, layout: "stacked" },
    });
    const operation = operationId("detach-stacked");
    machine.dispatch({
      type: "OperationStarted",
      operation: {
        id: operation,
        kind: "drag",
        windowId: third,
        centerAction: "swap",
      },
    });

    machine.dispatch({
      type: "OperationUpdated",
      operationId: operation,
      update: { pointer: { surfaceId: surface, x: 10, y: 300 } },
    });

    expect(machine.inspect().operations).toEqual([
      expect.objectContaining({
        placement: expect.objectContaining({
          kind: "detach",
          targetWindowId: second,
          region: "left",
          layout: "horizontal",
        }),
      }),
    ]);
    machine.dispatch({ type: "OperationCommitted", operationId: operation });
    expect(machine.inspect().containers).toEqual([
      expect.objectContaining({
        id: "container:1",
        layout: "horizontal",
        childIds: [first, third, second],
      }),
    ]);
  });

  it("keeps vertical edge drops inside stacked presentation with a full preview", () => {
    const { machine, surface, first, second, third } = dragMachine();
    machine.dispatch({
      type: "FactsObserved",
      facts: [{ type: "FocusObserved", windowId: second }],
    });
    machine.dispatch({
      type: "CommandRequested",
      command: { type: "SetLayout", windowId: second, layout: "stacked" },
    });
    const operation = operationId("insert-stacked");
    machine.dispatch({
      type: "OperationStarted",
      operation: {
        id: operation,
        kind: "drag",
        windowId: first,
        centerAction: "tabbed",
      },
    });

    machine.dispatch({
      type: "OperationUpdated",
      operationId: operation,
      update: { pointer: { surfaceId: surface, x: 450, y: 590 } },
    });

    expect(machine.inspect()).toMatchObject({
      operations: [
        {
          placement: {
            kind: "insert",
            targetWindowId: second,
            region: "down",
            containerId: "container:1",
          },
        },
      ],
      renderPlan: {
        previews: [
          {
            operationId: operation,
            rect: { x: 0, y: 0, width: 900, height: 600 },
          },
        ],
      },
    });
    machine.dispatch({ type: "OperationCommitted", operationId: operation });
    expect(machine.inspect().containers).toEqual([
      expect.objectContaining({
        id: "container:1",
        layout: "stacked",
        childIds: [second, third, first],
      }),
    ]);
  });

  it("absorbs a redundant nested split after a two-window edge drop", () => {
    const { machine, surface, first, second, third } = dragMachine();
    machine.dispatch({
      type: "FactsObserved",
      facts: [{ type: "WindowWithdrawn", windowId: third }],
    });
    const operation = operationId("absorbed-split");
    machine.dispatch({
      type: "OperationStarted",
      operation: {
        id: operation,
        kind: "drag",
        windowId: first,
        centerAction: "swap",
      },
    });
    machine.dispatch({
      type: "OperationUpdated",
      operationId: operation,
      update: { pointer: { surfaceId: surface, x: 700, y: 10 } },
    });

    machine.dispatch({ type: "OperationCommitted", operationId: operation });

    expect(machine.inspect()).toMatchObject({
      containers: [
        {
          id: "container:1",
          layout: "vertical",
          childIds: [first, second],
        },
      ],
      windows: [
        { id: first, parentId: "container:1" },
        { id: second, parentId: "container:1" },
      ],
    });
  });

  it("absorbs the affected root split independently on every Surface", () => {
    const machine = createTilingStateMachine(policy);
    const firstSurface = surfaceId("surface:first");
    const secondSurface = surfaceId("surface:second");
    const unrelated = windowId("unrelated");
    const unrelatedSibling = windowId("unrelated:sibling");
    const first = windowId("first:second-surface");
    const second = windowId("second:second-surface");
    const capabilities = { focus: true, raise: true, move: true, resize: true };
    machine.dispatch({
      type: "PlatformSnapshotObserved",
      snapshot: {
        surfaces: [firstSurface, secondSurface].map((id) => ({
          id,
          workArea: { x: 0, y: 0, width: 900, height: 600 },
          neighbors: {},
          capabilities,
        })),
        windows: [
          ...[unrelated, unrelatedSibling].map((id) => ({
            id,
            surfaceId: firstSurface,
            frame: { x: 0, y: 0, width: 450, height: 600 },
            available: true,
            capabilities,
          })),
          ...[first, second].map((id) => ({
            id,
            surfaceId: secondSurface,
            frame: { x: 0, y: 0, width: 450, height: 600 },
            available: true,
            capabilities,
          })),
        ],
      },
    });
    machine.dispatch({
      type: "CommandRequested",
      command: { type: "Split", windowId: unrelated, layout: "vertical" },
    });
    expect(machine.inspect().containers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "container:3",
          surfaceId: firstSurface,
          layout: "vertical",
          childIds: [unrelated],
        }),
      ])
    );
    const operation = operationId("second-surface-split");
    machine.dispatch({
      type: "OperationStarted",
      operation: {
        id: operation,
        kind: "drag",
        windowId: first,
        centerAction: "swap",
      },
    });
    machine.dispatch({
      type: "OperationUpdated",
      operationId: operation,
      update: { pointer: { surfaceId: secondSurface, x: 700, y: 10 } },
    });

    machine.dispatch({ type: "OperationCommitted", operationId: operation });

    const secondRoot = machine
      .inspect()
      .containers.find((container) => container.surfaceId === secondSurface);
    expect(secondRoot).toMatchObject({
      id: "container:2",
      layout: "vertical",
      childIds: [first, second],
    });
    expect(
      machine.inspect().containers.filter((container) => container.surfaceId === secondSurface)
    ).toHaveLength(1);
    expect(machine.inspect().containers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "container:3",
          surfaceId: firstSurface,
          layout: "vertical",
          childIds: [unrelated],
        }),
      ])
    );
  });
});
