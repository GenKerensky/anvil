import { describe, expect, it, vi } from "vitest";

import { CoreTilingEffectDriver } from "../../../src/lib/extension/core-tiling-effect-driver.js";
import { surfaceId, windowId, type TilingTransition } from "../../../src/lib/tiling/index.js";

describe("CoreTilingEffectDriver", () => {
  it("submits one deferred result batch after every intention is attempted", () => {
    const surface = surfaceId("surface:1");
    const window = windowId("window:1");
    const immediateFact = {
      type: "EffectFailed" as const,
      causalToken: { revision: 2, ordinal: 0 },
      code: "effect-error",
      identity: window,
    };
    const settledFact = {
      type: "FrameObserved" as const,
      windowId: window,
      frame: { x: 0, y: 0, width: 100, height: 100 },
      causalToken: { revision: 2, ordinal: 1 },
    };
    const pendingFrames = [
      {
        windowId: window,
        surfaceId: surface,
        causalToken: { revision: 2, ordinal: 1 },
      },
    ];
    const apply = vi.fn(() => ({ facts: [immediateFact], pendingFrames }));
    const observeSettled = vi.fn(() => [settledFact]);
    const submitFacts = vi.fn();
    const requestReconcile = vi.fn();
    const scheduled: Array<{ name: string; callback: () => void; intervalMs?: number }> = [];
    const scheduler = {
      pendingCount: 0,
      enqueue: (event: { name: string; callback: () => void }, intervalMs?: number) => {
        scheduled.push({ ...event, intervalMs });
      },
    };
    const driver = new CoreTilingEffectDriver(
      { apply, observeSettled },
      scheduler,
      submitFacts,
      requestReconcile
    );
    const transition: TilingTransition = {
      status: "committed",
      revision: 2,
      intentions: [
        {
          type: "PlaceWindow",
          revision: 2,
          ordinal: 1,
          windowId: window,
          surfaceId: surface,
          frame: { x: 0, y: 0, width: 100, height: 100 },
        },
      ],
      diagnostics: [],
    };

    driver.consume(transition);

    expect(apply).toHaveBeenCalledWith(transition.intentions);
    expect(submitFacts).not.toHaveBeenCalled();
    expect(scheduled).toEqual([
      { name: "core-effect-results:2", callback: expect.any(Function), intervalMs: 220 },
    ]);

    scheduled[0].callback();

    expect(observeSettled).toHaveBeenCalledWith(pendingFrames);
    expect(submitFacts).toHaveBeenCalledWith([immediateFact, settledFact]);
    expect(requestReconcile).toHaveBeenCalledOnce();
    expect(submitFacts.mock.invocationCallOrder[0]).toBeLessThan(
      requestReconcile.mock.invocationCallOrder[0]
    );
  });

  it("does not schedule work for ignored transitions or empty results", () => {
    const apply = vi.fn(() => ({ facts: [], pendingFrames: [] }));
    const scheduler = { pendingCount: 0, enqueue: vi.fn() };
    const submitFacts = vi.fn();
    const driver = new CoreTilingEffectDriver(
      { apply, observeSettled: vi.fn(() => []) },
      scheduler,
      submitFacts,
      vi.fn()
    );

    driver.consume({
      status: "ignored",
      revision: 1,
      intentions: [],
      diagnostics: [],
    });
    driver.consume({ status: "committed", revision: 2, intentions: [], diagnostics: [] });

    expect(apply).toHaveBeenCalledOnce();
    expect(scheduler.enqueue).not.toHaveBeenCalled();
    expect(submitFacts).not.toHaveBeenCalled();
  });
});
