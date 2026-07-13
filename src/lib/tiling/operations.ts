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

type OperationEvent = Extract<
  TilingEvent,
  {
    type: "OperationStarted" | "OperationUpdated" | "OperationCommitted" | "OperationCancelled";
  }
>;

export type OperationResult = Readonly<{
  inspection: TilingInspection;
  transition: TilingTransition;
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
  event: OperationEvent
): OperationResult {
  if (event.type === "OperationStarted") {
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
    const boundary = resizeBoundary(inspection, window.id, event.operation.direction);
    if (!boundary) {
      return rejected(
        inspection,
        "missing-resize-neighbor",
        "Resize operation requires an adjacent participating window"
      );
    }
    const affected = descendants(inspection, [boundary.primaryChildId, boundary.neighborChildId]);
    const affectedContainerIds = [boundary.container.id, ...affected.containerIds].filter(
      (id, index, ids) => ids.indexOf(id) === index
    );
    const conflicts = inspection.operations.some(
      (operation) =>
        operation.affectedContainerIds.some((id) => affectedContainerIds.includes(id)) ||
        operation.affectedWindowIds.some((id) => affected.windowIds.includes(id))
    );
    if (conflicts) {
      return rejected(
        inspection,
        "operation-conflict",
        "Concurrent operations must affect disjoint containers"
      );
    }
    const neighborDescendants = descendants(inspection, [boundary.neighborChildId]);
    const neighbor = inspection.windows.find(
      (candidate) =>
        neighborDescendants.windowIds.includes(candidate.id) &&
        candidate.participating &&
        candidate.available
    );
    if (!neighbor) {
      return rejected(
        inspection,
        "missing-resize-neighbor",
        "Resize operation requires an adjacent participating window"
      );
    }
    const surface = inspection.surfaces.find((candidate) => candidate.id === window.surfaceId);
    const unsupported = inspection.windows.some(
      (candidate) =>
        affected.windowIds.includes(candidate.id) &&
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
    const baseWeights = normalizedWeights(boundary.container);
    const operation: OperationInspection = {
      id: event.operation.id,
      kind: event.operation.kind,
      windowId: window.id,
      neighborWindowId: neighbor.id,
      containerId: boundary.container.id,
      primaryChildId: boundary.primaryChildId,
      neighborChildId: boundary.neighborChildId,
      affectedWindowIds: affected.windowIds,
      affectedContainerIds,
      direction: boundary.direction,
      baseWeights,
      overlayWeights: { ...baseWeights },
      topologyRevision: inspection.revision,
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
  const container = inspection.containers.find(
    (candidate) => candidate.id === operation.containerId
  );
  if (!container) return ignored(inspection);

  if (event.type === "OperationUpdated") {
    if (!Number.isFinite(event.update.shareDelta)) {
      return rejected(inspection, "invalid-operation-update", "Resize share delta must be finite");
    }
    const minimum = 0.01;
    const pairTotal =
      operation.baseWeights[operation.primaryChildId] +
      operation.baseWeights[operation.neighborChildId];
    const requested = operation.baseWeights[operation.primaryChildId] + event.update.shareDelta;
    const primary = Math.max(minimum, Math.min(pairTotal - minimum, requested));
    const overlayWeights = {
      ...operation.baseWeights,
      [operation.primaryChildId]: primary,
      [operation.neighborChildId]: pairTotal - primary,
    };
    const operations = inspection.operations.map((candidate) =>
      candidate.id === operation.id ? { ...candidate, overlayWeights } : candidate
    );
    const renderContainers = inspection.containers.map((candidate) =>
      candidate.id === container.id ? { ...candidate, weights: overlayWeights } : candidate
    );
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

  const containers = inspection.containers.map((candidate) =>
    candidate.id === container.id ? { ...candidate, weights: operation.overlayWeights } : candidate
  );
  return withRender(
    inspection,
    inspection.revision + 1,
    containers,
    inspection.operations.filter((candidate) => candidate.id !== operation.id),
    containers
  );
}
