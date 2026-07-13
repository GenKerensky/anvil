import type {
  ContainerInspection,
  SurfaceInspection,
  TilingInspection,
  TilingPolicy,
} from "./contracts.js";
import { copyRect } from "./geometry.js";

export function copySurface(surface: SurfaceInspection): SurfaceInspection {
  return {
    ...surface,
    workArea: copyRect(surface.workArea),
    neighbors: { ...surface.neighbors },
    capabilities: { ...surface.capabilities },
  };
}

export function copyContainer(container: ContainerInspection): ContainerInspection {
  return {
    ...container,
    childIds: [...container.childIds],
    weights: { ...container.weights },
  };
}

export function copyPolicy(policy: TilingPolicy): TilingPolicy {
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

export function copyInspection(inspection: TilingInspection): TilingInspection {
  return {
    ...inspection,
    policy: copyPolicy(inspection.policy),
    surfaces: inspection.surfaces.map(copySurface),
    windows: inspection.windows.map((window) => ({
      ...window,
      frame: copyRect(window.frame),
      capabilities: { ...window.capabilities },
      tags: [...window.tags],
    })),
    containers: inspection.containers.map(copyContainer),
    operations: inspection.operations.map((operation) => ({
      ...operation,
      affectedWindowIds: [...operation.affectedWindowIds],
      affectedContainerIds: [...operation.affectedContainerIds],
      baseWeights: { ...operation.baseWeights },
      overlayWeights: { ...operation.overlayWeights },
    })),
    placementHints: inspection.placementHints.map((hint) => ({ ...hint })),
    evacuationHints: inspection.evacuationHints.map((hint) => ({
      ...hint,
      windowIds: [...hint.windowIds],
      containers: hint.containers.map(copyContainer),
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
}
