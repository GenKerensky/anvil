import Gio from "gi://Gio";
import Meta from "gi://Meta";

import type { WindowOverride } from "../shared/settings.js";
import { GnomeGrabOperationAdapter } from "./gnome-grab-operation-adapter.js";
import type { AnvilAction } from "./window/actions.js";

import {
  createTilingStateMachine,
  operationId,
  surfaceId,
  windowId,
  type Direction,
  type Layout,
  type OperationId,
  type PlatformSnapshot,
  type ParticipationRule,
  type SurfaceFact,
  type SurfaceConstraint,
  type SurfaceId,
  type TilingDiagnostic,
  type TilingEvent,
  type TilingInspection,
  type TilingCommand,
  type TilingPolicy,
  type TilingStateMachine,
  type TilingTransition,
  type WindowFact,
  type WindowId,
} from "../tiling/index.js";

type WindowCapabilities = Meta.Window & {
  allows_move?: () => boolean;
  allows_resize?: () => boolean;
  get_role?: () => string | null;
};

export function createPortableParticipationRules(
  overrides: readonly WindowOverride[]
): ParticipationRule[] {
  const persistent = overrides.filter(
    (override) => !override.wmId && (override.mode === "tile" || override.mode === "float")
  );
  const overrideRules = (action: "tile" | "float") =>
    persistent
      .filter((override) => override.mode === action)
      .map((override, index) => ({
        id: `override:${action}:${index}`,
        action,
        ...(override.wmClass ? { applicationId: override.wmClass } : {}),
        ...(override.wmTitle ? { title: override.wmTitle } : {}),
      }));
  return [
    ...overrideRules("tile"),
    { id: "builtin:pip", action: "float", title: "picture-in-picture" },
    { id: "builtin:blender", action: "float", applicationId: "~blender" },
    { id: "builtin:steam", action: "float", applicationId: "~steam" },
    { id: "builtin:dialog", action: "float", tags: ["dialog"] },
    { id: "builtin:transient", action: "float", transient: true },
    { id: "builtin:fixed-size", action: "float", resizable: false },
    ...overrideRules("float"),
  ];
}

function booleanSetting(settings: Gio.Settings, key: string, fallback: boolean): boolean {
  try {
    return settings.get_boolean(key);
  } catch {
    return fallback;
  }
}

function uintSetting(settings: Gio.Settings, key: string, fallback: number): number {
  try {
    return settings.get_uint(key);
  } catch {
    return fallback;
  }
}

function stringSetting(settings: Gio.Settings, key: string, fallback: string): string {
  try {
    return settings.get_string(key);
  } catch {
    return fallback;
  }
}

export class GnomeTilingIdentityRegistry {
  private nextWindow = 1;
  private nextSurface = 1;
  private nextOperation = 1;
  private readonly windows = new WeakMap<Meta.Window, WindowId>();
  private readonly surfaces = new WeakMap<Meta.Workspace, Map<string, SurfaceId>>();

  window(metaWindow: Meta.Window): WindowId {
    const existing = this.windows.get(metaWindow);
    if (existing) return existing;
    const id = windowId(`window:${this.nextWindow++}`);
    this.windows.set(metaWindow, id);
    return id;
  }

  knownWindow(metaWindow: Meta.Window): WindowId | undefined {
    return this.windows.get(metaWindow);
  }

  surface(workspace: Meta.Workspace, outputKey: string): SurfaceId {
    let outputs = this.surfaces.get(workspace);
    if (!outputs) {
      outputs = new Map();
      this.surfaces.set(workspace, outputs);
    }
    const existing = outputs.get(outputKey);
    if (existing) return existing;
    const id = surfaceId(`surface:${this.nextSurface++}`);
    outputs.set(outputKey, id);
    return id;
  }

  operation(): OperationId {
    return operationId(`operation:${this.nextOperation++}`);
  }
}

export class TilingShadow {
  private readonly settings: Gio.Settings;
  private readonly identities = new GnomeTilingIdentityRegistry();
  private machine: TilingStateMachine;
  private activeSurfaces = new Set<SurfaceId>();
  private bootstrapped = false;
  private pendingEvents: TilingEvent[] = [];
  private readonly grabOperations: GnomeGrabOperationAdapter;
  private rejectedEvents: Array<
    Readonly<{
      eventType: TilingEvent["type"];
      revision: number;
      diagnostics: readonly TilingDiagnostic[];
    }>
  > = [];
  private readonly windowOverrides: () => readonly WindowOverride[];

  constructor(settings: Gio.Settings, windowOverrides: () => readonly WindowOverride[] = () => []) {
    this.settings = settings;
    this.windowOverrides = windowOverrides;
    this.machine = createTilingStateMachine(this.policy());
    this.grabOperations = new GnomeGrabOperationAdapter({
      knownWindowId: (metaWindow) => this.identities.knownWindow(metaWindow),
      windowFact: (metaWindow) => this.windowFact(metaWindow),
      allocateOperationId: () => this.identities.operation(),
      dispatch: (event) => this.dispatch(event),
      inspect: () => this.machine.inspect(),
    });
  }

  private policy(): TilingPolicy {
    const gap =
      uintSetting(this.settings, "window-gap-size", 0) *
      uintSetting(this.settings, "window-gap-size-increment", 1);
    const allowedLayouts: Layout[] = ["horizontal", "vertical"];
    if (booleanSetting(this.settings, "stacked-tiling-mode-enabled", true)) {
      allowedLayouts.push("stacked");
    }
    if (booleanSetting(this.settings, "tabbed-tiling-mode-enabled", true)) {
      allowedLayouts.push("tabbed");
    }
    const skippedWorkspaces = new Set(
      stringSetting(this.settings, "workspace-skip-tile", "")
        .split(",")
        .map((item) => Number.parseInt(item, 10))
        .filter(Number.isFinite)
    );
    const surfaceTiling: Record<string, boolean> = {};
    const constraints: Record<string, SurfaceConstraint> = {};
    let rawConstraints: Array<[string, number, number, boolean, boolean]> = [];
    try {
      rawConstraints = this.settings
        .get_value("monitor-constraints")
        .deep_unpack() as typeof rawConstraints;
    } catch {
      rawConstraints = [];
    }
    const constraintsByOutput = new Map(
      rawConstraints
        .filter(([, , , enabled]) => enabled)
        .map(([output, maxWidth, maxHeight, , resizeExempt]) => [
          output,
          { maxWidth, maxHeight, resizeExempt },
        ])
    );
    let defaultLayout: Layout = "horizontal";
    try {
      const geometry = global.display.get_monitor_geometry(global.display.get_current_monitor());
      defaultLayout = geometry.width < geometry.height ? "vertical" : "horizontal";
    } catch {
      // The adapter can start before monitor geometry is available. Match the
      // legacy landscape fallback until a later policy observation refreshes it.
    }
    const workspaceManager = global.workspace_manager;
    for (
      let workspaceIndex = 0;
      workspaceIndex < workspaceManager.get_n_workspaces();
      workspaceIndex += 1
    ) {
      const workspace = workspaceManager.get_workspace_by_index(workspaceIndex);
      if (!workspace) continue;
      for (let monitor = 0; monitor < global.display.get_n_monitors(); monitor += 1) {
        const id = this.surfaceIdentity(workspace, monitor);
        surfaceTiling[id] = !skippedWorkspaces.has(workspaceIndex);
        const constraint = constraintsByOutput.get(this.outputKey(monitor));
        if (constraint) constraints[id] = constraint;
      }
    }
    return {
      enabled: booleanSetting(this.settings, "tiling-mode-enabled", true),
      surfaceTiling,
      allowedLayouts,
      defaultLayout,
      gap,
      hideGapWhenSingle: booleanSetting(this.settings, "window-gap-hidden-on-single", false),
      autoSplit: booleanSetting(this.settings, "auto-split-enabled", false),
      singleTabExit: booleanSetting(this.settings, "auto-exit-tabbed", true) ? "split" : "preserve",
      headerExtent: booleanSetting(this.settings, "showtab-decoration-enabled", true) ? 35 : 0,
      constraints,
      participationRules: createPortableParticipationRules(this.windowOverrides()),
      reconcileAttempts: 3,
    };
  }

  private outputKey(monitor: number): string {
    try {
      const manager = global.backend.get_monitor_manager();
      const logicalMonitor = manager.get_logical_monitors()?.[monitor];
      return logicalMonitor?.get_monitors()?.[0]?.get_connector() ?? `output:${monitor}`;
    } catch {
      return `output:${monitor}`;
    }
  }

  private surfaceIdentity(workspace: Meta.Workspace, monitor: number): SurfaceId {
    return this.identities.surface(workspace, this.outputKey(monitor));
  }

  private surfaceFact(workspace: Meta.Workspace, monitor: number): SurfaceFact {
    const workArea = workspace.get_work_area_for_monitor(monitor);
    const neighbors: Partial<Record<Direction, SurfaceId>> = {};
    const directions: ReadonlyArray<readonly [Direction, Meta.DisplayDirection]> = [
      ["left", Meta.DisplayDirection.LEFT],
      ["right", Meta.DisplayDirection.RIGHT],
      ["up", Meta.DisplayDirection.UP],
      ["down", Meta.DisplayDirection.DOWN],
    ];
    for (const [direction, nativeDirection] of directions) {
      const neighbor = global.display.get_monitor_neighbor_index(monitor, nativeDirection);
      if (neighbor >= 0) neighbors[direction] = this.surfaceIdentity(workspace, neighbor);
    }
    return {
      id: this.surfaceIdentity(workspace, monitor),
      workArea: { x: 0, y: 0, width: workArea.width, height: workArea.height },
      neighbors,
      capabilities: { focus: true, raise: true, move: true, resize: true },
    };
  }

  private surfaceFacts(): SurfaceFact[] {
    const surfaces: SurfaceFact[] = [];
    const workspaceManager = global.workspace_manager;
    for (
      let workspaceIndex = 0;
      workspaceIndex < workspaceManager.get_n_workspaces();
      workspaceIndex += 1
    ) {
      const workspace = workspaceManager.get_workspace_by_index(workspaceIndex);
      if (!workspace) continue;
      for (let monitor = 0; monitor < global.display.get_n_monitors(); monitor += 1) {
        surfaces.push(this.surfaceFact(workspace, monitor));
      }
    }
    return surfaces;
  }

  private windowFact(metaWindow: Meta.Window): WindowFact | null {
    const workspace = metaWindow.get_workspace();
    if (!workspace) return null;
    const monitor = metaWindow.get_monitor();
    const workArea = workspace.get_work_area_for_monitor(monitor);
    const frame = metaWindow.get_frame_rect();
    const native = metaWindow as WindowCapabilities;
    const transientParent = metaWindow.get_transient_for();
    const windowType = metaWindow.get_window_type();
    const tags =
      windowType === Meta.WindowType.DIALOG || windowType === Meta.WindowType.MODAL_DIALOG
        ? ["dialog"]
        : [];
    return {
      id: this.identities.window(metaWindow),
      surfaceId: this.surfaceIdentity(workspace, monitor),
      frame: {
        x: frame.x - workArea.x,
        y: frame.y - workArea.y,
        width: frame.width,
        height: frame.height,
      },
      available: !metaWindow.minimized && !metaWindow.fullscreen,
      capabilities: {
        focus: true,
        raise: true,
        move: native.allows_move?.() ?? true,
        resize: native.allows_resize?.() ?? true,
      },
      applicationId: metaWindow.get_wm_class() ?? undefined,
      title: metaWindow.get_title() ?? undefined,
      role: native.get_role?.() ?? undefined,
      transientParentId: transientParent ? this.identities.window(transientParent) : undefined,
      resizable: native.allows_resize?.() ?? true,
      tags,
    };
  }

  private submit(event: TilingEvent): TilingTransition | undefined {
    if (!this.bootstrapped) {
      this.pendingEvents.push(event);
      return undefined;
    }
    return this.dispatch(event);
  }

  private dispatch(event: TilingEvent): TilingTransition {
    const transition = this.machine.dispatch(event);
    if (transition.status === "rejected") {
      this.rejectedEvents.push({
        eventType: event.type,
        revision: transition.revision,
        diagnostics: transition.diagnostics,
      });
      if (this.rejectedEvents.length > 20) this.rejectedEvents.shift();
    }
    return transition;
  }

  bootstrap(windows: readonly Meta.Window[], validWindow: (window: Meta.Window) => boolean): void {
    this.machine = createTilingStateMachine(this.policy());
    this.rejectedEvents = [];
    this.grabOperations.reset();
    const surfaces = this.surfaceFacts();
    this.activeSurfaces = new Set(surfaces.map((surface) => surface.id));
    const observedWindows = windows
      .filter(validWindow)
      .map((window) => this.windowFact(window))
      .filter((window): window is WindowFact => window !== null);
    const focusedWindow = global.display.get_focus_window();
    const focusedWindowId = focusedWindow ? this.identities.knownWindow(focusedWindow) : undefined;
    const snapshot: PlatformSnapshot = {
      surfaces,
      windows: observedWindows,
      ...(focusedWindowId ? { focusedWindowId } : {}),
    };
    const transition = this.dispatch({ type: "PlatformSnapshotObserved", snapshot });
    if (transition.status !== "committed") {
      throw new Error(`portable tiling bootstrap ${transition.status}`);
    }
    this.bootstrapped = true;
    const pending = this.pendingEvents;
    this.pendingEvents = [];
    for (const event of pending) this.dispatch(event);
  }

  observeWindow(metaWindow: Meta.Window): void {
    const window = this.windowFact(metaWindow);
    if (!window) return;
    this.submit({
      type: "FactsObserved",
      facts: [{ type: "WindowObserved", window }],
    });
  }

  observeFrame(metaWindow: Meta.Window): void {
    const fact = this.windowFact(metaWindow);
    if (!fact) return;
    this.submit({
      type: "FactsObserved",
      facts: [{ type: "FrameObserved", windowId: fact.id, frame: fact.frame }],
    });
  }

  observeFocus(metaWindow: Meta.Window | null): void {
    const focusedWindowId = metaWindow ? this.identities.knownWindow(metaWindow) : undefined;
    this.submit({
      type: "FactsObserved",
      facts: [{ type: "FocusObserved", windowId: focusedWindowId }],
    });
  }

  observePolicy(): void {
    this.submit({ type: "PolicyReplaced", policy: this.policy() });
  }

  observeTopology(): void {
    const surfaces = this.surfaceFacts();
    const nextSurfaces = new Set(surfaces.map((surface) => surface.id));
    const transition = this.submit({
      type: "FactsObserved",
      facts: [
        ...surfaces.map((surface) => ({ type: "SurfaceObserved" as const, surface })),
        ...[...this.activeSurfaces]
          .filter((surfaceId) => !nextSurfaces.has(surfaceId))
          .map((surfaceId) => ({ type: "SurfaceWithdrawn" as const, surfaceId })),
      ],
    });
    if (this.bootstrapped && transition?.status !== "rejected") {
      this.activeSurfaces = nextSurfaces;
    }
    this.observePolicy();
  }

  observeCommand(action: AnvilAction, focusedWindow: Meta.Window | null): void {
    if (!focusedWindow) return;
    const focusedWindowId = this.identities.knownWindow(focusedWindow);
    if (!focusedWindowId) return;
    const direction =
      "direction" in action
        ? (
            {
              left: "left",
              right: "right",
              up: "up",
              down: "down",
              top: "up",
              bottom: "down",
            } as const
          )[action.direction.toLowerCase()]
        : undefined;
    let command: TilingCommand | undefined;
    if (direction && action.name === "Focus") {
      command = { type: "FocusDirection", windowId: focusedWindowId, direction };
    } else if (direction && action.name === "Move") {
      command = { type: "MoveDirection", windowId: focusedWindowId, direction };
    } else if (direction && action.name === "Swap") {
      command = { type: "SwapDirection", windowId: focusedWindowId, direction };
    } else if (
      action.name === "FloatToggle" ||
      action.name === "FloatClassToggle" ||
      action.name === "FloatNonPersistentToggle"
    ) {
      const window = this.machine.inspect().windows.find((item) => item.id === focusedWindowId);
      if (window) {
        command = {
          type: "SetParticipation",
          windowId: focusedWindowId,
          participating: !window.participating,
        };
      }
    } else if (
      action.name === "Split" ||
      action.name === "LayoutToggle" ||
      action.name === "LayoutStackedToggle" ||
      action.name === "LayoutTabbedToggle"
    ) {
      const inspection = this.machine.inspect();
      const window = inspection.windows.find((item) => item.id === focusedWindowId);
      const container = inspection.containers.find((item) => item.id === window?.parentId);
      if (!container) return;
      let layout: Layout;
      if (action.name === "LayoutStackedToggle") {
        layout = container.layout === "stacked" ? "horizontal" : "stacked";
      } else if (action.name === "LayoutTabbedToggle") {
        layout = container.layout === "tabbed" ? "horizontal" : "tabbed";
      } else if (action.name === "Split" && action.orientation) {
        layout = action.orientation.toLowerCase().startsWith("v") ? "vertical" : "horizontal";
      } else {
        layout = container.layout === "horizontal" ? "vertical" : "horizontal";
      }
      command = { type: "SetLayout", windowId: focusedWindowId, layout };
    }
    if (command) this.submit({ type: "CommandRequested", command });
  }

  observeGrabBegin(metaWindow: Meta.Window, grabOp: Meta.GrabOp): void {
    if (!this.bootstrapped) return;
    this.grabOperations.beginResize(metaWindow, grabOp);
  }

  observeGrabUpdate(metaWindow: Meta.Window): void {
    this.grabOperations.updateResize(metaWindow);
  }

  observeGrabEnd(metaWindow: Meta.Window, cancelled: boolean): void {
    this.grabOperations.endResize(metaWindow, cancelled);
  }

  withdrawWindow(metaWindow: Meta.Window): void {
    const knownWindow = this.identities.knownWindow(metaWindow);
    if (!knownWindow) return;
    this.grabOperations.withdrawWindow(metaWindow);
    this.submit({
      type: "FactsObserved",
      facts: [{ type: "WindowWithdrawn", windowId: knownWindow }],
    });
  }

  compareObservedGeometry(): Readonly<{
    mismatchCount: number;
    mismatches: readonly Readonly<{
      windowId: WindowId;
      expected: WindowFact["frame"];
      observed: WindowFact["frame"];
    }>[];
    rejectedEventCount: number;
    rejectedEvents: readonly Readonly<{
      eventType: TilingEvent["type"];
      revision: number;
      diagnostics: readonly TilingDiagnostic[];
    }>[];
  }> {
    const inspection = this.machine.inspect();
    const mismatches = inspection.renderPlan.windows.flatMap((plan) => {
      const observed = inspection.windows.find((window) => window.id === plan.id);
      if (!observed || JSON.stringify(observed.frame) === JSON.stringify(plan.frame)) return [];
      return [{ windowId: plan.id, expected: plan.frame, observed: observed.frame }];
    });
    return {
      mismatchCount: mismatches.length,
      mismatches,
      rejectedEventCount: this.rejectedEvents.length,
      rejectedEvents: this.rejectedEvents.map((event) => ({
        ...event,
        diagnostics: event.diagnostics.map((diagnostic) => ({ ...diagnostic })),
      })),
    };
  }

  inspect(): TilingInspection {
    return this.machine.inspect();
  }
}
