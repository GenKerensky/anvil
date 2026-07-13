import { describe, expect, it, vi } from "vitest";
import Meta from "gi://Meta";

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

  it("observes focus only for windows already admitted to the core", () => {
    const workspaceWindow = createMockWindow();
    const globals = installGnomeGlobals({
      display: { getFocusWindow: () => workspaceWindow },
    });
    workspaceWindow._workspace = globals.workspaces[0];
    const shadow = new TilingShadow(createMockSettings() as never);

    shadow.bootstrap([workspaceWindow], () => true);
    const admittedId = shadow.inspect().windows[0].id;
    expect(shadow.inspect().focusedWindowId).toBe(admittedId);

    shadow.observeFocus(null);
    expect(shadow.inspect().focusedWindowId).toBeUndefined();

    shadow.observeFocus(createMockWindow({ workspace: globals.workspaces[0] }));
    expect(shadow.inspect().focusedWindowId).toBeUndefined();
    globals.cleanup();
  });

  it("replaces portable policy as one complete value", () => {
    const globals = installGnomeGlobals();
    const settings = createMockSettings({
      "window-gap-size": 4,
      "window-gap-size-increment": 2,
      "stacked-tiling-mode-enabled": false,
      "tabbed-tiling-mode-enabled": true,
    });
    const shadow = new TilingShadow(settings as never);
    shadow.bootstrap([], () => true);
    expect(shadow.inspect().policy).toMatchObject({
      gap: 8,
      allowedLayouts: ["horizontal", "vertical", "tabbed"],
    });

    settings.set_boolean("tabbed-tiling-mode-enabled", false);
    shadow.observePolicy();

    expect(shadow.inspect().policy.allowedLayouts).toEqual(["horizontal", "vertical"]);
    globals.cleanup();
  });

  it("translates the legacy orientation default into portable layout policy", () => {
    const globals = installGnomeGlobals({
      display: {
        monitorGeometries: [{ x: 0, y: 0, width: 800, height: 1200 }],
      },
    });
    const shadow = new TilingShadow(createMockSettings() as never);

    shadow.bootstrap([], () => true);

    expect(shadow.inspect().policy.defaultLayout).toBe("vertical");
    globals.cleanup();
  });

  it("translates Surface-scoped settings without exposing workspace or output ids", () => {
    const globals = installGnomeGlobals();
    (global as unknown as { backend: unknown }).backend = {
      get_monitor_manager: vi.fn(() => ({
        get_logical_monitors: () => [{ get_monitors: () => [{ get_connector: () => "eDP-1" }] }],
      })),
    };
    const settings = createMockSettings({
      "workspace-skip-tile": "0",
      "showtab-decoration-enabled": false,
      "monitor-constraints": [["eDP-1", 900, 700, true, true]],
    });
    const shadow = new TilingShadow(settings as never);

    shadow.bootstrap([], () => true);

    const inspection = shadow.inspect();
    const surface = inspection.surfaces[0].id;
    expect(inspection.policy).toMatchObject({
      surfaceTiling: { [surface]: false },
      constraints: { [surface]: { maxWidth: 900, maxHeight: 700, resizeExempt: true } },
      headerExtent: 0,
    });
    expect(JSON.stringify(inspection.policy)).not.toContain("workspace");
    globals.cleanup();
  });

  it("buffers normalized facts until the bootstrap snapshot commits", () => {
    const globals = installGnomeGlobals();
    const window = createMockWindow({ workspace: globals.workspaces[0] });
    const shadow = new TilingShadow(createMockSettings() as never);

    shadow.observeWindow(window);
    expect(shadow.inspect().windows).toHaveLength(0);
    shadow.bootstrap([], () => true);

    expect(shadow.inspect().windows).toHaveLength(1);
    globals.cleanup();
  });

  it("translates Anvil overrides and built-ins into portable participation rules", () => {
    const globals = installGnomeGlobals();
    const override = createMockWindow({
      workspace: globals.workspaces[0],
      wm_class: "TestApp",
    });
    const pictureInPicture = createMockWindow({
      workspace: globals.workspaces[0],
      wm_class: "Player",
      title: "Picture-in-Picture",
    });
    const shadow = new TilingShadow(createMockSettings() as never, () => [
      { wmClass: "TestApp", mode: "float" },
    ]);

    shadow.bootstrap([override, pictureInPicture], () => true);

    expect(shadow.inspect().windows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          applicationId: "TestApp",
          participating: false,
          policyParticipationSource: "rule:override:float:0",
        }),
        expect.objectContaining({
          applicationId: "Player",
          participating: false,
          policyParticipationSource: "rule:builtin:pip",
        }),
      ])
    );
    globals.cleanup();
  });

  it("withdraws surfaces missing from a later topology observation", () => {
    const globals = installGnomeGlobals();
    const shadow = new TilingShadow(createMockSettings() as never);
    shadow.bootstrap([], () => true);
    expect(shadow.inspect().surfaces).toHaveLength(1);

    globals.workspaceManager.get_n_workspaces.mockReturnValue(0);
    shadow.observeTopology();

    expect(shadow.inspect().surfaces).toHaveLength(0);
    globals.cleanup();
  });

  it("retains topology bookkeeping when a candidate observation is rejected", () => {
    const globals = installGnomeGlobals();
    const shadow = new TilingShadow(createMockSettings() as never);
    shadow.bootstrap([], () => true);
    const replacementWorkspace = new globals.workspaces[0].constructor({ index: 0 });
    globals.workspaceManager.get_workspace_by_index.mockReturnValue(replacementWorkspace);
    globals.display.get_monitor_neighbor_index.mockReturnValue(1);

    shadow.observeTopology();
    expect(shadow.compareObservedGeometry()).toMatchObject({
      rejectedEventCount: 1,
      rejectedEvents: [{ eventType: "FactsObserved" }],
    });

    globals.workspaceManager.get_n_workspaces.mockReturnValue(0);
    globals.display.get_monitor_neighbor_index.mockReturnValue(-1);
    shadow.observeTopology();

    expect(shadow.inspect().surfaces).toEqual([]);
    globals.cleanup();
  });

  it("translates tiling actions without applying their intentions", () => {
    const first = createMockWindow();
    const globals = installGnomeGlobals({ display: { getFocusWindow: () => first } });
    const second = createMockWindow();
    first._workspace = globals.workspaces[0];
    second._workspace = globals.workspaces[0];
    const shadow = new TilingShadow(createMockSettings() as never);
    shadow.bootstrap([first, second], () => true);
    const secondId = shadow.inspect().windows[1].id;

    shadow.observeCommand({ name: "Focus", direction: "RIGHT" }, first);

    expect(shadow.inspect()).toMatchObject({
      containers: [{ selectedChildId: secondId }],
    });
    globals.cleanup();
  });

  it("translates split actions into portable nested topology", () => {
    const first = createMockWindow();
    const globals = installGnomeGlobals({ display: { getFocusWindow: () => first } });
    const second = createMockWindow();
    first._workspace = globals.workspaces[0];
    second._workspace = globals.workspaces[0];
    const shadow = new TilingShadow(createMockSettings() as never);
    shadow.bootstrap([first, second], () => true);
    const [firstId, secondId] = shadow.inspect().windows.map((window) => window.id);

    shadow.observeCommand({ name: "Split", orientation: "vertical" }, first);

    expect(shadow.inspect()).toMatchObject({
      containers: [
        { id: "container:1", childIds: ["container:2", secondId] },
        {
          id: "container:2",
          parentId: "container:1",
          layout: "vertical",
          childIds: [firstId],
        },
      ],
    });
    globals.cleanup();
  });

  it("translates a cardinal GNOME resize grab into one portable operation", () => {
    const first = createMockWindow({ rect: { x: 0, y: 0, width: 960, height: 1080 } });
    const second = createMockWindow({ rect: { x: 960, y: 0, width: 960, height: 1080 } });
    const globals = installGnomeGlobals({ display: { getFocusWindow: () => first } });
    first._workspace = globals.workspaces[0];
    second._workspace = globals.workspaces[0];
    const shadow = new TilingShadow(createMockSettings() as never);
    shadow.bootstrap([first, second], () => true);
    const [firstId, secondId] = shadow.inspect().windows.map((window) => window.id);

    shadow.observeGrabBegin(first, Meta.GrabOp.RESIZING_E);
    expect(shadow.inspect().operations).toEqual([
      expect.objectContaining({
        id: "operation:1",
        kind: "resize",
        windowId: firstId,
        neighborWindowId: secondId,
        direction: "right",
      }),
    ]);

    first._rect.width = 1152;
    shadow.observeGrabUpdate(first);
    expect(shadow.inspect().operations[0].overlayWeights).toEqual({
      [firstId]: 0.6,
      [secondId]: 0.4,
    });

    shadow.observeGrabEnd(first, false);
    expect(shadow.inspect()).toMatchObject({
      operations: [],
      containers: [{ weights: { [firstId]: 0.6, [secondId]: 0.4 } }],
    });
    globals.cleanup();
  });

  it("uses the opposite sibling when a resize starts on an outer edge", () => {
    const first = createMockWindow({ rect: { x: 0, y: 0, width: 960, height: 1080 } });
    const second = createMockWindow({ rect: { x: 960, y: 0, width: 960, height: 1080 } });
    const globals = installGnomeGlobals();
    first._workspace = globals.workspaces[0];
    second._workspace = globals.workspaces[0];
    const shadow = new TilingShadow(createMockSettings() as never);
    shadow.bootstrap([first, second], () => true);
    const [firstId, secondId] = shadow.inspect().windows.map((window) => window.id);

    shadow.observeGrabBegin(second, Meta.GrabOp.RESIZING_E);

    expect(shadow.inspect().operations).toEqual([
      expect.objectContaining({
        windowId: secondId,
        neighborWindowId: firstId,
        direction: "left",
      }),
    ]);
    globals.cleanup();
  });

  it("cancels a resize overlay and ignores late frame updates", () => {
    const first = createMockWindow({ rect: { x: 0, y: 0, width: 960, height: 1080 } });
    const second = createMockWindow({ rect: { x: 960, y: 0, width: 960, height: 1080 } });
    const globals = installGnomeGlobals();
    first._workspace = globals.workspaces[0];
    second._workspace = globals.workspaces[0];
    const shadow = new TilingShadow(createMockSettings() as never);
    shadow.bootstrap([first, second], () => true);

    shadow.observeGrabBegin(first, Meta.GrabOp.RESIZING_E);
    first._rect.width = 1152;
    shadow.observeGrabUpdate(first);
    shadow.observeGrabEnd(first, true);

    const cancelled = shadow.inspect();
    expect(cancelled.operations).toEqual([]);
    expect(cancelled.containers[0].weights).toEqual({});
    first._rect.width = 1200;
    shadow.observeGrabUpdate(first);
    expect(shadow.inspect().revision).toBe(cancelled.revision);
    globals.cleanup();
  });

  it("reports structured desired-versus-observed geometry mismatches", () => {
    const window = createMockWindow({ rect: { x: 10, y: 20, width: 300, height: 200 } });
    const globals = installGnomeGlobals();
    window._workspace = globals.workspaces[0];
    const shadow = new TilingShadow(createMockSettings() as never);
    shadow.bootstrap([window], () => true);

    const comparison = shadow.compareObservedGeometry();

    expect(comparison.mismatchCount).toBe(1);
    expect(comparison.rejectedEventCount).toBe(0);
    expect(comparison.mismatches[0]).toMatchObject({
      windowId: shadow.inspect().windows[0].id,
      observed: { x: 10, y: 20, width: 300, height: 200 },
    });
    globals.cleanup();
  });
});
