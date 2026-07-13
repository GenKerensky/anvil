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
  return { machine, first, second };
}

describe("Tiling Operations", () => {
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
          direction: "right",
        },
      })
    ).toEqual({ status: "committed", revision: 2, intentions: [], diagnostics: [] });

    const updated = machine.dispatch({
      type: "OperationUpdated",
      operationId: operation,
      update: { shareDelta: 0.1 },
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
          containerId: "container:1",
          baseWeights: { [first]: 0.5, [second]: 0.5 },
          overlayWeights: { [first]: 0.6, [second]: 0.4 },
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
});
