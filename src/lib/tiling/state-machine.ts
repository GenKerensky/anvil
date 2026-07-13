import type {
  ContainerId,
  ContainerInspection,
  SurfaceFact,
  SurfaceInspection,
  TilingEvent,
  TilingInspection,
  TilingPolicy,
  TilingStateMachine,
  TilingTransition,
  WindowFact,
  WindowInspection,
  WindowPlan,
} from "./contracts.js";

function copyRect(rect: Readonly<{ x: number; y: number; width: number; height: number }>) {
  return { ...rect };
}

function copySurface(surface: SurfaceInspection): SurfaceInspection {
  return {
    ...surface,
    workArea: copyRect(surface.workArea),
    neighbors: { ...surface.neighbors },
  };
}

function copyContainer(container: ContainerInspection): ContainerInspection {
  return {
    ...container,
    childIds: [...container.childIds],
    weights: { ...container.weights },
  };
}

function validRect(
  rect: Readonly<{ x: number; y: number; width: number; height: number }>
): boolean {
  return (
    Number.isFinite(rect.x) &&
    Number.isFinite(rect.y) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height) &&
    rect.width > 0 &&
    rect.height > 0
  );
}

function validateSurfaces(surfaces: readonly SurfaceFact[]): string | null {
  const ids = new Set<string>();
  for (const surface of surfaces) {
    if (ids.has(surface.id)) return `Duplicate Surface identity: ${surface.id}`;
    if (!validRect(surface.workArea)) return `Invalid Surface work area: ${surface.id}`;
    ids.add(surface.id);
  }
  for (const surface of surfaces) {
    for (const neighbor of Object.values(surface.neighbors)) {
      if (neighbor === surface.id || !ids.has(neighbor)) {
        return `Invalid Surface neighbor on ${surface.id}`;
      }
    }
  }
  return null;
}

function shouldParticipate(
  window: WindowFact,
  policy: TilingPolicy,
  availableSurfaces: ReadonlySet<string>
): boolean {
  if (!policy.enabled || !availableSurfaces.has(window.surfaceId)) return false;
  return policy.surfaceTiling[window.surfaceId] !== false;
}

function inset(
  rect: Readonly<{ x: number; y: number; width: number; height: number }>,
  gap: number
) {
  if (gap <= 0 || rect.width <= gap * 2 || rect.height <= gap * 2) return copyRect(rect);
  return {
    x: rect.x + gap,
    y: rect.y + gap,
    width: rect.width - gap * 2,
    height: rect.height - gap * 2,
  };
}

function splitFrames(
  workArea: Readonly<{ x: number; y: number; width: number; height: number }>,
  windows: readonly WindowInspection[],
  layout: TilingPolicy["defaultLayout"],
  gap: number
): WindowPlan[] {
  const available = windows.filter((window) => window.available);
  if (available.length === 0) return [];
  if (layout === "stacked" || layout === "tabbed") {
    return available.map((window) => ({
      id: window.id,
      surfaceId: window.surfaceId,
      frame: inset(workArea, gap),
    }));
  }
  const horizontal = layout === "horizontal";
  const total = horizontal ? workArea.width : workArea.height;
  const base = Math.floor(total / available.length);
  let cursor = horizontal ? workArea.x : workArea.y;
  return available.map((window, index) => {
    const size = index === available.length - 1 ? total - base * index : base;
    const frame = horizontal
      ? { x: cursor, y: workArea.y, width: size, height: workArea.height }
      : { x: workArea.x, y: cursor, width: workArea.width, height: size };
    cursor += size;
    return { id: window.id, surfaceId: window.surfaceId, frame: inset(frame, gap) };
  });
}

function copyPolicy(policy: TilingPolicy): TilingPolicy {
  return {
    ...policy,
    surfaceTiling: { ...policy.surfaceTiling },
    allowedLayouts: [...policy.allowedLayouts],
    constraints: Object.fromEntries(
      Object.entries(policy.constraints).map(([id, constraint]) => [id, { ...constraint }])
    ),
    participationRules: policy.participationRules.map((rule) => ({
      ...rule,
      tags: rule.tags ? [...rule.tags] : undefined,
    })),
  };
}

export function createTilingStateMachine(initialPolicy: TilingPolicy): TilingStateMachine {
  const policy = copyPolicy(initialPolicy);
  let nextContainer = 1;
  let inspection: TilingInspection = {
    schemaVersion: 1,
    revision: 0,
    policy,
    surfaces: [],
    windows: [],
    containers: [],
    operations: [],
    placementHints: [],
    evacuationHints: [],
    renderPlan: {
      revision: 0,
      surfaces: [],
      windows: [],
      containers: [],
      previews: [],
    },
    diagnostics: [],
  };

  return {
    dispatch(event: TilingEvent): TilingTransition {
      if (event.type === "PlatformSnapshotObserved") {
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
        const surfaces: SurfaceInspection[] = [];
        const containers: ContainerInspection[] = [];
        const surfaceRoots = new Map<string, ContainerId>();
        for (const surface of [...event.snapshot.surfaces].sort((a, b) =>
          a.id.localeCompare(b.id)
        )) {
          const rootId = `container:${nextContainer++}` as ContainerId;
          surfaces.push({
            id: surface.id,
            workArea: copyRect(surface.workArea),
            rootId,
            neighbors: { ...surface.neighbors },
          });
          containers.push({
            id: rootId,
            surfaceId: surface.id,
            layout: policy.defaultLayout,
            childIds: [],
            weights: {},
          });
          surfaceRoots.set(surface.id, rootId);
        }

        const surfaceIds = new Set(surfaces.map((surface) => surface.id));
        const windows: WindowInspection[] = [...event.snapshot.windows]
          .sort((a, b) => a.id.localeCompare(b.id))
          .map((window) => {
            const participating = shouldParticipate(window, policy, surfaceIds);
            const parentId = participating ? surfaceRoots.get(window.surfaceId) : undefined;
            if (parentId) {
              const parentIndex = containers.findIndex((container) => container.id === parentId);
              const parent = containers[parentIndex];
              containers[parentIndex] = { ...parent, childIds: [...parent.childIds, window.id] };
            }
            return {
              id: window.id,
              surfaceId: window.surfaceId,
              ...(parentId ? { parentId } : {}),
              participating,
              available: window.available,
              frame: copyRect(window.frame),
            };
          });

        const windowPlans = surfaces.flatMap((surface) => {
          const surfaceWindows = windows.filter(
            (window) => window.participating && window.surfaceId === surface.id
          );
          const gap =
            policy.hideGapWhenSingle &&
            surfaceWindows.filter((window) => window.available).length === 1
              ? 0
              : policy.gap;
          return splitFrames(surface.workArea, surfaceWindows, policy.defaultLayout, gap);
        });

        const intentions = [
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

        inspection = {
          ...inspection,
          revision,
          surfaces,
          windows,
          containers,
          renderPlan: {
            revision,
            surfaces: surfaces.map((surface) => ({
              id: surface.id,
              workArea: copyRect(surface.workArea),
            })),
            windows: windowPlans,
            containers: containers.map((container) => ({
              id: container.id,
              surfaceId: container.surfaceId,
              rect: copyRect(
                surfaces.find((surface) => surface.id === container.surfaceId)!.workArea
              ),
              layout: container.layout,
              stackingOrder: [],
            })),
            previews: [],
          },
        };
        return { status: "committed", revision, intentions, diagnostics: [] };
      }
      return {
        status: "ignored",
        revision: inspection.revision,
        intentions: [],
        diagnostics: [],
      };
    },
    inspect(): TilingInspection {
      return {
        ...inspection,
        policy: copyPolicy(inspection.policy),
        surfaces: inspection.surfaces.map(copySurface),
        windows: inspection.windows.map((window) => ({ ...window, frame: copyRect(window.frame) })),
        containers: inspection.containers.map(copyContainer),
        operations: inspection.operations.map((operation) => ({ ...operation })),
        placementHints: inspection.placementHints.map((hint) => ({ ...hint })),
        evacuationHints: inspection.evacuationHints.map((hint) => ({
          ...hint,
          windowIds: [...hint.windowIds],
        })),
        renderPlan: {
          ...inspection.renderPlan,
          surfaces: inspection.renderPlan.surfaces.map((surface) => ({
            ...surface,
            workArea: copyRect(surface.workArea),
          })),
          windows: inspection.renderPlan.windows.map((window) => ({
            ...window,
            frame: copyRect(window.frame),
          })),
          containers: inspection.renderPlan.containers.map((container) => ({
            ...container,
            rect: copyRect(container.rect),
            stackingOrder: [...container.stackingOrder],
          })),
          previews: inspection.renderPlan.previews.map((preview) => ({
            ...preview,
            rect: copyRect(preview.rect),
          })),
        },
        diagnostics: inspection.diagnostics.map((diagnostic) => ({ ...diagnostic })),
      };
    },
  };
}
