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
        }

        inspection = {
          ...inspection,
          revision,
          surfaces,
          containers,
          renderPlan: {
            revision,
            surfaces: surfaces.map((surface) => ({
              id: surface.id,
              workArea: copyRect(surface.workArea),
            })),
            windows: [],
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
        return { status: "committed", revision, intentions: [], diagnostics: [] };
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
