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

  it("records portable effect failures without rolling state backward", () => {
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
            workArea: { x: 0, y: 0, width: 1000, height: 800 },
            neighbors: {},
            capabilities,
          },
        ],
        windows: [
          {
            id: terminal,
            surfaceId: primary,
            frame: { x: 0, y: 0, width: 1000, height: 800 },
            available: true,
            capabilities,
          },
        ],
      },
    });

    const transition = machine.dispatch({
      type: "FactsObserved",
      facts: [
        {
          type: "EffectFailed",
          causalToken: { revision: 1, ordinal: 1 },
          code: "target-withdrawn",
          identity: terminal,
        },
      ],
    });

    expect(transition).toMatchObject({
      status: "committed",
      revision: 2,
      intentions: [],
      diagnostics: [{ code: "effect-failed:target-withdrawn", identity: terminal }],
    });
    expect(machine.inspect()).toMatchObject({
      revision: 2,
      diagnostics: [{ code: "effect-failed:target-withdrawn", identity: terminal }],
      windows: [{ id: terminal, participating: true }],
    });
  });

  it("records reconcile exhaustion once after bounded placement retries", () => {
    const machine = createTilingStateMachine({ ...policy, reconcileAttempts: 2 });
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

    expect(machine.dispatch({ type: "ReconcileRequested" }).status).toBe("committed");
    expect(machine.dispatch({ type: "ReconcileRequested" }).status).toBe("committed");

    expect(machine.dispatch({ type: "ReconcileRequested" })).toMatchObject({
      status: "committed",
      revision: 4,
      intentions: [],
      diagnostics: [{ code: "reconcile-exhausted", identity: terminal }],
    });
    expect(machine.inspect()).toMatchObject({
      revision: 4,
      diagnostics: [{ code: "reconcile-exhausted", identity: terminal }],
      windows: [{ id: terminal, reconcileAttempts: 2 }],
    });
    expect(machine.dispatch({ type: "ReconcileRequested" })).toEqual({
      status: "ignored",
      revision: 4,
      intentions: [],
      diagnostics: [],
    });
  });
});
