import type {
  ContainerInspection,
  OperationInspection,
  TilingInspection,
  TilingPolicy,
  WindowInspection,
} from "./contracts.js";

export function createInitialInspection(policy: TilingPolicy): TilingInspection {
  return {
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
}

export function tilingSurfaceIds(
  surfaces: readonly { id: string; capabilities: { move: boolean; resize: boolean } }[]
): Set<string> {
  return new Set(
    surfaces
      .filter((surface) => surface.capabilities.move && surface.capabilities.resize)
      .map((surface) => surface.id)
  );
}

export function normalizeSelections(
  containers: readonly ContainerInspection[],
  windows: readonly WindowInspection[]
): ContainerInspection[] {
  return containers.map((container) => {
    if (container.layout !== "stacked" && container.layout !== "tabbed") return container;
    const available = container.childIds.filter((id) =>
      windows.some((window) => window.id === id && window.participating && window.available)
    );
    const selectedChildId = available.includes(container.selectedChildId!)
      ? container.selectedChildId
      : available[0];
    return { ...container, selectedChildId };
  });
}

export function cancelOperationsForChangedTopology(
  previousContainers: readonly ContainerInspection[],
  nextContainers: readonly ContainerInspection[],
  operations: readonly OperationInspection[]
): OperationInspection[] {
  const changedContainers = new Set(
    nextContainers
      .filter((container) => {
        const previous = previousContainers.find((candidate) => candidate.id === container.id);
        return (
          !previous ||
          previous.layout !== container.layout ||
          previous.childIds.length !== container.childIds.length ||
          previous.childIds.some((id, index) => id !== container.childIds[index])
        );
      })
      .map((container) => container.id)
  );
  return operations.filter((operation) => !changedContainers.has(operation.containerId));
}
