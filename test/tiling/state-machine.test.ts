import { describe, expect, it } from "vitest";

import { createTilingStateMachine, type TilingPolicy } from "../../src/lib/tiling/index.js";

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
});
