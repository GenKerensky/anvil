import Meta from "gi://Meta";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  toggleFloatingMode,
  type CommandHandlerHost,
} from "../../../src/lib/extension/command-handlers.js";
import { RulesEngine } from "../../../src/lib/extension/rules-engine.js";
import { NODE_TYPES } from "../../../src/lib/extension/tree.js";
import { WINDOW_MODES } from "../../../src/lib/extension/window/constants.js";
import {
  createMockWindow,
  createTreeFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";

describe("CommandHandlers - floating mode", () => {
  let ctx: any;
  let host: CommandHandlerHost;
  let rulesEngine: RulesEngine;
  let floatingExempt: ReturnType<typeof vi.fn<(window: Meta.Window | null) => boolean>>;
  let workspaceTiled: ReturnType<typeof vi.fn<(window: Meta.Window) => boolean>>;
  let addFloatOverride: ReturnType<typeof vi.fn<(window: Meta.Window, withWmId: boolean) => void>>;
  let removeFloatOverride: ReturnType<
    typeof vi.fn<(window: Meta.Window, withWmId: boolean) => void>
  >;

  beforeEach(() => {
    ctx = createTreeFixture({ fullExtWm: true });
    rulesEngine = new RulesEngine({ overrides: [] });
    floatingExempt = vi.fn<(window: Meta.Window | null) => boolean>(() => false);
    workspaceTiled = vi.fn<(window: Meta.Window) => boolean>(() => true);
    addFloatOverride = vi.fn<(window: Meta.Window, withWmId: boolean) => void>();
    removeFloatOverride = vi.fn<(window: Meta.Window, withWmId: boolean) => void>();
    const configMgr = { windowProps: rulesEngine.windowProps };
    host = {
      tree: ctx.tree,
      focusMetaWindow: null,
      settings: ctx.settings,
      ext: { configMgr, settings: ctx.settings } as CommandHandlerHost["ext"],
      layoutEngine: ctx.layoutEngine,
      focusController: {} as CommandHandlerHost["focusController"],
      tilingRender: {} as CommandHandlerHost["tilingRender"],
      rulesEngine,
      scheduler: { pendingCount: 0, enqueue: vi.fn() },
      prefsTitle: "Anvil",
      findNodeWindow: (window) => ctx.tree.findNode(window),
      move: vi.fn(),
      moveCenter: vi.fn(),
      renderTree: vi.fn(),
      notifyFocusChanged: vi.fn(),
      updateStackedFocus: vi.fn(),
      updateTabbedFocus: vi.fn(),
      isActiveWindowWorkspaceTiled: workspaceTiled,
      isFloatingExempt: floatingExempt,
      floatWorkspace: vi.fn(),
      unfloatWorkspace: vi.fn(),
      floatAllWindows: vi.fn(),
      unfloatAllWindows: vi.fn(),
      addFloatOverride,
      removeFloatOverride,
      beginGrab: vi.fn(),
      endGrab: vi.fn(),
      setCancelGrab: vi.fn(),
      isRenderFrozen: () => false,
      freezeRender: vi.fn(),
      unfreezeRender: vi.fn(),
    };
  });

  function tiledWindow() {
    const metaWindow = createMockWindow({ wm_class: "TestApp", title: "Test Window" });
    const { monitor } = getWorkspaceAndMonitor(ctx);
    const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
    node.mode = WINDOW_MODES.TILE;
    return { metaWindow, node };
  }

  it("changes a tiled window to float and records an instance override", () => {
    const { metaWindow, node } = tiledWindow();

    toggleFloatingMode(host, { name: "FloatToggle", mode: WINDOW_MODES.FLOAT }, metaWindow);

    expect(node.mode).toBe(WINDOW_MODES.FLOAT);
    expect(addFloatOverride).toHaveBeenCalledWith(metaWindow, true);
  });

  it("changes an exempt window back to tile on a tiled workspace", () => {
    const { metaWindow, node } = tiledWindow();
    node.mode = WINDOW_MODES.FLOAT;
    floatingExempt.mockReturnValue(true);

    toggleFloatingMode(host, { name: "FloatToggle", mode: WINDOW_MODES.TILE }, metaWindow);

    expect(node.mode).toBe(WINDOW_MODES.TILE);
    expect(removeFloatOverride).toHaveBeenCalledWith(metaWindow, true);
  });

  it("keeps a window floating when its workspace is not tiled", () => {
    const { metaWindow, node } = tiledWindow();
    node.mode = WINDOW_MODES.FLOAT;
    floatingExempt.mockReturnValue(true);
    workspaceTiled.mockReturnValue(false);

    toggleFloatingMode(host, { name: "FloatToggle", mode: WINDOW_MODES.TILE }, metaWindow);

    expect(node.mode).toBe(WINDOW_MODES.FLOAT);
  });

  it("records class-wide overrides without a window id", () => {
    const { metaWindow } = tiledWindow();

    toggleFloatingMode(host, { name: "FloatClassToggle", mode: WINDOW_MODES.FLOAT }, metaWindow);

    expect(addFloatOverride).toHaveBeenCalledWith(metaWindow, false);
  });

  it("ignores values that do not identify a window node", () => {
    const { monitor } = getWorkspaceAndMonitor(ctx);

    toggleFloatingMode(
      host,
      { name: "FloatToggle", mode: WINDOW_MODES.FLOAT },
      monitor.nodeValue as unknown as Meta.Window
    );

    expect(addFloatOverride).not.toHaveBeenCalled();
    expect(monitor.mode).not.toBe(WINDOW_MODES.FLOAT);
  });
});
