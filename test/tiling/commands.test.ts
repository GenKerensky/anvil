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

function twoWindowMachine() {
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
      focusedWindowId: first,
    },
  });
  return { machine, surface, first, second };
}

describe("Tiling Commands", () => {
  it("changes a window container layout and emits the resulting plan delta", () => {
    const { machine, surface, first, second } = twoWindowMachine();

    const transition = machine.dispatch({
      type: "CommandRequested",
      command: { type: "SetLayout", windowId: first, layout: "vertical" },
    });

    expect(transition).toMatchObject({
      status: "committed",
      revision: 2,
      intentions: [
        {
          type: "PlaceWindow",
          windowId: first,
          surfaceId: surface,
          frame: { x: 0, y: 0, width: 1000, height: 400 },
        },
        {
          type: "PlaceWindow",
          windowId: second,
          surfaceId: surface,
          frame: { x: 0, y: 400, width: 1000, height: 400 },
        },
        {
          type: "PresentContainer",
          containerId: "container:1",
          surfaceId: surface,
          layout: "vertical",
          stackingOrder: [first, second],
        },
      ],
    });
    expect(machine.inspect()).toMatchObject({
      containers: [{ id: "container:1", layout: "vertical", childIds: [first, second] }],
    });
  });

  it("commits directional focus as selection plus one-shot intention", () => {
    const { machine, first, second } = twoWindowMachine();

    const transition = machine.dispatch({
      type: "CommandRequested",
      command: { type: "FocusDirection", windowId: first, direction: "right" },
    });

    expect(transition).toEqual({
      status: "committed",
      revision: 2,
      intentions: [
        {
          type: "FocusWindow",
          revision: 2,
          ordinal: 0,
          windowId: second,
        },
      ],
      diagnostics: [],
    });
    expect(machine.inspect()).toMatchObject({
      containers: [{ id: "container:1", selectedChildId: second }],
    });
  });

  it("moves a window through structural order without a second writer", () => {
    const { machine, first, second } = twoWindowMachine();

    const transition = machine.dispatch({
      type: "CommandRequested",
      command: { type: "MoveDirection", windowId: first, direction: "right" },
    });

    expect(transition).toMatchObject({
      status: "committed",
      revision: 2,
      intentions: [
        {
          type: "PlaceWindow",
          windowId: first,
          frame: { x: 500, y: 0, width: 500, height: 800 },
        },
        {
          type: "PlaceWindow",
          windowId: second,
          frame: { x: 0, y: 0, width: 500, height: 800 },
        },
      ],
    });
    expect(machine.inspect()).toMatchObject({
      containers: [{ childIds: [second, first] }],
    });
  });
});
