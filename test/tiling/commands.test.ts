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

function twoWindowMachine(policyOverrides: Partial<TilingPolicy> = {}) {
  const machine = createTilingStateMachine({ ...policy, ...policyOverrides });
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

function observedWindow(id: ReturnType<typeof windowId>, surface: ReturnType<typeof surfaceId>) {
  return {
    id,
    surfaceId: surface,
    frame: { x: 0, y: 0, width: 500, height: 800 },
    available: true,
    capabilities: { focus: true, raise: true, move: true, resize: true },
  };
}

describe("Tiling Commands", () => {
  it("creates a nested split and admits the next window beside the focused window", () => {
    const { machine, surface, first, second } = twoWindowMachine();

    expect(
      machine.dispatch({
        type: "CommandRequested",
        command: { type: "Split", windowId: first, layout: "vertical" },
      })
    ).toMatchObject({ status: "committed", revision: 2 });
    expect(machine.inspect()).toMatchObject({
      containers: [
        {
          id: "container:1",
          childIds: ["container:2", second],
        },
        {
          id: "container:2",
          parentId: "container:1",
          layout: "vertical",
          childIds: [first],
        },
      ],
      windows: [
        { id: first, parentId: "container:2" },
        { id: second, parentId: "container:1" },
      ],
      renderPlan: {
        containers: [
          { id: "container:1", rect: { x: 0, y: 0, width: 1000, height: 800 } },
          { id: "container:2", rect: { x: 0, y: 0, width: 500, height: 800 } },
        ],
      },
    });

    const third = windowId("third");
    machine.dispatch({
      type: "FactsObserved",
      facts: [{ type: "WindowObserved", window: observedWindow(third, surface) }],
    });

    expect(machine.inspect()).toMatchObject({
      containers: [
        { id: "container:1", childIds: ["container:2", second] },
        { id: "container:2", childIds: [first, third] },
      ],
      windows: [
        { id: first, parentId: "container:2" },
        { id: second, parentId: "container:1" },
        { id: third, parentId: "container:2" },
      ],
      renderPlan: {
        windows: [
          { id: first, frame: { x: 0, y: 0, width: 500, height: 400 } },
          { id: second, frame: { x: 500, y: 0, width: 500, height: 800 } },
          { id: third, frame: { x: 0, y: 400, width: 500, height: 400 } },
        ],
      },
    });

    expect(
      machine.dispatch({ type: "PolicyReplaced", policy: { ...policy, gap: 5 } })
    ).toMatchObject({ status: "committed" });
    expect(machine.inspect().containers).toMatchObject([
      { id: "container:1", childIds: ["container:2", second] },
      { id: "container:2", childIds: [first, third] },
    ]);

    machine.dispatch({
      type: "FactsObserved",
      facts: [{ type: "SurfaceWithdrawn", surfaceId: surface }],
    });
    expect(machine.inspect()).toMatchObject({
      surfaces: [],
      containers: [],
      evacuationHints: [
        {
          surfaceId: surface,
          rootId: "container:1",
          containers: [
            { id: "container:1", childIds: ["container:2", second] },
            { id: "container:2", childIds: [first, third] },
          ],
        },
      ],
    });
    machine.dispatch({
      type: "FactsObserved",
      facts: [
        {
          type: "SurfaceObserved",
          surface: {
            id: surface,
            workArea: { x: 0, y: 0, width: 1000, height: 800 },
            neighbors: {},
            capabilities: { focus: true, raise: true, move: true, resize: true },
          },
        },
      ],
    });
    expect(machine.inspect()).toMatchObject({
      surfaces: [{ id: surface, rootId: "container:1" }],
      containers: [
        { id: "container:1", childIds: ["container:2", second] },
        { id: "container:2", parentId: "container:1", childIds: [first, third] },
      ],
      windows: [
        { id: first, parentId: "container:2" },
        { id: second, parentId: "container:1" },
        { id: third, parentId: "container:2" },
      ],
      evacuationHints: [],
    });

    machine.dispatch({
      type: "FactsObserved",
      facts: [
        { type: "WindowWithdrawn", windowId: first },
        { type: "WindowWithdrawn", windowId: third },
      ],
    });
    expect(machine.inspect()).toMatchObject({
      containers: [{ id: "container:1", childIds: [second] }],
      windows: [{ id: second, parentId: "container:1" }],
    });
  });

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
      ],
    });
    expect(machine.inspect()).toMatchObject({
      containers: [{ id: "container:1", layout: "vertical", childIds: [first, second] }],
    });
  });

  it.each(["stacked", "tabbed"] as const)(
    "reserves portable header geometry for the %s layout",
    (layout) => {
      const { machine, first, second } = twoWindowMachine({ headerExtent: 35 });

      const transition = machine.dispatch({
        type: "CommandRequested",
        command: { type: "SetLayout", windowId: first, layout },
      });

      expect(transition).toMatchObject({
        status: "committed",
        intentions: [
          {
            type: "PlaceWindow",
            windowId: first,
            frame: { x: 0, y: 35, width: 1000, height: 765 },
          },
          {
            type: "PlaceWindow",
            windowId: second,
            frame: { x: 0, y: 35, width: 1000, height: 765 },
          },
          {
            type: "PresentContainer",
            containerId: "container:1",
            layout,
          },
          {
            type: "RaiseWindows",
            containerId: "container:1",
            windowIds: [second, first],
          },
        ],
      });
      expect(machine.inspect().renderPlan).toMatchObject({
        windows: [
          { id: first, frame: { x: 0, y: 35, width: 1000, height: 765 } },
          { id: second, frame: { x: 0, y: 35, width: 1000, height: 765 } },
        ],
        containers: [
          {
            id: "container:1",
            rect: { x: 0, y: 0, width: 1000, height: 800 },
            headerRect: { x: 0, y: 0, width: 1000, height: 35 },
          },
        ],
      });
    }
  );

  it("removes container presentation when leaving a presented layout", () => {
    const { machine, first } = twoWindowMachine({ headerExtent: 35 });
    machine.dispatch({
      type: "CommandRequested",
      command: { type: "SetLayout", windowId: first, layout: "tabbed" },
    });

    const transition = machine.dispatch({
      type: "CommandRequested",
      command: { type: "SetLayout", windowId: first, layout: "horizontal" },
    });

    expect(transition).toMatchObject({
      status: "committed",
      intentions: [
        { type: "PlaceWindow", windowId: first },
        { type: "PlaceWindow" },
        { type: "RemoveContainerPresentation", containerId: "container:1" },
      ],
    });
  });

  it("flattens nested container identities into compositor stacking order", () => {
    const { machine, first, second } = twoWindowMachine({ headerExtent: 35 });
    machine.dispatch({
      type: "CommandRequested",
      command: { type: "Split", windowId: first, layout: "vertical" },
    });

    const transition = machine.dispatch({
      type: "CommandRequested",
      command: { type: "SetLayout", windowId: second, layout: "tabbed" },
    });

    const rootPlan = machine
      .inspect()
      .renderPlan.containers.find((container) => container.id === "container:1");
    expect(rootPlan?.stackingOrder).toEqual([second, first]);
    expect(transition.intentions).toContainEqual(
      expect.objectContaining({
        type: "RaiseWindows",
        containerId: "container:1",
        windowIds: [second, first],
      })
    );
  });

  it("swaps two windows by identity without a platform object", () => {
    const { machine, first, second } = twoWindowMachine();

    const transition = machine.dispatch({
      type: "CommandRequested",
      command: { type: "SwapWindows", firstWindowId: first, secondWindowId: second },
    });

    expect(transition).toMatchObject({
      status: "committed",
      intentions: [
        { type: "PlaceWindow", windowId: first, frame: { x: 500, width: 500 } },
        { type: "PlaceWindow", windowId: second, frame: { x: 0, width: 500 } },
      ],
    });
    expect(machine.inspect()).toMatchObject({
      containers: [{ childIds: [second, first] }],
    });
  });

  it("keeps stacked selection on an available child", () => {
    const { machine, first, second } = twoWindowMachine();
    machine.dispatch({
      type: "CommandRequested",
      command: { type: "SetLayout", windowId: first, layout: "stacked" },
    });
    expect(machine.inspect().containers[0].selectedChildId).toBe(first);

    const transition = machine.dispatch({
      type: "FactsObserved",
      facts: [{ type: "WindowAvailabilityObserved", windowId: first, available: false }],
    });

    expect(transition).toMatchObject({
      intentions: [
        {
          type: "PresentContainer",
          containerId: "container:1",
          selectedChildId: second,
        },
        {
          type: "RaiseWindows",
          containerId: "container:1",
          windowIds: [second],
        },
      ],
    });
    expect(machine.inspect()).toMatchObject({
      containers: [{ selectedChildId: second }],
      renderPlan: { containers: [{ selectedChildId: second }] },
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

  it("rejects focus commands when the target capability is unavailable", () => {
    const { machine, first, second, surface } = twoWindowMachine();
    machine.dispatch({
      type: "FactsObserved",
      facts: [
        {
          type: "WindowObserved",
          window: {
            id: second,
            surfaceId: surface,
            frame: { x: 500, y: 0, width: 500, height: 800 },
            available: true,
            capabilities: { focus: false, raise: true, move: true, resize: true },
          },
        },
      ],
    });

    expect(
      machine.dispatch({
        type: "CommandRequested",
        command: { type: "FocusDirection", windowId: first, direction: "right" },
      })
    ).toMatchObject({
      status: "rejected",
      diagnostics: [{ code: "capability-unsupported", identity: second }],
    });
  });
});
