import { describe, expect, it, vi } from "vitest";

import {
  GnomeIntentionApplier,
  type GnomeIntentionApplierHost,
} from "../../../src/lib/extension/gnome-intention-applier.js";
import {
  surfaceId,
  windowId,
  type Rect,
  type TilingIntention,
} from "../../../src/lib/tiling/index.js";
import { createMockWindow, installGnomeGlobals } from "../mocks/helpers/index.js";

describe("GnomeIntentionApplier", () => {
  it("attempts the whole batch and observes placed frames after settle", () => {
    const globals = installGnomeGlobals();
    const surface = surfaceId("surface:1");
    const availableId = windowId("window:1");
    const withdrawnId = windowId("window:2");
    const window = createMockWindow({ rect: { x: 0, y: 0, width: 100, height: 100 } });
    const activate = vi.spyOn(window, "activate");
    const host: GnomeIntentionApplierHost = {
      resolveWindow: (id) => (id === availableId ? window : undefined),
      toGlobalRect: (_surfaceId, rect) => ({ ...rect, x: rect.x + 100, y: rect.y + 200 }),
      toLocalRect: (_surfaceId, rect) => ({ ...rect, x: rect.x - 100, y: rect.y - 200 }),
      participationChanged: vi.fn(),
      presentContainer: vi.fn(),
      presentPreview: vi.fn(),
      clearPreview: vi.fn(),
    };
    const applier = new GnomeIntentionApplier(host);
    const intentions: TilingIntention[] = [
      {
        type: "PlaceWindow",
        revision: 4,
        ordinal: 0,
        windowId: withdrawnId,
        surfaceId: surface,
        frame: { x: 0, y: 0, width: 400, height: 300 },
      },
      {
        type: "PlaceWindow",
        revision: 4,
        ordinal: 1,
        windowId: availableId,
        surfaceId: surface,
        frame: { x: 10, y: 20, width: 500, height: 350 },
      },
      { type: "FocusWindow", revision: 4, ordinal: 2, windowId: availableId },
    ];

    const applied = applier.apply(intentions);

    expect(applied.facts).toEqual([
      { type: "WindowWithdrawn", windowId: withdrawnId },
      {
        type: "EffectFailed",
        causalToken: { revision: 4, ordinal: 0 },
        code: "target-withdrawn",
        identity: withdrawnId,
      },
    ]);
    expect(window.get_frame_rect()).toMatchObject({
      x: 110,
      y: 220,
      width: 500,
      height: 350,
    });
    expect(activate).toHaveBeenCalledOnce();
    expect(applied.pendingFrames).toEqual([
      {
        windowId: availableId,
        surfaceId: surface,
        causalToken: { revision: 4, ordinal: 1 },
      },
    ]);
    expect(JSON.parse(JSON.stringify(applied.pendingFrames))).toEqual(applied.pendingFrames);

    expect(applier.observeSettled(applied.pendingFrames)).toEqual([
      {
        type: "FrameObserved",
        windowId: availableId,
        frame: { x: 10, y: 20, width: 500, height: 350 },
        causalToken: { revision: 4, ordinal: 1 },
      },
    ]);
    globals.cleanup();
  });

  it("isolates presentation errors and continues later intentions", () => {
    const globals = installGnomeGlobals();
    const surface = surfaceId("surface:1");
    const window = createMockWindow();
    const id = windowId("window:1");
    const participationChanged = vi.fn();
    const host: GnomeIntentionApplierHost = {
      resolveWindow: () => window,
      toGlobalRect: (_surfaceId, rect: Rect) => ({ ...rect }),
      toLocalRect: (_surfaceId, rect: Rect) => ({ ...rect }),
      participationChanged,
      presentContainer: () => {
        throw new Error("actor destroyed");
      },
      presentPreview: vi.fn(),
      clearPreview: vi.fn(),
    };
    const applier = new GnomeIntentionApplier(host);
    const intentions: TilingIntention[] = [
      {
        type: "PresentContainer",
        revision: 2,
        ordinal: 0,
        containerId: "container:1" as never,
        surfaceId: surface,
        layout: "tabbed",
        stackingOrder: [id],
      },
      {
        type: "WindowParticipationChanged",
        revision: 2,
        ordinal: 1,
        windowId: id,
        participating: true,
      },
    ];

    const applied = applier.apply(intentions);

    expect(applied.facts).toEqual([
      {
        type: "EffectFailed",
        causalToken: { revision: 2, ordinal: 0 },
        code: "effect-error",
        identity: "container:1",
      },
    ]);
    expect(participationChanged).toHaveBeenCalledWith(window, true);
    globals.cleanup();
  });
});
