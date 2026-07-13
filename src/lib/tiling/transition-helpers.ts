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
  const containerById = new Map(containers.map((container) => [container.id, container]));
  const windowById = new Map(windows.map((window) => [window.id, window]));
  const available = (id: string, ancestors = new Set<string>()): boolean => {
    const window = windowById.get(id as WindowInspection["id"]);
    if (window) return window.participating && window.available;
    const container = containerById.get(id as ContainerInspection["id"]);
    if (!container || ancestors.has(id)) return false;
    const nextAncestors = new Set(ancestors).add(id);
    return container.childIds.some((childId) => available(childId, nextAncestors));
  };
  return containers.map((container) => {
    if (container.layout !== "stacked" && container.layout !== "tabbed") return container;
    const availableChildren = container.childIds.filter((id) => available(id));
    const selectedChildId = availableChildren.includes(container.selectedChildId!)
      ? container.selectedChildId
      : availableChildren[0];
    return { ...container, selectedChildId };
  });
}

export function normalizeTopology(
  containers: readonly ContainerInspection[],
  windows: readonly WindowInspection[]
): ContainerInspection[] {
  let normalized = containers.map((container) => ({
    ...container,
    childIds: [...container.childIds],
    weights: { ...container.weights },
  }));
  while (true) {
    const emptyIds = new Set<string>(
      normalized
        .filter((container) => container.parentId !== undefined && container.childIds.length === 0)
        .map((container) => container.id)
    );
    if (emptyIds.size === 0) break;
    normalized = normalized
      .filter((container) => !emptyIds.has(container.id))
      .map((container) => {
        const childIds = container.childIds.filter((id) => !emptyIds.has(id));
        const weights = Object.fromEntries(
          Object.entries(container.weights).filter(([id]) => !emptyIds.has(id))
        );
        return {
          ...container,
          childIds,
          weights,
          ...(container.selectedChildId && emptyIds.has(container.selectedChildId)
            ? { selectedChildId: undefined }
            : {}),
        };
      });
  }
  return normalizeSelections(normalized, windows);
}

export function cancelOperationsForChangedTopology(
  previousContainers: readonly ContainerInspection[],
  nextContainers: readonly ContainerInspection[],
  operations: readonly OperationInspection[]
): OperationInspection[] {
  const changedContainers = new Set(
    [...previousContainers, ...nextContainers]
      .filter(
        (container, index, all) => all.findIndex((item) => item.id === container.id) === index
      )
      .filter((container) => {
        const previous = previousContainers.find((candidate) => candidate.id === container.id);
        const next = nextContainers.find((candidate) => candidate.id === container.id);
        return (
          !previous ||
          !next ||
          previous.layout !== next.layout ||
          previous.childIds.length !== next.childIds.length ||
          previous.childIds.some((id, index) => id !== next.childIds[index])
        );
      })
      .map((container) => container.id)
  );
  return operations.filter(
    (operation) =>
      !operation.affectedContainerIds.some((containerId) => changedContainers.has(containerId))
  );
}
