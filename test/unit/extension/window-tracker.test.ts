import { describe, expect, it, vi } from "vitest";

import {
  WindowTracker,
  type WindowTrackerHost,
} from "../../../src/lib/extension/window-tracker.js";
import { createMockWindow } from "../mocks/helpers/index.js";

describe("WindowTracker - current window reconciliation", () => {
  function createHarness(windows: ReturnType<typeof createMockWindow>[]) {
    const tree = { attachNode: { stale: true } };
    const updateMetaWorkspaceMonitor = vi.fn();
    const updateDecorationLayout = vi.fn();
    const host = {
      tree,
      windowsAllWorkspaces: windows,
      updateMetaWorkspaceMonitor,
      updateDecorationLayout,
    } as unknown as WindowTrackerHost;
    const tracker = new WindowTracker(host);
    const trackWindow = vi.spyOn(tracker, "trackWindow").mockImplementation(() => {});

    return {
      host,
      tracker,
      trackWindow,
      updateMetaWorkspaceMonitor,
      updateDecorationLayout,
    };
  }

  it("clears the attachment and refreshes decorations for an empty window list", () => {
    const harness = createHarness([]);

    harness.tracker.trackCurrentWindows();

    expect(harness.host.tree.attachNode).toBeNull();
    expect(harness.trackWindow).not.toHaveBeenCalled();
    expect(harness.updateMetaWorkspaceMonitor).not.toHaveBeenCalled();
    expect(harness.updateDecorationLayout).toHaveBeenCalledOnce();
  });

  it("tracks and reconciles every current window before refreshing decorations", () => {
    const first = createMockWindow({ id: 1, monitor: 0 });
    const second = createMockWindow({ id: 2, monitor: 1 });
    const harness = createHarness([first, second]);

    harness.tracker.trackCurrentWindows();

    expect(harness.trackWindow).toHaveBeenNthCalledWith(1, global.display, first);
    expect(harness.trackWindow).toHaveBeenNthCalledWith(2, global.display, second);
    expect(harness.updateMetaWorkspaceMonitor).toHaveBeenNthCalledWith(
      1,
      "track-current-windows",
      0,
      first
    );
    expect(harness.updateMetaWorkspaceMonitor).toHaveBeenNthCalledWith(
      2,
      "track-current-windows",
      1,
      second
    );
    expect(harness.updateDecorationLayout).toHaveBeenCalledOnce();
    expect(harness.updateMetaWorkspaceMonitor.mock.invocationCallOrder[1]).toBeLessThan(
      harness.updateDecorationLayout.mock.invocationCallOrder[0]
    );
  });
});
