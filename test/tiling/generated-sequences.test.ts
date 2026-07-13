import { describe, expect, it } from "vitest";

import {
  createTilingStateMachine,
  surfaceId,
  windowId,
  type PlatformSnapshot,
  type TilingEvent,
  type TilingPolicy,
} from "../../src/lib/tiling/index.js";

const policy: TilingPolicy = {
  enabled: true,
  surfaceTiling: {},
  allowedLayouts: ["horizontal", "vertical", "stacked", "tabbed"],
  defaultLayout: "horizontal",
  gap: 4,
  hideGapWhenSingle: false,
  autoSplit: false,
  singleTabExit: "preserve",
  headerExtent: 0,
  constraints: {},
  participationRules: [],
  reconcileAttempts: 3,
};

function generatedTrace(): TilingEvent[] {
  const capabilities = { focus: true, raise: true, move: true, resize: true };
  const surfaces = Array.from({ length: 20 }, (_, index) => ({
    id: surfaceId(`surface:${index}`),
    workArea: { x: 0, y: 0, width: 1000 + index, height: 800 },
    neighbors: {},
    capabilities,
  }));
  const windows = Array.from({ length: 100 }, (_, index) => ({
    id: windowId(`window:${index}`),
    surfaceId: surfaces[index % surfaces.length].id,
    frame: { x: 0, y: 0, width: 200, height: 200 },
    available: true,
    capabilities,
  }));
  const snapshot: PlatformSnapshot = { surfaces, windows, focusedWindowId: windows[0].id };
  const events: TilingEvent[] = [{ type: "PlatformSnapshotObserved", snapshot }];
  let seed = 0x5eed1234;
  const next = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed;
  };
  const directions = ["left", "right", "up", "down"] as const;
  const layouts = ["horizontal", "vertical", "stacked", "tabbed"] as const;
  for (let index = 0; index < 1000; index += 1) {
    const window = windows[next() % windows.length];
    const selector = next() % 6;
    if (selector === 0) {
      events.push({
        type: "FactsObserved",
        facts: [
          {
            type: "WindowAvailabilityObserved",
            windowId: window.id,
            available: (next() & 1) === 0,
          },
        ],
      });
    } else if (selector === 1) {
      events.push({
        type: "CommandRequested",
        command: {
          type: "FocusDirection",
          windowId: window.id,
          direction: directions[next() % directions.length],
        },
      });
    } else if (selector === 2) {
      events.push({
        type: "CommandRequested",
        command: {
          type: "MoveDirection",
          windowId: window.id,
          direction: directions[next() % directions.length],
        },
      });
    } else if (selector === 3) {
      events.push({
        type: "CommandRequested",
        command: {
          type: "SetLayout",
          windowId: window.id,
          layout: layouts[next() % layouts.length],
        },
      });
    } else if (selector === 4) {
      events.push({
        type: "FactsObserved",
        facts: [
          {
            type: "FrameObserved",
            windowId: window.id,
            frame: {
              x: next() % 400,
              y: next() % 300,
              width: 200 + (next() % 600),
              height: 200 + (next() % 400),
            },
          },
        ],
      });
    } else {
      events.push({ type: "ReconcileRequested", surfaceId: window.surfaceId });
    }
  }
  return events;
}

describe("generated event sequences", () => {
  it("replays 100 windows, 20 surfaces, and 1000 events deterministically", () => {
    const trace = generatedTrace();
    const first = createTilingStateMachine(policy);
    const second = createTilingStateMachine(policy);

    for (const event of trace) {
      first.dispatch(event);
      second.dispatch(event);
    }

    expect(JSON.stringify(first.inspect())).toBe(JSON.stringify(second.inspect()));
  });
});
