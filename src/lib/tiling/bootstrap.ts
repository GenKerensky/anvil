import type {
  ContainerId,
  ContainerInspection,
  SurfaceInspection,
  TilingEvent,
  TilingInspection,
  TilingIntention,
  TilingTransition,
  WindowInspection,
} from "./contracts.js";
import { copyRect, deriveContainerPlans, deriveWindowPlans } from "./geometry.js";
import { changedContainerIntentions } from "./intentions.js";
import { normalizeSelections, tilingSurfaceIds } from "./transition-helpers.js";
import { validateSurfaces } from "./validation.js";
import { inspectWindowFact } from "./window-facts.js";

type SnapshotEvent = Extract<TilingEvent, { type: "PlatformSnapshotObserved" }>;

export function applyBootstrap(
  inspection: TilingInspection,
  event: SnapshotEvent,
  currentNextContainer: number,
  commitNextContainer: (nextContainer: number) => void,
  commitCandidate: (candidate: TilingInspection) => void
): TilingTransition {
  if (inspection.revision !== 0) {
    return {
      status: "rejected",
      revision: inspection.revision,
      intentions: [],
      diagnostics: [
        {
          code: "already-bootstrapped",
          message: "PlatformSnapshotObserved is valid only for initial bootstrap",
        },
      ],
    };
  }
  const invalid = validateSurfaces(event.snapshot.surfaces);
  if (invalid) {
    return {
      status: "rejected",
      revision: inspection.revision,
      intentions: [],
      diagnostics: [{ code: "invalid-surface", message: invalid }],
    };
  }

  const revision = inspection.revision + 1;
  let candidateNextContainer = currentNextContainer;
  const surfaces: SurfaceInspection[] = [];
  const containers: ContainerInspection[] = [];
  const surfaceRoots = new Map<string, ContainerId>();
  for (const surface of [...event.snapshot.surfaces].sort((a, b) => a.id.localeCompare(b.id))) {
    const rootId = `container:${candidateNextContainer++}` as ContainerId;
    surfaces.push({
      id: surface.id,
      workArea: copyRect(surface.workArea),
      rootId,
      neighbors: { ...surface.neighbors },
      capabilities: { ...surface.capabilities },
    });
    containers.push({
      id: rootId,
      surfaceId: surface.id,
      layout: inspection.policy.defaultLayout,
      childIds: [],
      weights: {},
    });
    surfaceRoots.set(surface.id, rootId);
  }

  const surfaceIds = tilingSurfaceIds(surfaces);
  const windows: WindowInspection[] = event.snapshot.windows.map((window) => {
    const classifiedWindow = inspectWindowFact(window, inspection.policy, surfaceIds);
    const parentId = classifiedWindow.participating
      ? surfaceRoots.get(window.surfaceId)
      : undefined;
    if (parentId) {
      const parentIndex = containers.findIndex((container) => container.id === parentId);
      const parent = containers[parentIndex];
      containers[parentIndex] = { ...parent, childIds: [...parent.childIds, window.id] };
    }
    return {
      ...classifiedWindow,
      ...(parentId ? { parentId } : {}),
    };
  });
  windows.sort((left, right) => left.id.localeCompare(right.id));

  const focusedWindowId = windows.some((window) => window.id === event.snapshot.focusedWindowId)
    ? event.snapshot.focusedWindowId
    : undefined;
  if (focusedWindowId) {
    const focused = windows.find((window) => window.id === focusedWindowId);
    if (focused?.participating && focused.parentId) {
      const parentIndex = containers.findIndex((container) => container.id === focused.parentId);
      if (parentIndex >= 0) {
        containers[parentIndex] = {
          ...containers[parentIndex],
          selectedChildId: focusedWindowId,
        };
      }
    }
  }

  const normalizedContainers = normalizeSelections(containers, windows);
  const windowPlans = deriveWindowPlans(surfaces, windows, normalizedContainers, inspection.policy);
  const intentions: TilingIntention[] = [
    ...windows
      .filter((window) => window.participating)
      .map((window) => ({
        type: "WindowParticipationChanged" as const,
        revision,
        ordinal: 0,
        windowId: window.id,
        participating: true,
      })),
    ...windowPlans.map((window) => ({
      type: "PlaceWindow" as const,
      revision,
      ordinal: 0,
      windowId: window.id,
      surfaceId: window.surfaceId,
      frame: copyRect(window.frame),
    })),
  ].map((intention, ordinal) => ({ ...intention, ordinal }));
  const containerPlans = deriveContainerPlans(
    surfaces,
    windows,
    normalizedContainers,
    inspection.policy
  );
  intentions.push(...changedContainerIntentions([], containerPlans, revision, intentions.length));

  commitCandidate({
    ...inspection,
    revision,
    focusedWindowId,
    surfaces,
    windows,
    containers: normalizedContainers,
    renderPlan: {
      revision,
      surfaces: surfaces.map((surface) => ({
        id: surface.id,
        workArea: copyRect(surface.workArea),
      })),
      windows: windowPlans,
      containers: containerPlans,
      previews: [],
    },
  });
  commitNextContainer(candidateNextContainer);
  return { status: "committed", revision, intentions, diagnostics: [] };
}
