/*
 * SignalManager unit tests.
 *
 * Covers the workspace-transition lifecycle (review finding S4): cancelling the
 * 300ms `active-workspace-changed` timeout in unbindAll() must reset the
 * `workspaceChanging` flag so a disable during a transition does not leave it
 * stuck true until the next switch (which would suppress PointerPolicy work
 * after recreation).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { SignalManager } from "../../../src/lib/extension/signal-manager.js";
import { createWindowManagerFixture } from "../mocks/helpers/index.js";

describe("SignalManager - workspace transition lifecycle (S4)", () => {
  let ctx: any;

  beforeEach(() => {
    ctx = createWindowManagerFixture();
  });

  it("resets workspaceChanging and clears the timer id when unbindAll cancels the transition timer", () => {
    const host: any = { workspaceChanging: false };
    const sm = new SignalManager(host);

    // Simulate a bound manager mid-transition: the 300ms timeout is pending and
    // the flag is set. bindAll() is not driven here (it needs the full Shell
    // signal surface); unbindAll only touches host.workspaceChanging and
    // global.workspace_manager, both available from the fixture globals.
    (sm as any)._signalsBound = true;
    (sm as any)._workspaceChangingTimeoutId = 42;
    host.workspaceChanging = true;

    sm.unbindAll();

    expect(host.workspaceChanging).toBe(false);
    expect((sm as any)._workspaceChangingTimeoutId).toBe(0);
    expect(sm.isBound).toBe(false);
  });

  it("does not reset workspaceChanging when unbindAll is a no-op (never bound)", () => {
    const host: any = { workspaceChanging: true };
    const sm = new SignalManager(host);

    // Never bound → unbindAll returns immediately without touching the flag.
    sm.unbindAll();

    expect((sm as any)._signalsBound).toBe(false);
    // Flag is left as-is when there was no timer to cancel and nothing bound.
    expect(host.workspaceChanging).toBe(true);
  });

  it("bindWorkspaceSignals is a no-op until signals are bound (S2 lifecycle purity)", () => {
    const host: any = {
      tracker: { onWorkspaceWindowAdded: vi.fn() },
      workspaceChanging: false,
    };
    const sm = new SignalManager(host);
    const connectSpy = vi.fn(() => 123);
    const workspace = { connect: connectSpy } as any;

    // Construction-time / pre-enable call must NOT connect (architecture rule §1).
    sm.bindWorkspaceSignals(workspace);
    expect(connectSpy).not.toHaveBeenCalled();

    // Once enabled (bound), the same call connects the window-added signal.
    (sm as any)._signalsBound = true;
    sm.bindWorkspaceSignals(workspace);
    expect(connectSpy).toHaveBeenCalledWith("window-added", expect.any(Function));
    expect(workspace.workspaceSignals).toEqual([123]);
  });
});
