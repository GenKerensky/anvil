import type {
  ContainerId,
  ContainerInspection,
  Direction,
  OperationInspection,
  TilingChildId,
  TilingEvent,
  TilingInspection,
  TilingTransition,
  WindowId,
} from "./contracts.js";
import { deriveContainerPlans, deriveWindowPlans } from "./geometry.js";
import { changedPlacementIntentions } from "./intentions.js";
import { axisForDirection, compareDirections, isDirection } from "./directions.js";
import { applyDragOperation } from "./drag-operations.js";

type OperationEvent = Extract<
  TilingEvent,
  {
    type: "OperationStarted" | "OperationUpdated" | "OperationCommitted" | "OperationCancelled";
  }
>;

export type OperationResult = Readonly<{
  inspection: TilingInspection;
  transition: TilingTransition;
  nextContainer?: number;
}>;

function ignored(inspection: TilingInspection): OperationResult {
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

function rejected(inspection: TilingInspection, code: string, message: string): OperationResult {
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

function sameWeights(
  left: Readonly<Record<string, number>>,
  right: Readonly<Record<string, number>>
): boolean {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...keys].every((key) => left[key] === right[key]);
}

function normalizedWeights(container: ContainerInspection): Record<string, number> {
  const count = container.childIds.length;
  if (count === 0) return {};
  const raw = container.childIds.map((id) => container.weights[id] ?? 1 / count);
  const total = raw.reduce((sum, weight) => sum + weight, 0);
  return Object.fromEntries(container.childIds.map((id, index) => [id, raw[index] / total]));
}

function oppositeDirection(direction: "left" | "right" | "up" | "down") {
  return { left: "right", right: "left", up: "down", down: "up" }[direction] as typeof direction;
}

function resizeBoundary(
  inspection: TilingInspection,
  windowId: WindowId,
  requestedDirection: Direction
):
  | Readonly<{
      container: ContainerInspection;
      primaryChildId: TilingChildId;
      neighborChildId: TilingChildId;
      direction: Direction;
    }>
  | undefined {
  const containerById = new Map(
    inspection.containers.map((container) => [container.id, container])
  );
  const windowById = new Map(inspection.windows.map((window) => [window.id, window]));
  const available = (id: TilingChildId, ancestors = new Set<string>()): boolean => {
    const window = windowById.get(id as WindowId);
    if (window) return window.participating && window.available;
    const container = containerById.get(id as ContainerId);
    if (!container || ancestors.has(id)) return false;
    const nextAncestors = new Set(ancestors).add(id);
    return container.childIds.some((childId) => available(childId, nextAncestors));
  };
  const find = (direction: Direction) => {
    let primaryChildId: TilingChildId = windowId;
    let parentId = windowById.get(windowId)?.parentId;
    while (parentId) {
      const container = containerById.get(parentId);
      if (!container) return undefined;
      const horizontal = direction === "left" || direction === "right";
      if (
        (horizontal && container.layout === "horizontal") ||
        (!horizontal && container.layout === "vertical")
      ) {
        const activeChildren = container.childIds.filter((childId) => available(childId));
        const index = activeChildren.indexOf(primaryChildId);
        const delta = direction === "left" || direction === "up" ? -1 : 1;
        const neighborChildId = activeChildren[index + delta];
        if (neighborChildId) {
          return { container, primaryChildId, neighborChildId, direction };
        }
      }
      primaryChildId = container.id;
      parentId = container.parentId;
    }
    return undefined;
  };
  return find(requestedDirection) ?? find(oppositeDirection(requestedDirection));
}

function descendants(
  inspection: TilingInspection,
  childIds: readonly TilingChildId[]
): Readonly<{ windowIds: WindowId[]; containerIds: ContainerId[] }> {
  const windowIds = new Set<WindowId>();
  const containerIds = new Set<ContainerId>();
  const containers = new Map(inspection.containers.map((container) => [container.id, container]));
  const windows = new Set(inspection.windows.map((window) => window.id));
  const visit = (id: TilingChildId): void => {
    if (windows.has(id as WindowId)) {
      windowIds.add(id as WindowId);
      return;
    }
    const container = containers.get(id as ContainerId);
    if (!container || containerIds.has(container.id)) return;
    containerIds.add(container.id);
    for (const childId of container.childIds) visit(childId);
  };
  for (const childId of childIds) visit(childId);
  return {
    windowIds: [...windowIds].sort((left, right) => left.localeCompare(right)),
    containerIds: [...containerIds].sort((left, right) => left.localeCompare(right)),
  };
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

function withRender(
  inspection: TilingInspection,
  revision: number,
  containers: readonly ContainerInspection[],
  operations: readonly OperationInspection[],
  renderContainers: readonly ContainerInspection[]
): OperationResult {
  const windows = deriveWindowPlans(
    inspection.surfaces,
    inspection.windows,
    renderContainers,
    inspection.policy
  );
  const containerPlans = deriveContainerPlans(
    inspection.surfaces,
    inspection.windows,
    renderContainers
  );
  const intentions = changedPlacementIntentions(inspection.renderPlan.windows, windows, revision);
  const next: TilingInspection = {
    ...inspection,
    revision,
    containers,
    operations,
    renderPlan: { ...inspection.renderPlan, revision, windows, containers: containerPlans },
  };
  return {
    inspection: next,
    transition: { status: "committed", revision, intentions, diagnostics: [] },
  };
}

export function applyOperation(
  inspection: TilingInspection,
  event: OperationEvent,
  currentNextContainer: number
): OperationResult {
  const existingOperation =
    event.type === "OperationStarted"
      ? undefined
      : inspection.operations.find((candidate) => candidate.id === event.operationId);
  if (
    (event.type === "OperationStarted" && event.operation.kind === "drag") ||
    existingOperation?.kind === "drag"
  ) {
    return applyDragOperation(inspection, event, currentNextContainer);
  }
  if (event.type === "OperationStarted") {
    if (event.operation.kind !== "resize") {
      return rejected(inspection, "invalid-operation-kind", "Operation kind is not supported");
    }
    if (
      !isRecord(event.operation) ||
      !hasExactKeys(event.operation, ["id", "kind", "windowId", "directions"]) ||
      typeof event.operation.id !== "string" ||
      event.operation.id.length === 0 ||
      event.operation.kind !== "resize" ||
      typeof event.operation.windowId !== "string" ||
      event.operation.windowId.length === 0 ||
      !Array.isArray(event.operation.directions) ||
      !event.operation.directions.every(isDirection)
    ) {
      return rejected(
        inspection,
        "invalid-operation-directions",
        "Resize operation requires valid direction keys"
      );
    }
    if (inspection.operations.some((operation) => operation.id === event.operation.id)) {
      return ignored(inspection);
    }
    const window = inspection.windows.find(
      (candidate) => candidate.id === event.operation.windowId
    );
    if (window && (!window.capabilities.move || !window.capabilities.resize)) {
      return rejected(
        inspection,
        "capability-unsupported",
        "Resize operation requires move and resize capabilities"
      );
    }
    if (!window?.participating || !window.available || !window.parentId) {
      return rejected(
        inspection,
        "invalid-operation-target",
        "Resize operation requires a participating window"
      );
    }
    const requestedDirections = [...new Set(event.operation.directions)];
    const axes = new Set(requestedDirections.map(axisForDirection));
    if (
      requestedDirections.length === 0 ||
      requestedDirections.length > 2 ||
      axes.size !== requestedDirections.length
    ) {
      return rejected(
        inspection,
        "invalid-operation-directions",
        "Resize operation requires one edge per axis"
      );
    }
    const resolvedBoundaries = requestedDirections
      .map((direction) => resizeBoundary(inspection, window.id, direction))
      .filter((boundary): boundary is NonNullable<typeof boundary> => boundary !== undefined);
    if (resolvedBoundaries.length !== requestedDirections.length) {
      return rejected(
        inspection,
        "missing-resize-neighbor",
        "Resize operation requires an adjacent participating window"
      );
    }
    const boundaryClosures = resolvedBoundaries.map((boundary) => ({
      boundary,
      affected: descendants(inspection, [boundary.primaryChildId, boundary.neighborChildId]),
    }));
    const affectedWindowIds = [
      ...new Set(boundaryClosures.flatMap(({ affected }) => affected.windowIds)),
    ].sort((left, right) => left.localeCompare(right));
    const affectedContainerIds = [
      ...new Set(
        boundaryClosures.flatMap(({ boundary, affected }) => [
          boundary.container.id,
          ...affected.containerIds,
        ])
      ),
    ].sort((left, right) => left.localeCompare(right));
    const conflicts = inspection.operations.some(
      (operation) =>
        operation.affectedContainerIds.some((id) => affectedContainerIds.includes(id)) ||
        operation.affectedWindowIds.some((id) => affectedWindowIds.includes(id))
    );
    if (conflicts) {
      return rejected(
        inspection,
        "operation-conflict",
        "Concurrent operations must affect disjoint containers"
      );
    }
    const boundaries = boundaryClosures
      .map(({ boundary }) => {
        const neighborDescendants = descendants(inspection, [boundary.neighborChildId]);
        const neighbor = inspection.windows.find(
          (candidate) =>
            neighborDescendants.windowIds.includes(candidate.id) &&
            candidate.participating &&
            candidate.available
        );
        const baseWeights = normalizedWeights(boundary.container);
        return neighbor
          ? {
              direction: boundary.direction,
              containerId: boundary.container.id,
              primaryChildId: boundary.primaryChildId,
              neighborChildId: boundary.neighborChildId,
              neighborWindowId: neighbor.id,
              baseWeights,
              overlayWeights: { ...baseWeights },
            }
          : undefined;
      })
      .sort((left, right) =>
        left && right ? compareDirections(left.direction, right.direction) : left ? -1 : 1
      );
    if (boundaries.some((boundary) => boundary === undefined)) {
      return rejected(
        inspection,
        "missing-resize-neighbor",
        "Resize operation requires an adjacent participating window"
      );
    }
    const surface = inspection.surfaces.find((candidate) => candidate.id === window.surfaceId);
    const unsupported = inspection.windows.some(
      (candidate) =>
        affectedWindowIds.includes(candidate.id) &&
        candidate.participating &&
        candidate.available &&
        (!candidate.capabilities.move || !candidate.capabilities.resize)
    );
    if (unsupported || !surface?.capabilities.move || !surface.capabilities.resize) {
      return rejected(
        inspection,
        "capability-unsupported",
        "Resize operation requires move and resize capabilities"
      );
    }
    const operation: OperationInspection = {
      id: event.operation.id,
      kind: event.operation.kind,
      windowId: window.id,
      boundaries: boundaries.filter(
        (boundary): boundary is NonNullable<typeof boundary> => boundary !== undefined
      ),
      affectedWindowIds,
      affectedContainerIds,
      topologyRevision: inspection.revision,
      topologySignature: topologySignature(inspection, affectedContainerIds),
    };
    const revision = inspection.revision + 1;
    const next = {
      ...inspection,
      revision,
      operations: [...inspection.operations, operation],
      renderPlan: { ...inspection.renderPlan, revision },
    };
    return {
      inspection: next,
      transition: { status: "committed", revision, intentions: [], diagnostics: [] },
    };
  }

  const operation = inspection.operations.find((candidate) => candidate.id === event.operationId);
  if (!operation) return ignored(inspection);
  if (operation.kind !== "resize") return ignored(inspection);
  if (
    operation.boundaries.some(
      (boundary) =>
        !inspection.containers.some((container) => container.id === boundary.containerId)
    )
  )
    return ignored(inspection);
  if (
    operation.topologySignature !== topologySignature(inspection, operation.affectedContainerIds)
  ) {
    return rejected(
      inspection,
      "stale-operation-topology",
      "Resize operation topology changed after it started"
    );
  }

  if (event.type === "OperationUpdated") {
    const update = event.update as unknown;
    const shareDeltas = isRecord(update) ? update.shareDeltas : undefined;
    const entries = isRecord(shareDeltas) ? Object.entries(shareDeltas) : [];
    const boundaryDirections = new Set(operation.boundaries.map((boundary) => boundary.direction));
    if (
      !isRecord(update) ||
      !hasExactKeys(update, ["shareDeltas"]) ||
      !isRecord(shareDeltas) ||
      entries.length === 0 ||
      entries.some(
        ([direction, shareDelta]) =>
          !isDirection(direction) ||
          !boundaryDirections.has(direction) ||
          typeof shareDelta !== "number" ||
          !Number.isFinite(shareDelta)
      )
    ) {
      return rejected(
        inspection,
        "invalid-operation-update",
        "Resize share deltas must be finite and target active boundaries"
      );
    }
    const minimum = 0.01;
    const boundaries = operation.boundaries.map((boundary) => {
      const shareDelta = shareDeltas[boundary.direction] as number | undefined;
      if (shareDelta === undefined) return boundary;
      const pairTotal =
        boundary.baseWeights[boundary.primaryChildId] +
        boundary.baseWeights[boundary.neighborChildId];
      const requested = boundary.baseWeights[boundary.primaryChildId] + shareDelta;
      const primary = Math.max(minimum, Math.min(pairTotal - minimum, requested));
      return {
        ...boundary,
        overlayWeights: {
          ...boundary.baseWeights,
          [boundary.primaryChildId]: primary,
          [boundary.neighborChildId]: pairTotal - primary,
        },
      };
    });
    if (
      boundaries.every((boundary, index) =>
        sameWeights(boundary.overlayWeights, operation.boundaries[index].overlayWeights)
      )
    ) {
      return ignored(inspection);
    }
    const operations = inspection.operations.map((candidate) =>
      candidate.id === operation.id ? { ...candidate, boundaries } : candidate
    );
    const renderContainers = inspection.containers.map((candidate) => {
      const boundary = boundaries.find((item) => item.containerId === candidate.id);
      return boundary ? { ...candidate, weights: boundary.overlayWeights } : candidate;
    });
    return withRender(
      inspection,
      inspection.revision + 1,
      inspection.containers,
      operations,
      renderContainers
    );
  }

  if (event.type === "OperationCancelled") {
    return withRender(
      inspection,
      inspection.revision + 1,
      inspection.containers,
      inspection.operations.filter((candidate) => candidate.id !== operation.id),
      inspection.containers
    );
  }

  const containers = inspection.containers.map((candidate) => {
    const boundary = operation.boundaries.find(
      (operationBoundary) => operationBoundary.containerId === candidate.id
    );
    return boundary ? { ...candidate, weights: boundary.overlayWeights } : candidate;
  });
  return withRender(
    inspection,
    inspection.revision + 1,
    containers,
    inspection.operations.filter((candidate) => candidate.id !== operation.id),
    containers
  );
}
