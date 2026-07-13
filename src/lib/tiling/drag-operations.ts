import type {
  ContainerId,
  DragCenterAction,
  DragOperationInspection,
  Layout,
  OperationId,
  Point,
  TilingEvent,
  TilingInspection,
  TilingTransition,
  WindowId,
} from "./contracts.js";
import { commitDragPlacement } from "./drag-commit.js";
import {
  dragPreviewRect,
  dragRegionAtPoint,
  dragTargetAtPoint,
  resolveDragPlacement,
  sameDragPlacement,
} from "./drag-hit-testing.js";

type DragEvent = Extract<
  TilingEvent,
  {
    type: "OperationStarted" | "OperationUpdated" | "OperationCommitted" | "OperationCancelled";
  }
>;

export type DragOperationResult = Readonly<{
  inspection: TilingInspection;
  transition: TilingTransition;
  nextContainer?: number;
}>;

function ignored(inspection: TilingInspection): DragOperationResult {
  return {
    inspection,
    transition: {
      status: "ignored",
      revision: inspection.revision,
      intentions: [],
      diagnostics: [],
    },
  };
}

function rejected(
  inspection: TilingInspection,
  code: string,
  message: string
): DragOperationResult {
  return {
    inspection,
    transition: {
      status: "rejected",
      revision: inspection.revision,
      intentions: [],
      diagnostics: [{ code, message }],
    },
  };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(record: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean {
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isLayout(value: unknown): value is Layout {
  return ["horizontal", "vertical", "stacked", "tabbed"].includes(value as Layout);
}

function isCenterAction(value: unknown): value is DragCenterAction {
  return value === "swap" || isLayout(value);
}

function topologySignature(
  inspection: TilingInspection,
  affectedContainerIds: readonly ContainerId[]
): string {
  return [...affectedContainerIds]
    .sort((left, right) => left.localeCompare(right))
    .map((id) => {
      const container = inspection.containers.find((candidate) => candidate.id === id);
      return container
        ? `${container.id}:${container.surfaceId}:${container.layout}:${container.childIds.join(
            ","
          )}`
        : `${id}:missing`;
    })
    .join("|");
}

function scopeForSurfaces(
  inspection: TilingInspection,
  surfaceIds: ReadonlySet<string>
): Readonly<{ windowIds: WindowId[]; containerIds: ContainerId[] }> {
  return {
    windowIds: inspection.windows
      .filter((window) => surfaceIds.has(window.surfaceId) && window.participating)
      .map((window) => window.id)
      .sort((left, right) => left.localeCompare(right)),
    containerIds: inspection.containers
      .filter((container) => surfaceIds.has(container.surfaceId))
      .map((container) => container.id)
      .sort((left, right) => left.localeCompare(right)),
  };
}

function scopeSupported(
  inspection: TilingInspection,
  windowIds: readonly WindowId[],
  surfaceIds: ReadonlySet<string>
): boolean {
  return (
    inspection.windows
      .filter((window) => windowIds.includes(window.id) && window.available)
      .every((window) => window.capabilities.move && window.capabilities.resize) &&
    inspection.surfaces
      .filter((surface) => surfaceIds.has(surface.id))
      .every((surface) => surface.capabilities.move && surface.capabilities.resize)
  );
}

function conflicts(
  inspection: TilingInspection,
  operationId: OperationId,
  windowIds: readonly WindowId[],
  containerIds: readonly ContainerId[]
): boolean {
  return inspection.operations.some(
    (operation) =>
      operation.id !== operationId &&
      (operation.affectedWindowIds.some((id) => windowIds.includes(id)) ||
        operation.affectedContainerIds.some((id) => containerIds.includes(id)))
  );
}

function withoutDrag(
  inspection: TilingInspection,
  operation: DragOperationInspection,
  intention?: TilingTransition["intentions"][number]
): DragOperationResult {
  const revision = inspection.revision + 1;
  return {
    inspection: {
      ...inspection,
      revision,
      operations: inspection.operations.filter((candidate) => candidate.id !== operation.id),
      renderPlan: {
        ...inspection.renderPlan,
        revision,
        previews: inspection.renderPlan.previews.filter(
          (preview) => preview.operationId !== operation.id
        ),
      },
    },
    transition: {
      status: "committed",
      revision,
      intentions: intention ? [intention] : [],
      diagnostics: [],
    },
  };
}

export function applyDragOperation(
  inspection: TilingInspection,
  event: DragEvent,
  currentNextContainer: number
): DragOperationResult {
  if (event.type === "OperationStarted") {
    const start = event.operation as unknown;
    if (
      !isRecord(start) ||
      !hasExactKeys(start, ["id", "kind", "windowId", "centerAction"]) ||
      start.kind !== "drag" ||
      typeof start.id !== "string" ||
      start.id.length === 0 ||
      typeof start.windowId !== "string" ||
      start.windowId.length === 0 ||
      !isCenterAction(start.centerAction)
    ) {
      return rejected(inspection, "invalid-drag-operation", "Drag operation start is malformed");
    }
    if (inspection.operations.some((operation) => operation.id === start.id)) {
      return ignored(inspection);
    }
    const window = inspection.windows.find((candidate) => candidate.id === start.windowId);
    const surfaceIds = new Set<string>(window ? [window.surfaceId] : []);
    const scope = scopeForSurfaces(inspection, surfaceIds);
    if (
      !window?.participating ||
      !window.available ||
      !window.parentId ||
      !scopeSupported(inspection, scope.windowIds, surfaceIds)
    ) {
      return rejected(
        inspection,
        "invalid-operation-target",
        "Drag operation requires a movable participating window"
      );
    }
    if (conflicts(inspection, start.id as OperationId, scope.windowIds, scope.containerIds)) {
      return rejected(
        inspection,
        "operation-conflict",
        "Concurrent operations must affect disjoint surfaces"
      );
    }
    const operation: DragOperationInspection = {
      id: start.id as OperationId,
      kind: "drag",
      windowId: window.id,
      centerAction: start.centerAction,
      affectedWindowIds: scope.windowIds,
      affectedContainerIds: scope.containerIds,
      topologyRevision: inspection.revision,
      topologySignature: topologySignature(inspection, scope.containerIds),
    };
    const revision = inspection.revision + 1;
    return {
      inspection: {
        ...inspection,
        revision,
        operations: [...inspection.operations, operation],
        renderPlan: { ...inspection.renderPlan, revision },
      },
      transition: { status: "committed", revision, intentions: [], diagnostics: [] },
    };
  }

  const operation = inspection.operations.find(
    (candidate): candidate is DragOperationInspection =>
      candidate.id === event.operationId && candidate.kind === "drag"
  );
  if (!operation) return ignored(inspection);
  if (
    operation.topologySignature !== topologySignature(inspection, operation.affectedContainerIds)
  ) {
    return rejected(
      inspection,
      "stale-operation-topology",
      "Drag operation topology changed after its last update"
    );
  }

  if (event.type === "OperationCancelled") {
    const hasPreview = inspection.renderPlan.previews.some(
      (preview) => preview.operationId === operation.id
    );
    return withoutDrag(
      inspection,
      operation,
      hasPreview
        ? {
            type: "ClearPreview",
            revision: inspection.revision + 1,
            ordinal: 0,
            operationId: operation.id,
          }
        : undefined
    );
  }
  if (event.type === "OperationCommitted") {
    return commitDragPlacement(inspection, operation, currentNextContainer);
  }
  if (event.type !== "OperationUpdated") return ignored(inspection);

  const update = event.update as unknown;
  const pointer = isRecord(update) ? update.pointer : undefined;
  if (
    !isRecord(update) ||
    !hasExactKeys(update, ["pointer"]) ||
    !isRecord(pointer) ||
    !hasExactKeys(pointer, ["surfaceId", "x", "y"]) ||
    typeof pointer.surfaceId !== "string" ||
    typeof pointer.x !== "number" ||
    !Number.isFinite(pointer.x) ||
    typeof pointer.y !== "number" ||
    !Number.isFinite(pointer.y) ||
    !inspection.surfaces.some((surface) => surface.id === pointer.surfaceId)
  ) {
    return rejected(inspection, "invalid-drag-update", "Drag pointer must resolve on a Surface");
  }
  const typedPointer = pointer as Point;
  const target = dragTargetAtPoint(inspection, operation.windowId, typedPointer);
  const placement = target
    ? resolveDragPlacement(
        inspection,
        operation,
        target.window,
        dragRegionAtPoint(typedPointer, target.plan.frame)
      )
    : undefined;
  const surfaceIds = new Set<string>([
    inspection.windows.find((window) => window.id === operation.windowId)?.surfaceId ?? "",
    ...(target ? [target.window.surfaceId] : []),
  ]);
  surfaceIds.delete("");
  const scope = scopeForSurfaces(inspection, surfaceIds);
  if (!scopeSupported(inspection, scope.windowIds, surfaceIds)) {
    return rejected(
      inspection,
      "capability-unsupported",
      "Drag placement requires move and resize capabilities"
    );
  }
  if (conflicts(inspection, operation.id, scope.windowIds, scope.containerIds)) {
    return rejected(
      inspection,
      "operation-conflict",
      "Drag target conflicts with another active operation"
    );
  }
  const preview =
    target && placement
      ? {
          operationId: operation.id,
          surfaceId: target.window.surfaceId,
          rect: dragPreviewRect(placement, target.plan.frame),
        }
      : undefined;
  const currentPreview = inspection.renderPlan.previews.find(
    (candidate) => candidate.operationId === operation.id
  );
  if (
    sameDragPlacement(operation.placement, placement) &&
    JSON.stringify(currentPreview) === JSON.stringify(preview)
  ) {
    return ignored(inspection);
  }
  const revision = inspection.revision + 1;
  const nextOperation: DragOperationInspection = {
    ...operation,
    ...(placement ? { placement } : { placement: undefined }),
    affectedWindowIds: scope.windowIds,
    affectedContainerIds: scope.containerIds,
    topologyRevision: inspection.revision,
    topologySignature: topologySignature(inspection, scope.containerIds),
  };
  const intention = preview
    ? {
        type: "PresentPreview" as const,
        revision,
        ordinal: 0,
        operationId: operation.id,
        surfaceId: preview.surfaceId,
        rect: { ...preview.rect },
      }
    : {
        type: "ClearPreview" as const,
        revision,
        ordinal: 0,
        operationId: operation.id,
      };
  return {
    inspection: {
      ...inspection,
      revision,
      operations: inspection.operations.map((candidate) =>
        candidate.id === operation.id ? nextOperation : candidate
      ),
      renderPlan: {
        ...inspection.renderPlan,
        revision,
        previews: [
          ...inspection.renderPlan.previews.filter(
            (candidate) => candidate.operationId !== operation.id
          ),
          ...(preview ? [preview] : []),
        ],
      },
    },
    transition: { status: "committed", revision, intentions: [intention], diagnostics: [] },
  };
}
