import type {
  ContainerInspection,
  OperationInspection,
  TilingEvent,
  TilingInspection,
  TilingTransition,
} from "./contracts.js";
import { deriveWindowPlans } from "./geometry.js";
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
  const intentions = changedPlacementIntentions(inspection.renderPlan.windows, windows, revision);
  const next: TilingInspection = {
    ...inspection,
    revision,
    containers,
    operations,
    renderPlan: { ...inspection.renderPlan, revision, windows },
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
    const container = inspection.containers.find((candidate) => candidate.id === window?.parentId);
    if (!window?.participating || !container) {
      return rejected(
        inspection,
        "invalid-operation-target",
        "Resize operation requires a participating window"
      );
    }
    if (inspection.operations.some((operation) => operation.containerId === container.id)) {
      return rejected(
        inspection,
        "operation-conflict",
        "Concurrent operations must affect disjoint containers"
      );
    }
    const index = container.childIds.indexOf(window.id);
    const delta =
      event.operation.direction === "left" || event.operation.direction === "up" ? -1 : 1;
    const neighborId = container.childIds[index + delta];
    const neighbor = inspection.windows.find((candidate) => candidate.id === neighborId);
    if (!neighbor) {
      return rejected(
        inspection,
        "missing-resize-neighbor",
        "Resize operation requires an adjacent participating window"
      );
    }
    const baseWeights = normalizedWeights(container);
    const operation: OperationInspection = {
      id: event.operation.id,
      kind: event.operation.kind,
      windowId: window.id,
      neighborWindowId: neighbor.id,
      containerId: container.id,
      direction: event.operation.direction,
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
  if (!container || !operation.neighborWindowId) return ignored(inspection);

  if (event.type === "OperationUpdated") {
    if (!Number.isFinite(event.update.shareDelta)) {
      return rejected(inspection, "invalid-operation-update", "Resize share delta must be finite");
    }
    const minimum = 0.01;
    const pairTotal =
      operation.baseWeights[operation.windowId] + operation.baseWeights[operation.neighborWindowId];
    const requested = operation.baseWeights[operation.windowId] + event.update.shareDelta;
    const primary = Math.max(minimum, Math.min(pairTotal - minimum, requested));
    const overlayWeights = {
      ...operation.baseWeights,
      [operation.windowId]: primary,
      [operation.neighborWindowId]: pairTotal - primary,
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
