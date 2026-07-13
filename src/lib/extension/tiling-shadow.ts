import Gio from "gi://Gio";
import Meta from "gi://Meta";

import {
  createTilingStateMachine,
  surfaceId,
  windowId,
  type Direction,
  type Layout,
  type PlatformSnapshot,
  type SurfaceFact,
  type SurfaceId,
  type TilingInspection,
  type TilingPolicy,
  type TilingStateMachine,
  type WindowFact,
  type WindowId,
} from "../tiling/index.js";

type WindowCapabilities = Meta.Window & {
  allows_move?: () => boolean;
  allows_resize?: () => boolean;
  get_role?: () => string | null;
};

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

export class GnomeTilingIdentityRegistry {
  private nextWindow = 1;
  private nextSurface = 1;
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
}

export class TilingShadow {
  private readonly settings: Gio.Settings;
  private readonly identities = new GnomeTilingIdentityRegistry();
  private machine: TilingStateMachine;
  private activeSurfaces = new Set<SurfaceId>();

  constructor(settings: Gio.Settings) {
    this.settings = settings;
    this.machine = createTilingStateMachine(this.policy());
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
    return {
      enabled: booleanSetting(this.settings, "tiling-mode-enabled", true),
      surfaceTiling: {},
      allowedLayouts,
      defaultLayout: "horizontal",
      gap,
      hideGapWhenSingle: booleanSetting(this.settings, "window-gap-hidden-on-single", false),
      autoSplit: booleanSetting(this.settings, "auto-split-enabled", false),
      singleTabExit: booleanSetting(this.settings, "auto-exit-tabbed", true) ? "split" : "preserve",
      headerExtent: 0,
      constraints: {},
      participationRules: [],
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
    return {
      id: this.identities.window(metaWindow),
      surfaceId: this.surfaceIdentity(workspace, monitor),
      frame: {
        x: frame.x - workArea.x,
        y: frame.y - workArea.y,
        width: frame.width,
        height: frame.height,
      },
      available: !metaWindow.minimized,
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
    };
  }

  bootstrap(windows: readonly Meta.Window[], validWindow: (window: Meta.Window) => boolean): void {
    this.machine = createTilingStateMachine(this.policy());
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
    this.machine.dispatch({ type: "PlatformSnapshotObserved", snapshot });
  }

  observeWindow(metaWindow: Meta.Window): void {
    const window = this.windowFact(metaWindow);
    if (!window) return;
    this.machine.dispatch({
      type: "FactsObserved",
      facts: [{ type: "WindowObserved", window }],
    });
  }

  observeFrame(metaWindow: Meta.Window): void {
    const fact = this.windowFact(metaWindow);
    if (!fact) return;
    this.machine.dispatch({
      type: "FactsObserved",
      facts: [{ type: "FrameObserved", windowId: fact.id, frame: fact.frame }],
    });
  }

  observeFocus(metaWindow: Meta.Window | null): void {
    const focusedWindowId = metaWindow ? this.identities.knownWindow(metaWindow) : undefined;
    this.machine.dispatch({
      type: "FactsObserved",
      facts: [{ type: "FocusObserved", windowId: focusedWindowId }],
    });
  }

  observePolicy(): void {
    this.machine.dispatch({ type: "PolicyReplaced", policy: this.policy() });
  }

  observeTopology(): void {
    const surfaces = this.surfaceFacts();
    const nextSurfaces = new Set(surfaces.map((surface) => surface.id));
    this.machine.dispatch({
      type: "FactsObserved",
      facts: [
        ...surfaces.map((surface) => ({ type: "SurfaceObserved" as const, surface })),
        ...[...this.activeSurfaces]
          .filter((surfaceId) => !nextSurfaces.has(surfaceId))
          .map((surfaceId) => ({ type: "SurfaceWithdrawn" as const, surfaceId })),
      ],
    });
    this.activeSurfaces = nextSurfaces;
  }

  withdrawWindow(metaWindow: Meta.Window): void {
    this.machine.dispatch({
      type: "FactsObserved",
      facts: [{ type: "WindowWithdrawn", windowId: this.identities.window(metaWindow) }],
    });
  }

  inspect(): TilingInspection {
    return this.machine.inspect();
  }
}
