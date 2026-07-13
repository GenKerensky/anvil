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

describe("Tiling Reconciliation", () => {
  it("emits bounded repair intentions without rolling authoritative state back", () => {
    const machine = createTilingStateMachine(policy);
    const surface = surfaceId("surface");
    const terminal = windowId("terminal");
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
        windows: [
          {
            id: terminal,
            surfaceId: surface,
            frame: { x: 100, y: 100, width: 600, height: 400 },
            available: true,
            capabilities,
          },
        ],
      },
    });

    const repair = machine.dispatch({ type: "ReconcileRequested" });
    expect(repair).toEqual({
      status: "committed",
      revision: 2,
      intentions: [
        {
          type: "PlaceWindow",
          revision: 2,
          ordinal: 0,
          windowId: terminal,
          surfaceId: surface,
          frame: { x: 0, y: 0, width: 1000, height: 800 },
        },
      ],
      diagnostics: [],
    });
    expect(machine.inspect()).toMatchObject({
      revision: 2,
      windows: [{ id: terminal, reconcileAttempts: 1 }],
      renderPlan: {
        windows: [{ id: terminal, frame: { x: 0, y: 0, width: 1000, height: 800 } }],
      },
    });

    const observed = machine.dispatch({
      type: "FactsObserved",
      facts: [
        {
          type: "FrameObserved",
          windowId: terminal,
          frame: { x: 0, y: 0, width: 1000, height: 800 },
          causalToken: { revision: 2, ordinal: 0 },
        },
      ],
    });
    expect(observed).toMatchObject({ status: "committed", revision: 3, intentions: [] });
    expect(machine.inspect()).toMatchObject({
      windows: [{ id: terminal, reconcileAttempts: 0 }],
    });
    expect(machine.dispatch({ type: "ReconcileRequested" })).toEqual({
      status: "ignored",
      revision: 3,
      intentions: [],
      diagnostics: [],
    });
  });
});
