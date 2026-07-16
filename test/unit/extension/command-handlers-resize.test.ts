import Meta from "gi://Meta";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resize, type CommandHandlerHost } from "../../../src/lib/extension/command-handlers.js";
import { RulesEngine } from "../../../src/lib/extension/rules-engine.js";
import { NODE_TYPES } from "../../../src/lib/extension/tree.js";
import {
  createMockWindow,
  createTreeFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";

describe("CommandHandlers - resize", () => {
  let ctx: any;
  let host: CommandHandlerHost;
  let focusWindow: Meta.Window | null;
  let beginGrab: ReturnType<typeof vi.fn<(window: Meta.Window, grabOp: Meta.GrabOp) => void>>;
  let endGrab: ReturnType<typeof vi.fn<(window: Meta.Window, grabOp: Meta.GrabOp) => void>>;
  let enforceUltrawideSize: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    ctx = createTreeFixture({ fullExtWm: true });
    focusWindow = null;
    beginGrab = vi.fn<(window: Meta.Window, grabOp: Meta.GrabOp) => void>();
    endGrab = vi.fn<(window: Meta.Window, grabOp: Meta.GrabOp) => void>();
    enforceUltrawideSize = vi.fn((_node, rect) => rect);
    const rulesEngine = new RulesEngine({ overrides: [] });
    host = {
      tree: ctx.tree,
      get focusMetaWindow() {
        return focusWindow;
      },
      settings: ctx.settings,
      ext: {
        configMgr: { windowProps: rulesEngine.windowProps },
        settings: ctx.settings,
      } as CommandHandlerHost["ext"],
      layoutEngine: ctx.layoutEngine,
      focusController: {} as CommandHandlerHost["focusController"],
      tilingRender: { enforceUltrawideSize } as unknown as CommandHandlerHost["tilingRender"],
      rulesEngine,
      scheduler: {
        pendingCount: 0,
        enqueue: vi.fn((event) => event.callback()),
      },
      prefsTitle: "Anvil",
      findNodeWindow: (window) => ctx.tree.findNode(window),
      move: (window, rect) =>
        window.move_resize_frame(true, rect.x, rect.y, rect.width, rect.height),
      moveCenter: vi.fn(),
      renderTree: vi.fn(),
      notifyFocusChanged: vi.fn(),
      updateStackedFocus: vi.fn(),
      updateTabbedFocus: vi.fn(),
      isActiveWindowWorkspaceTiled: () => true,
      isFloatingExempt: () => false,
      floatWorkspace: vi.fn(),
      unfloatWorkspace: vi.fn(),
      floatAllWindows: vi.fn(),
      unfloatAllWindows: vi.fn(),
      addFloatOverride: vi.fn(),
      removeFloatOverride: vi.fn(),
      beginGrab,
      endGrab,
      setCancelGrab: vi.fn(),
      isRenderFrozen: () => false,
      freezeRender: vi.fn(),
      unfreezeRender: vi.fn(),
    };
  });

  function setupWindow() {
    const window = createMockWindow({ rect: { x: 100, y: 200, width: 800, height: 600 } });
    const { monitor } = getWorkspaceAndMonitor(ctx);
    ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, window);
    focusWindow = window;
    return window;
  }

  it("is a deliberate no-op without a focused window", () => {
    expect(() => resize(host, Meta.GrabOp.KEYBOARD_RESIZING_E, 10)).not.toThrow();
    expect(beginGrab).not.toHaveBeenCalled();
  });

  it.each([
    [Meta.GrabOp.KEYBOARD_RESIZING_E, { x: 100, y: 200, width: 820, height: 600 }],
    [Meta.GrabOp.KEYBOARD_RESIZING_W, { x: 80, y: 200, width: 820, height: 600 }],
    [Meta.GrabOp.KEYBOARD_RESIZING_N, { x: 100, y: 200, width: 800, height: 620 }],
    [Meta.GrabOp.KEYBOARD_RESIZING_S, { x: 100, y: 180, width: 800, height: 620 }],
  ])("applies grab direction %s through the owner host", (grabOp, expected) => {
    const window = setupWindow();

    resize(host, grabOp, 20);

    expect(window.get_frame_rect()).toMatchObject(expected);
    expect(beginGrab).toHaveBeenCalledWith(window, grabOp);
    expect(endGrab).toHaveBeenCalledWith(window, grabOp);
  });

  it("shrinks geometry for a negative resize amount", () => {
    const window = setupWindow();

    resize(host, Meta.GrabOp.KEYBOARD_RESIZING_E, -20);

    expect(window.get_frame_rect()).toMatchObject({
      x: 100,
      y: 200,
      width: 780,
      height: 600,
    });
  });

  it("preserves geometry for a zero resize amount", () => {
    const window = setupWindow();
    const before = { ...window.get_frame_rect() };

    resize(host, Meta.GrabOp.KEYBOARD_RESIZING_W, 0);

    expect(window.get_frame_rect()).toMatchObject(before);
  });

  it("applies monitor constraints before moving the grabbed window", () => {
    const window = setupWindow();
    enforceUltrawideSize.mockReturnValue({ x: 110, y: 210, width: 500, height: 400 });

    resize(host, Meta.GrabOp.KEYBOARD_RESIZING_E, 20);

    expect(window.get_frame_rect()).toMatchObject({ x: 110, y: 210, width: 500, height: 400 });
  });
});
