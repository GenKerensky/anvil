/*
 * Runtime composition tests for the portable grab observer and legacy
 * GrabResizeSession. Behavioral resize coverage belongs to the session owner.
 */

import Meta from "gi://Meta";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NODE_TYPES } from "../../../src/lib/extension/tree.js";
import { WINDOW_MODES } from "../../../src/lib/extension/window/constants.js";
import {
  createAnvilRuntimeFixture,
  createMockWindow,
  getWorkspaceAndMonitor,
} from "../mocks/helpers/index.js";

function setupFocusWindow(ctx: any) {
  const metaWindow = createMockWindow({
    wm_class: "TestApp",
    title: "Test",
    workspace: ctx.workspaces[0],
    monitor: 0,
  });
  const { monitor } = getWorkspaceAndMonitor(ctx);
  ctx.tree.createNode(monitor.nodeValue, NODE_TYPES.WINDOW, metaWindow);
  ctx.display.get_focus_window.mockReturnValue(metaWindow);
  return metaWindow;
}

describe("AnvilRuntime grab delegation", () => {
  let ctx: any;

  beforeEach(() => {
    ctx = createAnvilRuntimeFixture();
  });

  it("observes begin and end before delegating to the legacy grab owner", () => {
    const runtime = ctx.anvilRuntime;
    const metaWindow = setupFocusWindow(ctx);
    const shadowBegin = vi.spyOn(runtime._tilingShadow, "observeGrabBegin");
    const shadowUpdate = vi.spyOn(runtime._tilingShadow, "observeGrabUpdate");
    const shadowEnd = vi.spyOn(runtime._tilingShadow, "observeGrabEnd");
    const legacyBegin = vi.spyOn(runtime._grab, "begin");
    const legacyEnd = vi.spyOn(runtime._grab, "end");

    runtime._handleGrabOpBegin(ctx.display, metaWindow, Meta.GrabOp.RESIZING_E);
    runtime._handleGrabOpEnd(ctx.display, metaWindow, Meta.GrabOp.RESIZING_E);

    expect(shadowBegin).toHaveBeenCalledWith(metaWindow, Meta.GrabOp.RESIZING_E);
    expect(shadowBegin.mock.invocationCallOrder[0]).toBeLessThan(
      legacyBegin.mock.invocationCallOrder[0]
    );
    expect(shadowUpdate).toHaveBeenCalledWith(metaWindow);
    expect(shadowEnd).toHaveBeenCalledWith(metaWindow, false, false);
    expect(shadowEnd.mock.invocationCallOrder[0]).toBeLessThan(
      legacyEnd.mock.invocationCallOrder[0]
    );
  });

  it("wires session resize observations into the portable shadow", () => {
    const runtime = ctx.anvilRuntime;
    const metaWindow = setupFocusWindow(ctx);
    const shadowUpdate = vi.spyOn(runtime._tilingShadow, "observeGrabUpdate");
    runtime._handleGrabOpBegin(ctx.display, metaWindow, Meta.GrabOp.RESIZING_E);

    runtime._grab.handleResizing(null);

    expect(shadowUpdate).toHaveBeenCalledWith(metaWindow);
  });

  it("samples moving pointers before the final legacy drag commit", () => {
    const runtime = ctx.anvilRuntime;
    const metaWindow = setupFocusWindow(ctx);
    const node = runtime.findNodeWindow(metaWindow);
    node.mode = WINDOW_MODES.GRAB_TILE;
    (global as unknown as { get_pointer: ReturnType<typeof vi.fn> }).get_pointer.mockReturnValue([
      320, 240, 0,
    ]);
    const shadowMove = vi.spyOn(runtime._tilingShadow, "observeGrabMoveUpdate");
    const shadowEnd = vi.spyOn(runtime._tilingShadow, "observeGrabEnd");
    const legacyEnd = vi.spyOn(runtime._grab, "end");
    vi.spyOn(runtime, "allowDragDropTile").mockReturnValue(true);

    runtime._handleGrabOpBegin(ctx.display, metaWindow, Meta.GrabOp.MOVING);
    runtime._grab.handleMoving(node);
    runtime._handleGrabOpEnd(ctx.display, metaWindow, Meta.GrabOp.MOVING_UNCONSTRAINED);

    expect(shadowMove).toHaveBeenNthCalledWith(1, metaWindow, [320, 240], true);
    expect(shadowMove).toHaveBeenNthCalledWith(2, metaWindow, [320, 240], true);
    expect(shadowEnd).toHaveBeenCalledWith(metaWindow, false, true);
    expect(shadowEnd.mock.invocationCallOrder[0]).toBeLessThan(
      legacyEnd.mock.invocationCallOrder[0]
    );
  });

  it("cancels portable drag placement when the tile modifier is not held", () => {
    const runtime = ctx.anvilRuntime;
    const metaWindow = setupFocusWindow(ctx);
    const node = runtime.findNodeWindow(metaWindow);
    node.mode = WINDOW_MODES.GRAB_TILE;
    vi.spyOn(runtime, "allowDragDropTile").mockReturnValue(false);
    const shadowMove = vi.spyOn(runtime._tilingShadow, "observeGrabMoveUpdate");
    const shadowEnd = vi.spyOn(runtime._tilingShadow, "observeGrabEnd");

    runtime._handleGrabOpBegin(ctx.display, metaWindow, Meta.GrabOp.MOVING);
    runtime._grab.handleMoving(node);
    runtime._handleGrabOpEnd(ctx.display, metaWindow, Meta.GrabOp.MOVING_UNCONSTRAINED);

    expect(shadowMove).toHaveBeenCalledWith(metaWindow, [0, 0], false);
    expect(shadowEnd).toHaveBeenCalledWith(metaWindow, false, false);
    expect(runtime._tilingShadow.inspect().operations).toEqual([]);
  });

  it("samples portable frames in core mode without invoking the legacy writer", () => {
    const runtime = ctx.anvilRuntime;
    const metaWindow = setupFocusWindow(ctx);
    runtime._tilingEngineMode = "core";
    vi.spyOn(runtime, "allowDragDropTile").mockReturnValue(true);
    (global as unknown as { get_pointer: ReturnType<typeof vi.fn> }).get_pointer.mockReturnValue([
      320, 240, 0,
    ]);
    const observeFrame = vi.spyOn(runtime._tilingShadow, "observeFrame");
    const observeResize = vi.spyOn(runtime._tilingShadow, "observeGrabUpdate");
    const observeMove = vi.spyOn(runtime._tilingShadow, "observeGrabMoveUpdate");
    const legacyBegin = vi.spyOn(runtime._grab, "begin");
    const legacyEnd = vi.spyOn(runtime._grab, "end");

    runtime._handleGrabOpBegin(ctx.display, metaWindow, Meta.GrabOp.MOVING);
    runtime._observePortableFrame(metaWindow);
    runtime._handleGrabOpEnd(ctx.display, metaWindow, Meta.GrabOp.MOVING_UNCONSTRAINED);

    expect(observeFrame).toHaveBeenCalledWith(metaWindow);
    expect(observeResize).toHaveBeenCalledWith(metaWindow);
    expect(observeMove).toHaveBeenCalledWith(metaWindow, [320, 240], true);
    expect(legacyBegin).not.toHaveBeenCalled();
    expect(legacyEnd).not.toHaveBeenCalled();
  });
});
