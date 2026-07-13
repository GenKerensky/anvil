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
  it("reports transitions to a runtime-owned sink", () => {
    const globals = installGnomeGlobals();
    const transitionObserved = vi.fn();
    const window = createMockWindow({ workspace: globals.workspaces[0] });
    const shadow = new TilingShadow(createMockSettings() as never, () => [], transitionObserved);

    shadow.bootstrap([], () => true);
    shadow.observeWindow(window);

    expect(transitionObserved).toHaveBeenCalledTimes(2);
    expect(transitionObserved.mock.calls.map(([transition]) => transition.status)).toEqual([
      "committed",
      "committed",
    ]);
    globals.cleanup();
  });

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
    expect(shadow.presentationPlan().windows[0]).toMatchObject({
      id: inspection.windows[0].id,
      surfaceId: inspection.surfaces[1].id,
      frame: { x: 1920, y: 0, width: 1920, height: 1080 },
      parentId: inspection.windows[0].parentId,
      parentLayout: "horizontal",
      selected: true,
    });
    expect(shadow.resolveWindow(inspection.windows[0].id)).toBe(window);
    expect(shadow.inspectWindow(window)).toEqual(inspection.windows[0]);
    const nativeRect = {} as { x: number; y: number; width: number; height: number };
    Object.defineProperties(nativeRect, {
      x: { value: 2020, enumerable: true },
      y: { value: 50, enumerable: true },
      width: { value: 800, enumerable: false },
      height: { value: 600, enumerable: false },
    });
    expect(shadow.toLocalRect(inspection.surfaces[1].id, nativeRect)).toEqual({
      x: 100,
      y: 50,
      width: 800,
      height: 600,
    });
    globals.cleanup();
  });

  it("removes withdrawn windows from the GNOME identity resolver", () => {
    const globals = installGnomeGlobals();
    const window = createMockWindow({ workspace: globals.workspaces[0] });
    const shadow = new TilingShadow(createMockSettings() as never);
    shadow.bootstrap([window], () => true);
    const id = shadow.inspect().windows[0].id;

    shadow.withdrawWindow(window);

    expect(shadow.resolveWindow(id)).toBeUndefined();
    expect(shadow.presentationPlan().windows).toEqual([]);

    shadow.observeWindow(window);
    const replacementId = shadow.inspect().windows[0].id;
    expect(replacementId).not.toBe(id);
    expect(shadow.resolveWindow(replacementId)).toBe(window);
    globals.cleanup();
  });

  it("projects stacked and tabbed selection without exposing legacy Nodes", () => {
    const first = createMockWindow();
    const second = createMockWindow();
    const globals = installGnomeGlobals({ display: { getFocusWindow: () => first } });
    first._workspace = globals.workspaces[0];
    second._workspace = globals.workspaces[0];
    const shadow = new TilingShadow(createMockSettings() as never);
    shadow.bootstrap([first, second], () => true);

    shadow.observeCommand({ name: "LayoutTabbedToggle" }, first);

    const [firstPlan, secondPlan] = shadow.presentationPlan().windows;
    expect(firstPlan).toMatchObject({ parentLayout: "tabbed", selected: true });
    expect(secondPlan).toMatchObject({ parentLayout: "tabbed", selected: false });
    const containerPlan = shadow.presentationPlan().containers[0];
    expect(containerPlan.stackingOrder).toEqual([secondPlan.id, firstPlan.id]);
    (containerPlan.stackingOrder as unknown as string[]).reverse();
    expect(shadow.presentationPlan().containers[0].stackingOrder).toEqual([
      secondPlan.id,
      firstPlan.id,
    ]);
    expect(JSON.stringify(shadow.presentationPlan())).not.toContain("nodeValue");
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

  it("normalizes Mutter client minimum-size hints", () => {
    const globals = installGnomeGlobals();
    const window = createMockWindow({
      workspace: globals.workspaces[0],
      minimum_size: { width: 120, height: 430 },
      client_frame_delta: { width: 0, height: 50 },
    });
    const shadow = new TilingShadow(createMockSettings() as never);

    shadow.bootstrap([window], () => true);

    expect(shadow.inspect().windows[0].minimumSize).toEqual({ width: 120, height: 380 });
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

  it("submits a normalized window snapshot as one ordered fact batch", () => {
    const globals = installGnomeGlobals();
    const windows = [createMockWindow(), createMockWindow(), createMockWindow()];
    for (const window of windows) window._workspace = globals.workspaces[0];
    const shadow = new TilingShadow(createMockSettings() as never);
    shadow.bootstrap([], () => true);
    const bootstrapRevision = shadow.inspect().revision;

    shadow.observeWindows(windows);

    const inspection = shadow.inspect();
    expect(inspection.revision).toBe(bootstrapRevision + 1);
    expect(inspection.containers[0].childIds).toEqual(
      windows.map(
        (window) =>
          shadow.inspect().windows.find((item) => shadow.resolveWindow(item.id) === window)!.id
      )
    );
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

    expect(shadow.observeCommand({ name: "Focus", direction: "RIGHT" }, first)).toBe(true);
    expect(shadow.observeCommand({ name: "PrefsOpen" }, first)).toBe(false);

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
        boundaries: [expect.objectContaining({ neighborWindowId: secondId, direction: "right" })],
      }),
    ]);

    first._rect.width = 1152;
    shadow.observeGrabUpdate(first);
    const active = shadow.inspect().operations[0];
    expect(active.kind).toBe("resize");
    if (active.kind !== "resize") throw new Error("expected resize operation");
    expect(active.boundaries[0].overlayWeights).toEqual({
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

  it("translates a keyboard resize grab through the same portable operation seam", () => {
    const first = createMockWindow({ rect: { x: 0, y: 0, width: 960, height: 1080 } });
    const second = createMockWindow({ rect: { x: 960, y: 0, width: 960, height: 1080 } });
    const globals = installGnomeGlobals();
    first._workspace = globals.workspaces[0];
    second._workspace = globals.workspaces[0];
    const shadow = new TilingShadow(createMockSettings() as never);
    shadow.bootstrap([first, second], () => true);

    shadow.observeGrabBegin(first, Meta.GrabOp.KEYBOARD_RESIZING_E);

    expect(shadow.inspect().operations).toEqual([
      expect.objectContaining({
        windowId: shadow.inspect().windows[0].id,
        boundaries: [expect.objectContaining({ direction: "right" })],
      }),
    ]);
    globals.cleanup();
  });

  it("translates a moving GNOME grab into a portable drag preview and commit", () => {
    const first = createMockWindow({ rect: { x: 0, y: 0, width: 960, height: 1080 } });
    const second = createMockWindow({ rect: { x: 960, y: 0, width: 960, height: 1080 } });
    const globals = installGnomeGlobals({ display: { getFocusWindow: () => first } });
    first._workspace = globals.workspaces[0];
    second._workspace = globals.workspaces[0];
    const shadow = new TilingShadow(createMockSettings({ "dnd-center-layout": "SWAP" }) as never);
    shadow.bootstrap([first, second], () => true);
    const [firstId, secondId] = shadow.inspect().windows.map((window) => window.id);

    shadow.observeGrabBegin(first, Meta.GrabOp.MOVING);
    expect(shadow.inspect().operations).toEqual([]);

    shadow.observeGrabMoveUpdate(first, [1440, 540], true);
    expect(shadow.inspect()).toMatchObject({
      operations: [
        {
          id: "operation:1",
          kind: "drag",
          windowId: firstId,
          centerAction: "swap",
          placement: { kind: "swap", targetWindowId: secondId, region: "center" },
        },
      ],
      renderPlan: {
        previews: [
          {
            operationId: "operation:1",
            surfaceId: shadow.inspect().surfaces[0].id,
            rect: { x: 960, y: 0, width: 960, height: 1080 },
          },
        ],
      },
    });

    shadow.observeGrabEnd(first, false, true);
    expect(shadow.inspect()).toMatchObject({
      operations: [],
      renderPlan: { previews: [] },
      containers: [{ childIds: [secondId, firstId] }],
    });
    globals.cleanup();
  });

  it("translates global drag coordinates into the target Surface coordinate space", () => {
    const globals = installGnomeGlobals({
      display: {
        monitorCount: 2,
        monitorGeometries: [
          { x: 0, y: 0, width: 1920, height: 1080 },
          { x: 1920, y: 0, width: 1920, height: 1080 },
        ],
      },
    });
    const first = createMockWindow({ monitor: 0, rect: { x: 0, y: 0, width: 1920, height: 1080 } });
    const second = createMockWindow({
      monitor: 1,
      rect: { x: 1920, y: 0, width: 1920, height: 1080 },
    });
    first._workspace = globals.workspaces[0];
    second._workspace = globals.workspaces[0];
    const shadow = new TilingShadow(createMockSettings({ "dnd-center-layout": "SWAP" }) as never);
    shadow.bootstrap([first, second], () => true);
    const targetSurface = shadow.inspect().surfaces[1].id;

    shadow.observeGrabBegin(first, Meta.GrabOp.MOVING);
    shadow.observeGrabMoveUpdate(first, [2880, 540], true);

    expect(shadow.inspect().renderPlan.previews).toEqual([
      expect.objectContaining({
        surfaceId: targetSurface,
        rect: { x: 0, y: 0, width: 1920, height: 1080 },
      }),
    ]);
    globals.cleanup();
  });

  it("keeps at most one GNOME grab operation active across disjoint surfaces", () => {
    const globals = installGnomeGlobals({
      display: {
        monitorCount: 2,
        monitorGeometries: [
          { x: 0, y: 0, width: 1000, height: 800 },
          { x: 1000, y: 0, width: 1000, height: 800 },
        ],
      },
    });
    const [first, second, third, fourth] = [
      createMockWindow({ monitor: 0, rect: { x: 0, y: 0, width: 500, height: 800 } }),
      createMockWindow({ monitor: 0, rect: { x: 500, y: 0, width: 500, height: 800 } }),
      createMockWindow({ monitor: 1, rect: { x: 1000, y: 0, width: 500, height: 800 } }),
      createMockWindow({ monitor: 1, rect: { x: 1500, y: 0, width: 500, height: 800 } }),
    ];
    for (const window of [first, second, third, fourth]) {
      window._workspace = globals.workspaces[0];
    }
    const shadow = new TilingShadow(createMockSettings() as never);
    shadow.bootstrap([first, second, third, fourth], () => true);
    const thirdId = shadow.inspect().windows[2].id;

    shadow.observeGrabBegin(first, Meta.GrabOp.RESIZING_E);
    expect(shadow.inspect().operations).toHaveLength(1);

    shadow.observeGrabBegin(third, Meta.GrabOp.RESIZING_E);

    expect(shadow.inspect().operations).toEqual([
      expect.objectContaining({ id: "operation:2", windowId: thirdId }),
    ]);
    globals.cleanup();
  });

  it("cancels an active resize when a moving grab begins", () => {
    const first = createMockWindow({ rect: { x: 0, y: 0, width: 960, height: 1080 } });
    const second = createMockWindow({ rect: { x: 960, y: 0, width: 960, height: 1080 } });
    const globals = installGnomeGlobals();
    first._workspace = globals.workspaces[0];
    second._workspace = globals.workspaces[0];
    const shadow = new TilingShadow(createMockSettings() as never);
    shadow.bootstrap([first, second], () => true);
    const secondId = shadow.inspect().windows[1].id;

    shadow.observeGrabBegin(first, Meta.GrabOp.RESIZING_E);
    shadow.observeGrabBegin(second, Meta.GrabOp.MOVING);
    shadow.observeGrabMoveUpdate(second, [480, 540], true);

    expect(shadow.inspect().operations).toEqual([
      expect.objectContaining({ id: "operation:2", kind: "drag", windowId: secondId }),
    ]);
    globals.cleanup();
  });

  it("does not create drag operations for keyboard moving grabs", () => {
    const window = createMockWindow();
    const globals = installGnomeGlobals();
    window._workspace = globals.workspaces[0];
    const shadow = new TilingShadow(createMockSettings() as never);
    shadow.bootstrap([window], () => true);

    shadow.observeGrabBegin(window, Meta.GrabOp.KEYBOARD_MOVING);
    shadow.observeGrabMoveUpdate(window, [100, 100], true);

    expect(shadow.inspect().operations).toEqual([]);
    globals.cleanup();
  });

  it("clears and can recreate a drag preview as modifier eligibility changes", () => {
    const first = createMockWindow({ rect: { x: 0, y: 0, width: 960, height: 1080 } });
    const second = createMockWindow({ rect: { x: 960, y: 0, width: 960, height: 1080 } });
    const globals = installGnomeGlobals();
    first._workspace = globals.workspaces[0];
    second._workspace = globals.workspaces[0];
    const shadow = new TilingShadow(createMockSettings() as never);
    shadow.bootstrap([first, second], () => true);

    shadow.observeGrabBegin(first, Meta.GrabOp.MOVING);
    shadow.observeGrabMoveUpdate(first, [1440, 540], true);
    expect(shadow.inspect().renderPlan.previews).toHaveLength(1);

    shadow.observeGrabMoveUpdate(first, [1440, 540], false);
    expect(shadow.inspect()).toMatchObject({ operations: [], renderPlan: { previews: [] } });

    shadow.observeGrabMoveUpdate(first, [1440, 540], true);
    expect(shadow.inspect().operations).toEqual([
      expect.objectContaining({ id: "operation:2", kind: "drag" }),
    ]);
    expect(shadow.inspect().renderPlan.previews).toHaveLength(1);
    globals.cleanup();
  });

  it("clears a previous drag target when the pointer leaves every Surface", () => {
    const first = createMockWindow({ rect: { x: 0, y: 0, width: 960, height: 1080 } });
    const second = createMockWindow({ rect: { x: 960, y: 0, width: 960, height: 1080 } });
    const globals = installGnomeGlobals();
    first._workspace = globals.workspaces[0];
    second._workspace = globals.workspaces[0];
    const shadow = new TilingShadow(createMockSettings() as never);
    shadow.bootstrap([first, second], () => true);
    const [firstId, secondId] = shadow.inspect().windows.map((window) => window.id);

    shadow.observeGrabBegin(first, Meta.GrabOp.MOVING);
    shadow.observeGrabMoveUpdate(first, [1440, 540], true);
    shadow.observeGrabMoveUpdate(first, [5000, 5000], true);
    shadow.observeGrabEnd(first, false, true);

    expect(shadow.inspect()).toMatchObject({
      operations: [],
      containers: [{ childIds: [firstId, secondId] }],
      renderPlan: { previews: [] },
    });
    globals.cleanup();
  });

  it("cancels an active operation when any compositor grab supersedes it", () => {
    const first = createMockWindow({ rect: { x: 0, y: 0, width: 960, height: 1080 } });
    const second = createMockWindow({ rect: { x: 960, y: 0, width: 960, height: 1080 } });
    const unknown = createMockWindow();
    const globals = installGnomeGlobals();
    first._workspace = globals.workspaces[0];
    second._workspace = globals.workspaces[0];
    unknown._workspace = globals.workspaces[0];
    const shadow = new TilingShadow(createMockSettings() as never);
    shadow.bootstrap([first, second], () => true);

    shadow.observeGrabBegin(first, Meta.GrabOp.RESIZING_E);
    shadow.observeGrabBegin(unknown, Meta.GrabOp.MOVING);

    expect(shadow.inspect().operations).toEqual([]);
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
        boundaries: [expect.objectContaining({ neighborWindowId: firstId, direction: "left" })],
      }),
    ]);
    globals.cleanup();
  });

  it("scales a leaf frame delta to its ancestor resize boundary", () => {
    const first = createMockWindow({ rect: { x: 0, y: 0, width: 250, height: 1080 } });
    const second = createMockWindow({ rect: { x: 500, y: 0, width: 500, height: 1080 } });
    const third = createMockWindow({ rect: { x: 250, y: 0, width: 250, height: 1080 } });
    const globals = installGnomeGlobals({ display: { getFocusWindow: () => first } });
    first._workspace = globals.workspaces[0];
    second._workspace = globals.workspaces[0];
    third._workspace = globals.workspaces[0];
    const shadow = new TilingShadow(createMockSettings() as never);
    shadow.bootstrap([first, second], () => true);
    shadow.observeCommand({ name: "Split", orientation: "horizontal" }, first);
    shadow.observeWindow(third);
    const [, secondId, thirdId] = shadow.inspect().windows.map((window) => window.id);

    shadow.observeGrabBegin(third, Meta.GrabOp.RESIZING_E);
    expect(shadow.inspect().operations).toEqual([
      expect.objectContaining({
        windowId: thirdId,
        boundaries: [
          expect.objectContaining({
            containerId: "container:1",
            primaryChildId: "container:2",
            neighborChildId: secondId,
          }),
        ],
      }),
    ]);

    third._rect.width = 300;
    shadow.observeGrabUpdate(third);
    const active = shadow.inspect().operations[0];
    expect(active.kind).toBe("resize");
    if (active.kind !== "resize") throw new Error("expected resize operation");
    expect(active.boundaries[0].overlayWeights).toEqual({
      "container:2": 0.6,
      [secondId]: 0.4,
    });
    globals.cleanup();
  });

  it("translates a diagonal grab into one two-axis portable operation", () => {
    const first = createMockWindow({ rect: { x: 0, y: 0, width: 960, height: 540 } });
    const second = createMockWindow({ rect: { x: 960, y: 0, width: 960, height: 1080 } });
    const third = createMockWindow({ rect: { x: 0, y: 540, width: 960, height: 540 } });
    const globals = installGnomeGlobals({ display: { getFocusWindow: () => first } });
    first._workspace = globals.workspaces[0];
    second._workspace = globals.workspaces[0];
    third._workspace = globals.workspaces[0];
    const shadow = new TilingShadow(createMockSettings() as never);
    shadow.bootstrap([first, second], () => true);
    shadow.observeCommand({ name: "Split", orientation: "vertical" }, first);
    shadow.observeWindow(third);
    const [firstId, secondId, thirdId] = shadow.inspect().windows.map((window) => window.id);

    shadow.observeGrabBegin(first, Meta.GrabOp.RESIZING_SE);
    expect(shadow.inspect().operations).toEqual([
      expect.objectContaining({
        id: "operation:1",
        windowId: firstId,
        boundaries: expect.arrayContaining([
          expect.objectContaining({
            direction: "right",
            containerId: "container:1",
            primaryChildId: "container:2",
            neighborChildId: secondId,
          }),
          expect.objectContaining({
            direction: "down",
            containerId: "container:2",
            primaryChildId: firstId,
            neighborChildId: thirdId,
          }),
        ]),
      }),
    ]);

    first._rect.width = 1152;
    first._rect.height = 648;
    shadow.observeGrabUpdate(first);
    const active = shadow.inspect().operations[0];
    expect(active.kind).toBe("resize");
    if (active.kind !== "resize") throw new Error("expected resize operation");
    const boundaries = active.boundaries;
    expect(boundaries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          containerId: "container:1",
          overlayWeights: { "container:2": 0.6, [secondId]: 0.4 },
        }),
        expect.objectContaining({
          containerId: "container:2",
          overlayWeights: { [firstId]: 0.6, [thirdId]: 0.4 },
        }),
      ])
    );
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

  it("samples live GNOME frames at the settled comparison boundary", () => {
    const window = createMockWindow({ rect: { x: 10, y: 20, width: 300, height: 200 } });
    const globals = installGnomeGlobals();
    window._workspace = globals.workspaces[0];
    const shadow = new TilingShadow(createMockSettings() as never);
    shadow.bootstrap([window], () => true);
    const expected = shadow.inspect().renderPlan.windows[0].frame;

    window._rect.x = expected.x;
    window._rect.y = expected.y;
    window._rect.width = expected.width;
    window._rect.height = expected.height;

    expect(shadow.inspect().windows[0].frame).not.toEqual(expected);
    expect(shadow.compareObservedGeometry().mismatches).toEqual([]);
    globals.cleanup();
  });
});
