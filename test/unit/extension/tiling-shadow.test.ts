import { describe, expect, it, vi } from "vitest";

import {
  GnomeTilingIdentityRegistry,
  TilingShadow,
} from "../../../src/lib/extension/tiling-shadow.js";
import {
  createMockSettings,
  createMockWindow,
  installGnomeGlobals,
} from "../mocks/helpers/index.js";

describe("GnomeTilingIdentityRegistry", () => {
  it("keeps platform identities private and stable", () => {
    const registry = new GnomeTilingIdentityRegistry();
    const firstWorkspace = {} as never;
    const secondWorkspace = {} as never;
    const firstWindow = {} as never;
    const secondWindow = {} as never;

    expect(registry.window(firstWindow)).toBe(registry.window(firstWindow));
    expect(registry.window(secondWindow)).not.toBe(registry.window(firstWindow));
    expect(registry.surface(firstWorkspace, "DP-1")).toBe(registry.surface(firstWorkspace, "DP-1"));
    expect(registry.surface(firstWorkspace, "DP-2")).not.toBe(
      registry.surface(firstWorkspace, "DP-1")
    );
    expect(registry.surface(secondWorkspace, "DP-1")).not.toBe(
      registry.surface(firstWorkspace, "DP-1")
    );
  });
});

describe("TilingShadow", () => {
  it("translates GNOME geometry into surface-local facts", () => {
    const globals = installGnomeGlobals({
      display: {
        monitorCount: 2,
        monitorGeometries: [
          { x: 0, y: 0, width: 1920, height: 1080 },
          { x: 1920, y: 0, width: 1920, height: 1080 },
        ],
      },
    });
    (global as unknown as { backend: unknown }).backend = {
      get_monitor_manager: vi.fn(() => ({
        get_logical_monitors: () =>
          ["DP-1", "DP-2"].map((connector) => ({
            get_monitors: () => [{ get_connector: () => connector }],
          })),
      })),
    } as never;
    const workspace = globals.workspaces[0];
    const window = createMockWindow({
      workspace,
      monitor: 1,
      rect: { x: 2020, y: 50, width: 800, height: 600 },
    });
    const shadow = new TilingShadow(createMockSettings() as never);

    shadow.bootstrap([window], () => true);

    const inspection = shadow.inspect();
    expect(inspection.surfaces).toHaveLength(2);
    expect(inspection.windows).toHaveLength(1);
    expect(inspection.windows[0].frame).toEqual({ x: 100, y: 50, width: 800, height: 600 });
    expect(inspection.windows[0].surfaceId).toBe(inspection.surfaces[1].id);
    globals.cleanup();
  });

  it("preserves identity while observing metadata and frame changes", () => {
    const globals = installGnomeGlobals();
    (global as unknown as { backend: unknown }).backend = {
      get_monitor_manager: vi.fn(() => ({
        get_logical_monitors: () => [
          {
            get_monitors: () => [{ get_connector: () => "eDP-1" }],
          },
        ],
      })),
    } as never;
    const workspace = globals.workspaces[0];
    const window = createMockWindow({ workspace, rect: { x: 10, y: 20, width: 300, height: 200 } });
    const shadow = new TilingShadow(createMockSettings() as never);
    shadow.bootstrap([window], () => true);
    const originalId = shadow.inspect().windows[0].id;

    window.title = "Renamed";
    window._rect.x = 40;
    shadow.observeWindow(window);
    shadow.observeFrame(window);

    const observed = shadow.inspect().windows[0];
    expect(observed.id).toBe(originalId);
    expect(observed.title).toBe("Renamed");
    expect(observed.frame.x).toBe(40);
    globals.cleanup();
  });
});
