import { countTrackedWriterWindows } from "../../lib/shared-commands.js";

describe("E2E window cleanup", () => {
  it("waits for non-participating portable window facts to be withdrawn", () => {
    const state = {
      tilingEngineMode: "core",
      portableTiling: {
        windows: [
          { id: "tiled", participating: true },
          { id: "floated", participating: false },
        ],
      },
    };

    expect(countTrackedWriterWindows(state, 0)).toBe(2);
  });

  it("uses the legacy writer's tracked-window count outside core mode", () => {
    const state = {
      tilingEngineMode: "legacy",
      portableTiling: { windows: [{ id: "shadow-only", participating: false }] },
    };

    expect(countTrackedWriterWindows(state, 3)).toBe(3);
  });
});
