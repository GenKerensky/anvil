import { afterEach, describe, expect, it, vi } from "vitest";
import GLib from "gi://GLib";
import { RenderScheduler } from "../../../src/lib/extension/render-scheduler.js";

function fixture() {
  let idleCallback: GLib.SourceFunc | null = null;
  vi.spyOn(GLib, "idle_add").mockImplementation((_priority, callback) => {
    idleCallback = callback;
    return 42;
  });
  const host = {
    isRenderFrozen: vi.fn(() => false),
    freezeRender: vi.fn(),
    unfreezeRender: vi.fn(),
    updateDecorationLayout: vi.fn(),
    updateBorderLayout: vi.fn(),
    tilingRenderRender: vi.fn(),
    recordSettledTilingComparison: vi.fn(),
    trackCurrentWindows: vi.fn(),
    rebuildWorkspaceTopology: vi.fn(),
    disableDecorations: vi.fn(),
    tilingModeEnabled: true,
  };
  const scheduler = new RenderScheduler(host);
  return { host, scheduler, flush: () => idleCallback?.(null) };
}

afterEach(() => vi.restoreAllMocks());

describe("RenderScheduler border refresh", () => {
  it("skips the whole-tree border refresh for a focus-only render", () => {
    const { host, scheduler, flush } = fixture();

    scheduler.renderTree("focus", true, "skip");
    expect(flush()).toBe(false);

    expect(host.tilingRenderRender).toHaveBeenCalledWith("focus");
    expect(host.updateDecorationLayout).toHaveBeenCalledOnce();
    expect(host.updateBorderLayout).not.toHaveBeenCalled();
  });

  it("upgrades coalesced focus work when a full border refresh arrives", () => {
    const { host, scheduler, flush } = fixture();

    scheduler.renderTree("focus", true, "skip");
    scheduler.renderTree("size-changed", false, "full");
    expect(flush()).toBe(false);

    expect(host.updateBorderLayout).toHaveBeenCalledOnce();
  });

  it("preserves skip semantics while rendering is frozen", () => {
    const { host, scheduler } = fixture();
    host.isRenderFrozen.mockReturnValue(true);

    scheduler.renderTree("focus", false, "skip");

    expect(host.updateDecorationLayout).toHaveBeenCalledOnce();
    expect(host.updateBorderLayout).not.toHaveBeenCalled();
  });

  it("performs a requested full refresh while rendering is frozen", () => {
    const { host, scheduler } = fixture();
    host.isRenderFrozen.mockReturnValue(true);

    scheduler.renderTree("geometry", false, "full");

    expect(host.updateBorderLayout).toHaveBeenCalledOnce();
  });

  it("does not retain pending refresh work after disposal", () => {
    const { host, scheduler, flush } = fixture();
    scheduler.renderTree("focus", true, "skip");
    scheduler.renderTree("geometry", false, "full");

    scheduler.dispose();
    expect(flush()).toBe(false);
    expect(host.updateBorderLayout).not.toHaveBeenCalled();
  });

  it("keeps a full refresh when a later focus render coalesces", () => {
    const { host, scheduler, flush } = fixture();

    scheduler.renderTree("geometry", false, "full");
    scheduler.renderTree("focus", true, "skip");
    expect(flush()).toBe(false);

    expect(host.updateBorderLayout).toHaveBeenCalledOnce();
  });
});
