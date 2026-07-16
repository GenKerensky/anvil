/*
 * GrabResizeSession lifecycle and policy-integration tests.
 */

import Meta from "gi://Meta";
import GLib from "gi://GLib";
import { describe, it, expect, vi } from "vitest";
import {
  LAYOUT_TYPES,
  NODE_TYPES,
  type Node,
  type RectLike,
} from "../../../src/lib/extension/tree.js";
import {
  GrabResizeSession,
  type GrabResizeHost,
} from "../../../src/lib/extension/grab-resize-session.js";
import { WINDOW_MODES } from "../../../src/lib/extension/window/constants.js";
import {
  createMockWindow,
  createTreeFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";

function createSessionFixture() {
  const metaWindow = createMockWindow({ id: 41, wm_class: "TestApp", title: "Test" });
  const focusNode = {
    nodeValue: metaWindow,
    mode: WINDOW_MODES.TILE,
  } as unknown as Node;
  const previewPresenter = {
    show: vi.fn(),
    hide: vi.fn(),
    destroy: vi.fn(),
  };
  const host: GrabResizeHost = {
    tree: {} as GrabResizeHost["tree"],
    focusMetaWindow: metaWindow,
    settings: {
      get_boolean: vi.fn(() => true),
    } as unknown as GrabResizeHost["settings"],
    nodeWinAtPointer: null,
    findNodeWindow: (window) => (window === metaWindow ? focusNode : null),
    findNodeWindowAtPointer: vi.fn(() => null),
    trackCurrentMonWs: vi.fn(),
    freezeRender: vi.fn(),
    unfreezeRender: vi.fn(),
    renderTree: vi.fn(),
    scheduler: {
      pendingCount: 0,
      enqueue: vi.fn(),
    },
    move: vi.fn(),
    calculateGaps: vi.fn(() => 0),
    processNode: vi.fn(),
    getMonitorConstraints: vi.fn(() => null),
    floatingWindow: vi.fn(() => false),
    minimizedWindow: vi.fn(() => false),
    allowDragDropTile: vi.fn(() => false),
    moveWindowToPointer: vi.fn(),
    updateStackedFocus: vi.fn(),
    updateTabbedFocus: vi.fn(),
    observeGrabResizeUpdate: vi.fn(),
    observeGrabMoveUpdate: vi.fn(),
    previewPresenter: previewPresenter as unknown as GrabResizeHost["previewPresenter"],
  };

  return {
    focusNode,
    host,
    metaWindow,
    previewPresenter,
    session: new GrabResizeSession(host),
  };
}

function createTiledSessionFixture({
  layout = LAYOUT_TYPES.HSPLIT,
  rects,
}: {
  layout?: string;
  rects?: RectLike[];
} = {}) {
  const ctx = createTreeFixture({ fullExtWm: true });
  const horizontal = layout === LAYOUT_TYPES.HSPLIT;
  const windowRects =
    rects ??
    (horizontal
      ? [
          { x: 0, y: 0, width: 960, height: 1080 },
          { x: 960, y: 0, width: 960, height: 1080 },
        ]
      : [
          { x: 0, y: 0, width: 1920, height: 540 },
          { x: 0, y: 540, width: 1920, height: 540 },
        ]);
  const windows = windowRects.map((rect, index) =>
    createMockWindow({
      id: index + 1,
      wm_class: `App${index + 1}`,
      title: `Win${index + 1}`,
      rect,
      workspace: ctx.workspaces[0],
      monitor: 0,
    })
  );
  const { monitor } = getWorkspaceAndMonitor(ctx);
  const monitorRect = { x: 0, y: 0, width: 1920, height: 1080 };
  monitor._rect = monitorRect;
  const container = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.CON, "resize-container");
  container.layout = layout;
  container.percent = 1;
  container._rect = monitorRect;
  const nodes = windows.map((window, index) => {
    const candidate = ctx.tree.createNode(container.nodeValue, NODE_TYPES.WINDOW, window);
    candidate.percent = 1 / windows.length;
    candidate.rect = windowRects[index];
    return candidate;
  });
  let focusWindow: Meta.Window | null = windows[0];
  const previewPresenter = {
    show: vi.fn(),
    hide: vi.fn(),
    destroy: vi.fn(),
  };
  const host: GrabResizeHost = {
    tree: ctx.tree,
    get focusMetaWindow() {
      return focusWindow;
    },
    settings: ctx.settings,
    nodeWinAtPointer: null,
    findNodeWindow: (window) => ctx.tree.findNode(window),
    findNodeWindowAtPointer: vi.fn(() => null),
    trackCurrentMonWs: vi.fn(),
    freezeRender: vi.fn(),
    unfreezeRender: vi.fn(),
    renderTree: vi.fn(),
    scheduler: { pendingCount: 0, enqueue: vi.fn() },
    move: (window, rect) => window.move_resize_frame(true, rect.x, rect.y, rect.width, rect.height),
    calculateGaps: vi.fn(() => 0),
    processNode: vi.fn(),
    getMonitorConstraints: vi.fn(() => null),
    floatingWindow: (candidate) => candidate.isFloat(),
    minimizedWindow: (candidate) => Boolean((candidate.nodeValue as Meta.Window).minimized),
    allowDragDropTile: vi.fn(() => false),
    moveWindowToPointer: vi.fn(),
    updateStackedFocus: vi.fn(),
    updateTabbedFocus: vi.fn(),
    observeGrabResizeUpdate: vi.fn(),
    observeGrabMoveUpdate: vi.fn(),
    previewPresenter: previewPresenter as unknown as GrabResizeHost["previewPresenter"],
  };

  return {
    container,
    ctx,
    host,
    nodes,
    session: new GrabResizeSession(host),
    setFocus(window: Meta.Window | null) {
      focusWindow = window;
    },
    windows,
  };
}

describe("GrabResizeSession lifecycle", () => {
  it("cleans session-owned node state and restores tile mode", () => {
    const { focusNode, host, metaWindow, previewPresenter, session } = createSessionFixture();
    session.begin({} as Meta.Display, metaWindow, Meta.GrabOp.MOVING);
    session.cancelGrab = true;

    expect(session.grabModeFor(focusNode)).not.toBeNull();
    expect(focusNode.mode).toBe(WINDOW_MODES.GRAB_TILE);

    session.cleanup(focusNode);

    expect(session.grabModeFor(focusNode)).toBeNull();
    expect(session.cancelGrab).toBe(false);
    expect(focusNode.mode).toBe(WINDOW_MODES.TILE);
    expect(host.freezeRender).toHaveBeenCalledOnce();
    expect(previewPresenter.destroy).toHaveBeenCalledOnce();
  });

  it("disposes safely without an active live loop and clears observable grab state", () => {
    const { focusNode, metaWindow, previewPresenter, session } = createSessionFixture();
    session.begin({} as Meta.Display, metaWindow, Meta.GrabOp.MOVING);
    session.cancelGrab = true;

    expect(() => session.dispose()).not.toThrow();

    expect(session.grabOp).toBe(Meta.GrabOp.NONE);
    expect(session.cancelGrab).toBe(false);
    expect(session.grabModeFor(focusNode)).toBeNull();
    expect(focusNode.mode).toBe(WINDOW_MODES.TILE);
    expect(previewPresenter.destroy).toHaveBeenCalledOnce();
  });

  it("records the resized window when focus changed before grab end", () => {
    const { host, metaWindow: focusedWindow, session } = createSessionFixture();
    const resizedWindow = createMockWindow({ id: 100, wm_class: "Other", title: "Resized" });
    vi.mocked(host.getMonitorConstraints).mockReturnValue({
      maxWidth: 1920,
      maxHeight: 1080,
      enabled: true,
      resizeExempt: true,
    });
    const timeout = vi.spyOn(GLib, "timeout_add").mockImplementation((_p, _ms, callback) => {
      callback(null);
      return 1;
    });

    session.end({} as Meta.Display, resizedWindow, Meta.GrabOp.KEYBOARD_RESIZING_E);

    expect(session.getResizeCount(100)).toBe(1);
    expect(session.getResizeCount(focusedWindow.get_id())).toBe(0);
    timeout.mockRestore();
  });

  it("clears recorded resize counts through the production lifecycle operation", () => {
    const { host, metaWindow, session } = createSessionFixture();
    vi.mocked(host.getMonitorConstraints).mockReturnValue({
      maxWidth: 1920,
      maxHeight: 1080,
      enabled: true,
      resizeExempt: true,
    });
    const timeout = vi.spyOn(GLib, "timeout_add").mockImplementation((_p, _ms, callback) => {
      callback(null);
      return 1;
    });
    session.end({} as Meta.Display, metaWindow, Meta.GrabOp.KEYBOARD_RESIZING_E);

    session.clearResizedWindows();

    expect(session.getResizeCount(metaWindow.get_id())).toBe(0);
    timeout.mockRestore();
  });

  it("does not track a null resized window", () => {
    const { host, session } = createSessionFixture();
    vi.mocked(host.getMonitorConstraints).mockReturnValue({
      maxWidth: 1920,
      maxHeight: 1080,
      enabled: true,
      resizeExempt: true,
    });

    session.end({} as Meta.Display, null as unknown as Meta.Window, Meta.GrabOp.RESIZING_E);

    expect(session.getResizeCount(41)).toBe(0);
  });

  it("does not track non-resize grabs or monitors without resize exemption", () => {
    const { host, metaWindow, session } = createSessionFixture();
    const timeout = vi.spyOn(GLib, "timeout_add");

    vi.mocked(host.getMonitorConstraints).mockReturnValue({
      maxWidth: 1920,
      maxHeight: 1080,
      enabled: true,
      resizeExempt: true,
    });
    session.end({} as Meta.Display, metaWindow, Meta.GrabOp.KEYBOARD_MOVING);

    vi.mocked(host.getMonitorConstraints).mockReturnValue({
      maxWidth: 1920,
      maxHeight: 1080,
      enabled: true,
      resizeExempt: false,
    });
    session.end({} as Meta.Display, metaWindow, Meta.GrabOp.KEYBOARD_RESIZING_E);

    expect(timeout).not.toHaveBeenCalled();
    expect(session.getResizeCount(metaWindow.get_id())).toBe(0);
    timeout.mockRestore();
  });

  it("increments the resize count for repeated exempt resizes", () => {
    const { host, metaWindow, session } = createSessionFixture();
    vi.mocked(host.getMonitorConstraints).mockReturnValue({
      maxWidth: 1920,
      maxHeight: 1080,
      enabled: true,
      resizeExempt: true,
    });
    const timeout = vi.spyOn(GLib, "timeout_add").mockImplementation((_p, _ms, callback) => {
      callback(null);
      return 1;
    });

    session.end({} as Meta.Display, metaWindow, Meta.GrabOp.KEYBOARD_RESIZING_E);
    session.end({} as Meta.Display, metaWindow, Meta.GrabOp.KEYBOARD_RESIZING_W);

    expect(session.getResizeCount(metaWindow.get_id())).toBe(2);
    timeout.mockRestore();
  });
});

describe("GrabResizeSession resize ownership", () => {
  it("updates and preserves horizontal sibling percents through grab end", () => {
    const { container, host, nodes, session, windows } = createTiledSessionFixture();
    session.begin({} as Meta.Display, windows[0], Meta.GrabOp.RESIZING_E);
    windows[0].move_resize_frame(true, 0, 0, 1060, 1080);

    session.handleResizing(nodes[0]);

    expect(nodes[0].percent).toBeCloseTo(1060 / container.rect!.width, 3);
    expect(nodes[1].percent).toBeCloseTo(860 / container.rect!.width, 3);
    expect(host.observeGrabResizeUpdate).toHaveBeenCalledWith(windows[0]);

    session.end({} as Meta.Display, windows[0], Meta.GrabOp.RESIZING_E);

    expect(nodes[0].percent).toBeCloseTo(1060 / 1920, 3);
    expect(nodes[1].percent).toBeCloseTo(860 / 1920, 3);
    expect(session.grabModeFor(nodes[0])).toBeNull();
    expect(session.grabOp).toBe(Meta.GrabOp.NONE);
    expect(host.renderTree).toHaveBeenCalledWith("grab-op-end");
    expect(windows[0].get_frame_rect().width).toBe(1060);
  });

  it("updates vertical sibling percents", () => {
    const { nodes, session, windows } = createTiledSessionFixture({
      layout: LAYOUT_TYPES.VSPLIT,
    });
    session.begin({} as Meta.Display, windows[0], Meta.GrabOp.RESIZING_S);
    windows[0].move_resize_frame(true, 0, 0, 1920, 640);

    session.handleResizing(nodes[0]);

    expect(nodes[0].percent).toBeCloseTo(640 / 1080, 3);
    expect(nodes[1].percent).toBeCloseTo(440 / 1080, 3);
  });

  it.each([
    {
      layout: LAYOUT_TYPES.HSPLIT,
      grabOp: Meta.GrabOp.RESIZING_E,
      rects: [
        { x: 0, y: 0, width: 640, height: 1080 },
        { x: 640, y: 0, width: 640, height: 1080 },
        { x: 1280, y: 0, width: 640, height: 1080 },
      ],
      resized: { x: 0, y: 0, width: 1060, height: 1080 },
      unavailable: "floating",
      expected: [1060 / 1920, 860 / 1920],
    },
    {
      layout: LAYOUT_TYPES.VSPLIT,
      grabOp: Meta.GrabOp.RESIZING_S,
      rects: [
        { x: 0, y: 0, width: 1920, height: 360 },
        { x: 0, y: 360, width: 1920, height: 360 },
        { x: 0, y: 720, width: 1920, height: 360 },
      ],
      resized: { x: 0, y: 0, width: 1920, height: 640 },
      unavailable: "minimized",
      expected: [640 / 1080, 440 / 1080],
    },
  ])(
    "skips an ineligible $unavailable sibling in a $layout split",
    ({ layout, grabOp, rects, resized, unavailable, expected }) => {
      const { nodes, session, windows } = createTiledSessionFixture({ layout, rects });
      if (unavailable === "floating") nodes[1].mode = WINDOW_MODES.FLOAT;
      else windows[1].minimized = true;
      nodes[0].percent = 0.5;
      nodes[1].percent = undefined;
      nodes[2].percent = 0.5;
      const participatingRects =
        unavailable === "floating"
          ? [
              { x: 0, y: 0, width: 960, height: 1080 },
              { x: 960, y: 0, width: 960, height: 1080 },
            ]
          : [
              { x: 0, y: 0, width: 1920, height: 540 },
              { x: 0, y: 540, width: 1920, height: 540 },
            ];
      nodes[0].rect = participatingRects[0];
      nodes[2].rect = participatingRects[1];
      windows[0].move_resize_frame(
        true,
        nodes[0].rect!.x,
        nodes[0].rect!.y,
        nodes[0].rect!.width,
        nodes[0].rect!.height
      );
      session.begin({} as Meta.Display, windows[0], grabOp);
      windows[0].move_resize_frame(true, resized.x, resized.y, resized.width, resized.height);

      session.handleResizing(nodes[0]);

      expect(nodes[0].percent).toBeCloseTo(expected[0], 3);
      expect(nodes[1].percent).toBeUndefined();
      expect(nodes[2].percent).toBeCloseTo(expected[1], 3);
      expect(nodes[0].percent! + nodes[2].percent!).toBeCloseTo(1, 6);
    }
  );

  it("falls back to the opposite edge for the outermost window", () => {
    const fixture = createTiledSessionFixture();
    const { container, ctx, nodes, session, windows } = fixture;
    fixture.setFocus(windows[1]);
    session.begin({} as Meta.Display, windows[1], Meta.GrabOp.KEYBOARD_RESIZING_E);
    const nextVisible = vi.spyOn(ctx.tree, "nextVisible");
    windows[1].move_resize_frame(true, 960, 0, 1060, 1080);

    session.handleResizing(nodes[1]);

    expect(nextVisible).toHaveBeenCalledWith(nodes[1], Meta.MotionDirection.RIGHT);
    expect(nextVisible).toHaveBeenCalledWith(nodes[1], Meta.MotionDirection.LEFT);
    expect(nodes[1].percent).toBeCloseTo(1060 / container.rect!.width, 3);
    expect(nodes[0].percent).toBeCloseTo(860 / container.rect!.width, 3);
  });

  it("does not mutate percents for an unknown grab or a floating focus node", () => {
    const { nodes, session, windows } = createTiledSessionFixture();
    session.begin({} as Meta.Display, windows[0], Meta.GrabOp.KEYBOARD_RESIZING_UNKNOWN);
    session.handleResizing(nodes[0]);
    expect(nodes.map((candidate) => candidate.percent)).toEqual([0.5, 0.5]);

    session.cleanup(nodes[0]);
    nodes[0].mode = WINDOW_MODES.FLOAT;
    session.handleResizing(nodes[0]);
    expect(nodes.map((candidate) => candidate.percent)).toEqual([0.5, 0.5]);
  });

  it("does not begin or apply tiling resize behavior while tiling is disabled", () => {
    const { ctx, nodes, session, windows } = createTiledSessionFixture();
    ctx.settings.set_boolean("tiling-mode-enabled", false);

    session.begin({} as Meta.Display, windows[0], Meta.GrabOp.RESIZING_E);
    windows[0].move_resize_frame(true, 0, 0, 1060, 1080);
    session.handleResizing(nodes[0]);

    expect(session.grabOp).toBe(Meta.GrabOp.NONE);
    expect(session.grabModeFor(nodes[0])).toBeNull();
    expect(nodes.map((candidate) => candidate.percent)).toEqual([0.5, 0.5]);
  });

  it("suspends live effects without ending Mutter's active grab", () => {
    const { ctx, nodes, session, windows } = createTiledSessionFixture();
    const remove = vi.spyOn(GLib.Source, "remove");
    session.begin({} as Meta.Display, windows[0], Meta.GrabOp.RESIZING_E);

    session.suspendTilingEffects();
    ctx.settings.set_boolean("tiling-mode-enabled", false);
    windows[0].move_resize_frame(true, 0, 0, 1060, 1080);
    session.handleResizing(nodes[0]);

    expect(remove).toHaveBeenCalled();
    expect(session.grabOp).toBe(Meta.GrabOp.RESIZING_E);
    expect(nodes.map((candidate) => candidate.percent)).toEqual([0.5, 0.5]);

    session.end({} as Meta.Display, windows[0], Meta.GrabOp.RESIZING_E);
    expect(session.grabOp).toBe(Meta.GrabOp.NONE);
    expect(session.grabModeFor(nodes[0])).toBeNull();
  });

  it("emits the resize observation before traversing or mutating topology", () => {
    const { ctx, host, nodes, session, windows } = createTiledSessionFixture();
    session.begin({} as Meta.Display, windows[0], Meta.GrabOp.RESIZING_E);
    windows[0].move_resize_frame(true, 0, 0, 1060, 1080);
    const nextVisible = vi.spyOn(ctx.tree, "nextVisible");

    session.handleResizing(nodes[0]);

    expect(host.observeGrabResizeUpdate).toHaveBeenCalledWith(windows[0]);
    expect(vi.mocked(host.observeGrabResizeUpdate).mock.invocationCallOrder[0]).toBeLessThan(
      nextVisible.mock.invocationCallOrder[0]
    );
  });
});
