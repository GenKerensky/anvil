/*
 * TilingRender owner tests for render-time window classification.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Meta from "gi://Meta";
import { NODE_TYPES } from "../../../src/lib/extension/tree.js";
import { TilingRender, type TilingRenderDeps } from "../../../src/lib/extension/tiling-render.js";
import { WINDOW_MODES } from "../../../src/lib/extension/window/constants.js";
import {
  createMockWindow,
  createTreeFixture,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";

describe("TilingRender - Window Classification", () => {
  function createWindowPredicate(defaultValue: boolean) {
    return vi.fn((_metaWindow: Meta.Window): boolean => defaultValue);
  }

  let ctx: any;
  let render: TilingRender;
  let isFloatingExempt: ReturnType<typeof createWindowPredicate>;
  let isActiveWindowWorkspaceTiled: ReturnType<typeof createWindowPredicate>;

  beforeEach(() => {
    ctx = createTreeFixture({ fullExtWm: true });
    isFloatingExempt = createWindowPredicate(false);
    isActiveWindowWorkspaceTiled = createWindowPredicate(true);
    const deps: TilingRenderDeps = {
      settings: ctx.settings,
      getTree: () => ctx.tree,
      moveWindow: vi.fn(),
      getAllNodeWindows: () => ctx.tree.getNodeByType(NODE_TYPES.WINDOW),
      isFloatingExempt,
      isActiveWindowWorkspaceTiled,
      getTiledChildren: (children) => ctx.tree.getTiledChildren(children),
      getResizeCount: () => 0,
      findParent: (node, type) => ctx.tree.findParent(node, type) ?? null,
      computeSizes: (node, children) => ctx.layoutEngine.computeSizes(node, children),
      presentation: ctx.runtime.presentation,
    };
    render = new TilingRender(deps);
  });

  afterEach(() => {
    ctx.cleanup();
  });

  function createWindow() {
    const metaWindow = createMockWindow({
      wm_class: "App",
      title: "Window",
      workspace: ctx.workspaces[0],
      monitor: 0,
    });
    const { monitor } = getWorkspaceAndMonitor(ctx);
    const node = ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
    return { metaWindow, node };
  }

  it("floats a window classified as exempt", () => {
    const { metaWindow, node } = createWindow();
    isFloatingExempt.mockReturnValue(true);

    render.processFloats();

    expect(isFloatingExempt).toHaveBeenCalledWith(metaWindow);
    expect(node.mode).toBe(WINDOW_MODES.FLOAT);
  });

  it("floats a window when its active workspace is not tiled", () => {
    const { metaWindow, node } = createWindow();
    isActiveWindowWorkspaceTiled.mockReturnValue(false);

    render.processFloats();

    expect(isActiveWindowWorkspaceTiled).toHaveBeenCalledWith(metaWindow);
    expect(node.mode).toBe(WINDOW_MODES.FLOAT);
  });

  it("tiles a non-exempt window on a tiled workspace", () => {
    const { node } = createWindow();
    node.mode = WINDOW_MODES.FLOAT;

    render.processFloats();

    expect(node.mode).toBe(WINDOW_MODES.TILE);
  });
});
