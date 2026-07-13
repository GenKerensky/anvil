import { describe, expect, it } from "vitest";

import {
  createTilingStateMachine,
  surfaceId,
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
});
