import type {
  ContainerId,
  ContainerInspection,
  DragOperationInspection,
  TilingChildId,
  TilingInspection,
  TilingTransition,
  WindowInspection,
} from "./contracts.js";
import { deriveContainerPlans, deriveWindowPlans } from "./geometry.js";
import { changedContainerIntentions, changedPlacementIntentions } from "./intentions.js";
import { normalizeTopology } from "./transition-helpers.js";

export type DragCommitResult = Readonly<{
  inspection: TilingInspection;
  transition: TilingTransition;
  nextContainer?: number;
}>;

function rejected(inspection: TilingInspection, code: string, message: string): DragCommitResult {
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

function replaceWeight(
  weights: Readonly<Record<string, number>>,
  previousId: TilingChildId,
  nextId: TilingChildId
): Record<string, number> {
  const next = { ...weights };
  const weight = next[previousId];
  delete next[previousId];
  if (weight !== undefined) next[nextId] = weight;
  return next;
}

function collapseSafeSplitContainers(
  sourceContainers: readonly ContainerInspection[],
  sourceWindows: readonly WindowInspection[],
  collapsibleContainerIds: ReadonlySet<ContainerId>,
  collapsibleRootIds: ReadonlySet<ContainerId>
): Readonly<{ containers: ContainerInspection[]; windows: WindowInspection[] }> {
  let containers = sourceContainers.map((container) => ({
    ...container,
    childIds: [...container.childIds],
    weights: { ...container.weights },
  }));
  let windows = sourceWindows.map((window) => ({ ...window }));
  while (true) {
    const nested = containers.find(
      (container) =>
        collapsibleContainerIds.has(container.id) &&
        container.parentId !== undefined &&
        (container.layout === "horizontal" || container.layout === "vertical") &&
        container.childIds.length === 1
    );
    if (nested?.parentId) {
      const childId = nested.childIds[0];
      containers = containers
        .filter((container) => container.id !== nested.id)
        .map((container) => {
          if (container.id === nested.parentId) {
            return {
              ...container,
              childIds: container.childIds.map((id) => (id === nested.id ? childId : id)),
              weights: replaceWeight(container.weights, nested.id, childId),
            };
          }
          return container.id === childId ? { ...container, parentId: nested.parentId } : container;
        });
      windows = windows.map((window) =>
        window.id === childId ? { ...window, parentId: nested.parentId } : window
      );
      continue;
    }

    const absorbable = containers
      .filter(
        (container) =>
          collapsibleRootIds.has(container.id) &&
          container.parentId === undefined &&
          container.childIds.length === 1
      )
      .map((root) => ({
        root,
        child: containers.find((container) => container.id === root.childIds[0]),
      }))
      .find(
        (candidate) =>
          candidate.child?.layout === "horizontal" || candidate.child?.layout === "vertical"
      );
    if (absorbable?.child) {
      const { root, child: onlyChild } = absorbable;
      containers = containers
        .filter((container) => container.id !== onlyChild.id)
        .map((container) =>
          container.id === root.id
            ? {
                ...container,
                layout: onlyChild.layout,
                childIds: [...onlyChild.childIds],
                weights: { ...onlyChild.weights },
                selectedChildId: undefined,
              }
            : onlyChild.childIds.includes(container.id)
            ? { ...container, parentId: root.id }
            : container
        );
      windows = windows.map((window) =>
        onlyChild.childIds.includes(window.id) ? { ...window, parentId: root.id } : window
      );
      continue;
    }
    return { containers, windows };
  }
}

export function commitDragPlacement(
  inspection: TilingInspection,
  operation: DragOperationInspection,
  currentNextContainer: number
): DragCommitResult {
  const placement = operation.placement;
  if (!placement) {
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
      transition: { status: "committed", revision, intentions: [], diagnostics: [] },
    };
  }
  const dragged = inspection.windows.find((window) => window.id === operation.windowId);
  const target = inspection.windows.find((window) => window.id === placement.targetWindowId);
  if (!dragged?.parentId || !target?.parentId || dragged.id === target.id) {
    return rejected(inspection, "stale-drag-placement", "Drag placement target is no longer valid");
  }
  const collapsibleContainerIds = new Set<ContainerId>();
  const collapsibleRootIds = new Set<ContainerId>();
  if (placement.kind !== "swap") {
    let ancestorId: ContainerId | undefined = dragged.parentId;
    while (ancestorId) {
      collapsibleContainerIds.add(ancestorId);
      ancestorId = inspection.containers.find((container) => container.id === ancestorId)?.parentId;
    }
    const affectedSurfaceIds = new Set([dragged.surfaceId, target.surfaceId]);
    for (const surface of inspection.surfaces) {
      if (affectedSurfaceIds.has(surface.id)) collapsibleRootIds.add(surface.rootId);
    }
  }

  let nextContainer = currentNextContainer;
  let containers: ContainerInspection[] = inspection.containers.map((container) => ({
    ...container,
    childIds: [...container.childIds],
    weights: { ...container.weights },
  }));
  let windows = inspection.windows.map((window) => ({ ...window }));

  if (placement.kind === "swap") {
    containers = containers.map((container) => {
      if (container.id === dragged.parentId && container.id === target.parentId) {
        const draggedWeight = container.weights[dragged.id];
        const targetWeight = container.weights[target.id];
        const weights = { ...container.weights };
        if (targetWeight === undefined) delete weights[dragged.id];
        else weights[dragged.id] = targetWeight;
        if (draggedWeight === undefined) delete weights[target.id];
        else weights[target.id] = draggedWeight;
        return {
          ...container,
          childIds: container.childIds.map((id) =>
            id === dragged.id ? target.id : id === target.id ? dragged.id : id
          ),
          weights,
        };
      }
      if (container.id === dragged.parentId) {
        return {
          ...container,
          childIds: container.childIds.map((id) => (id === dragged.id ? target.id : id)),
          weights: replaceWeight(container.weights, dragged.id, target.id),
        };
      }
      if (container.id === target.parentId) {
        return {
          ...container,
          childIds: container.childIds.map((id) => (id === target.id ? dragged.id : id)),
          weights: replaceWeight(container.weights, target.id, dragged.id),
        };
      }
      return container;
    });
    windows = windows.map((window) =>
      window.id === dragged.id
        ? { ...window, parentId: target.parentId, surfaceId: target.surfaceId }
        : window.id === target.id
        ? { ...window, parentId: dragged.parentId, surfaceId: dragged.surfaceId }
        : window
    );
  } else {
    containers = containers.map((container) => {
      if (!container.childIds.includes(dragged.id)) return container;
      const weights = { ...container.weights };
      delete weights[dragged.id];
      return {
        ...container,
        childIds: container.childIds.filter((id) => id !== dragged.id),
        weights,
      };
    });

    if (placement.kind === "insert" || placement.kind === "detach") {
      containers = containers.map((container) => {
        if (container.id !== placement.containerId) return container;
        const childIds = [...container.childIds];
        const referenceIndex = placement.referenceChildId
          ? childIds.indexOf(placement.referenceChildId)
          : childIds.length;
        childIds.splice(referenceIndex < 0 ? childIds.length : referenceIndex, 0, dragged.id);
        return {
          ...container,
          childIds,
          weights: {},
          ...(placement.layout ? { layout: placement.layout } : {}),
          ...(placement.layout === "stacked" || placement.layout === "tabbed"
            ? { selectedChildId: dragged.id }
            : placement.layout
            ? { selectedChildId: undefined }
            : {}),
        };
      });
      windows = windows.map((window) =>
        window.id === dragged.id
          ? { ...window, parentId: placement.containerId, surfaceId: target.surfaceId }
          : window
      );
    } else {
      const nestedId = `container:${nextContainer++}` as ContainerId;
      containers = containers.map((container) => {
        if (container.id !== placement.containerId) return container;
        return {
          ...container,
          childIds: container.childIds.map((id) => (id === target.id ? nestedId : id)),
          weights: replaceWeight(container.weights, target.id, nestedId),
        };
      });
      const leading = placement.region === "left" || placement.region === "up";
      containers.push({
        id: nestedId,
        surfaceId: target.surfaceId,
        parentId: placement.containerId,
        layout: placement.layout ?? "horizontal",
        childIds: leading ? [dragged.id, target.id] : [target.id, dragged.id],
        weights: {},
        ...(placement.layout === "stacked" || placement.layout === "tabbed"
          ? { selectedChildId: dragged.id }
          : {}),
      });
      windows = windows.map((window) =>
        window.id === dragged.id || window.id === target.id
          ? { ...window, parentId: nestedId, surfaceId: target.surfaceId }
          : window
      );
    }
  }

  ({ containers, windows } = collapseSafeSplitContainers(
    containers,
    windows,
    collapsibleContainerIds,
    collapsibleRootIds
  ));
  containers = normalizeTopology(containers, windows);
  const revision = inspection.revision + 1;
  const windowPlans = deriveWindowPlans(
    inspection.surfaces,
    windows,
    containers,
    inspection.policy
  );
  const intentions = changedPlacementIntentions(
    inspection.renderPlan.windows,
    windowPlans,
    revision
  );
  const containerPlans = deriveContainerPlans(
    inspection.surfaces,
    windows,
    containers,
    inspection.policy
  );
  intentions.push(
    ...changedContainerIntentions(
      inspection.renderPlan.containers,
      containerPlans,
      revision,
      intentions.length
    )
  );
  intentions.push({
    type: "ClearPreview",
    revision,
    ordinal: intentions.length,
    operationId: operation.id,
  });
  return {
    inspection: {
      ...inspection,
      revision,
      windows,
      containers,
      operations: inspection.operations.filter((candidate) => candidate.id !== operation.id),
      renderPlan: {
        ...inspection.renderPlan,
        revision,
        windows: windowPlans,
        containers: containerPlans,
        previews: inspection.renderPlan.previews.filter(
          (preview) => preview.operationId !== operation.id
        ),
      },
    },
    transition: { status: "committed", revision, intentions, diagnostics: [] },
    ...(nextContainer !== currentNextContainer ? { nextContainer } : {}),
  };
}
