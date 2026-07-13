import type { TilingInspection } from "./contracts.js";
import { axisForDirection, compareDirections } from "./directions.js";

export class TilingInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TilingInvariantError";
  }
}

function invariant(condition: boolean, message: string): asserts condition {
  if (!condition) throw new TilingInvariantError(message);
}

export function assertTilingInvariants(inspection: TilingInspection): void {
  const surfaceIds = new Set<string>(inspection.surfaces.map((surface) => surface.id));
  const windowIds = new Set<string>(inspection.windows.map((window) => window.id));
  const containerIds = new Set<string>(inspection.containers.map((container) => container.id));
  const windows = new Map(inspection.windows.map((window) => [window.id, window]));
  const containers = new Map(inspection.containers.map((container) => [container.id, container]));
  invariant(surfaceIds.size === inspection.surfaces.length, "Surface identities must be unique");
  invariant(windowIds.size === inspection.windows.length, "Window identities must be unique");
  invariant(
    inspection.focusedWindowId === undefined || windowIds.has(inspection.focusedWindowId),
    "Focused Window identity must resolve"
  );
  invariant(
    containerIds.size === inspection.containers.length,
    "Container identities must be unique"
  );

  for (const surface of inspection.surfaces) {
    const root = inspection.containers.find((container) => container.id === surface.rootId);
    invariant(root !== undefined, `Surface ${surface.id} must resolve its root`);
    invariant(root.surfaceId === surface.id, `Surface ${surface.id} root must belong to it`);
    invariant(root.parentId === undefined, `Surface ${surface.id} root must have no parent`);
    invariant(
      Number.isFinite(surface.workArea.x) &&
        Number.isFinite(surface.workArea.y) &&
        Number.isFinite(surface.workArea.width) &&
        Number.isFinite(surface.workArea.height) &&
        surface.workArea.width > 0 &&
        surface.workArea.height > 0,
      `Surface ${surface.id} must have a finite positive work area`
    );
    for (const neighbor of Object.values(surface.neighbors)) {
      invariant(
        neighbor !== surface.id && surfaceIds.has(neighbor),
        `Surface ${surface.id} adjacency must resolve to a distinct Surface`
      );
    }
  }

  const parentCount = new Map<string, number>();
  for (const container of inspection.containers) {
    invariant(
      surfaceIds.has(container.surfaceId),
      `Container ${container.id} Surface must resolve`
    );
    for (const childId of container.childIds) {
      invariant(
        windowIds.has(childId) || containerIds.has(childId),
        `Container ${container.id} child ${childId} must resolve`
      );
      parentCount.set(childId, (parentCount.get(childId) ?? 0) + 1);
      const childWindow = windows.get(childId as TilingInspection["windows"][number]["id"]);
      const childContainer = containers.get(
        childId as TilingInspection["containers"][number]["id"]
      );
      if (childWindow) {
        invariant(
          childWindow.participating,
          `Container ${container.id} child Window ${childId} must participate`
        );
        invariant(
          childWindow.parentId === container.id,
          `Window ${childId} parent must match Container ${container.id}`
        );
        invariant(
          childWindow.surfaceId === container.surfaceId,
          `Window ${childId} must share its parent Surface`
        );
      }
      if (childContainer) {
        invariant(
          childContainer.parentId === container.id,
          `Container ${childId} parent must match Container ${container.id}`
        );
        invariant(
          childContainer.surfaceId === container.surfaceId,
          `Container ${childId} must share its parent Surface`
        );
      }
    }
    for (const weight of Object.values(container.weights)) {
      invariant(
        Number.isFinite(weight) && weight > 0,
        `Container ${container.id} weights are positive`
      );
    }
    const directChildIds = new Set<string>(container.childIds);
    invariant(
      Object.keys(container.weights).every((id) => directChildIds.has(id)),
      `Container ${container.id} weights must belong to direct children`
    );
    if (container.layout === "stacked" || container.layout === "tabbed") {
      const available = (id: string, ancestors = new Set<string>()): boolean => {
        const window = windows.get(id as TilingInspection["windows"][number]["id"]);
        if (window) return window.participating && window.available;
        const child = containers.get(id as TilingInspection["containers"][number]["id"]);
        if (!child || ancestors.has(id)) return false;
        const nextAncestors = new Set(ancestors).add(id);
        return child.childIds.some((childId) => available(childId, nextAncestors));
      };
      const availableChildren = container.childIds.filter((id) => available(id));
      invariant(
        availableChildren.length === 0 ||
          (container.selectedChildId !== undefined &&
            availableChildren.includes(container.selectedChildId)),
        `Container ${container.id} selection must resolve to an available child`
      );
    }
  }

  const rootIds = new Set(inspection.surfaces.map((surface) => surface.rootId));
  for (const container of inspection.containers) {
    if (rootIds.has(container.id)) {
      invariant(
        parentCount.get(container.id) === undefined,
        `Root Container ${container.id} must not appear as a child`
      );
      continue;
    }
    invariant(container.parentId !== undefined, `Container ${container.id} needs a parent`);
    invariant(parentCount.get(container.id) === 1, `Container ${container.id} appears once`);
    invariant(container.childIds.length > 0, `Container ${container.id} must not be empty`);
  }

  const reachableContainers = new Set<string>();
  const visit = (containerId: string, ancestors: Set<string>): void => {
    invariant(!ancestors.has(containerId), `Container ${containerId} must not form a cycle`);
    if (reachableContainers.has(containerId)) return;
    reachableContainers.add(containerId);
    const container = containers.get(containerId as TilingInspection["containers"][number]["id"]);
    invariant(container !== undefined, `Container ${containerId} must resolve`);
    const nextAncestors = new Set(ancestors).add(containerId);
    for (const childId of container.childIds) {
      if (containerIds.has(childId)) visit(childId, nextAncestors);
    }
  };
  for (const rootId of rootIds) visit(rootId, new Set());
  invariant(
    reachableContainers.size === inspection.containers.length,
    "Every Container must be reachable from one Surface root"
  );

  for (const window of inspection.windows) {
    if (window.participating) {
      invariant(
        surfaceIds.has(window.surfaceId),
        `Participating Window ${window.id} needs a Surface`
      );
      invariant(window.parentId !== undefined, `Participating Window ${window.id} needs a parent`);
      invariant(parentCount.get(window.id) === 1, `Participating Window ${window.id} appears once`);
    } else {
      invariant(
        parentCount.get(window.id) === undefined,
        `Non-participant ${window.id} is not in tree`
      );
    }
  }

  const operatedContainers = new Set<string>();
  const operatedWindows = new Set<string>();
  const descendantClosure = (childIds: readonly string[]) => {
    const windowClosure = new Set<string>();
    const containerClosure = new Set<string>();
    const visitChild = (id: string): void => {
      if (windowIds.has(id)) {
        windowClosure.add(id);
        return;
      }
      const container = containers.get(id as TilingInspection["containers"][number]["id"]);
      if (!container || containerClosure.has(id)) return;
      containerClosure.add(id);
      for (const childId of container.childIds) visitChild(childId);
    };
    for (const childId of childIds) visitChild(childId);
    return { windows: windowClosure, containers: containerClosure };
  };
  for (const operation of inspection.operations) {
    invariant(operation.boundaries.length > 0, "Resize Operation must have a boundary");
    invariant(
      operation.boundaries.every(
        (boundary, index) =>
          index === 0 ||
          compareDirections(operation.boundaries[index - 1].direction, boundary.direction) <= 0
      ),
      "Resize Operation boundaries must be canonically sorted"
    );
    const operationAxes = new Set<string>();
    const expectedContainers = new Set<string>();
    const expectedWindows = new Set<string>();
    for (const boundary of operation.boundaries) {
      const operationContainer = containers.get(boundary.containerId);
      invariant(operationContainer !== undefined, "Operation Container must resolve");
      invariant(
        boundary.primaryChildId !== boundary.neighborChildId &&
          operationContainer.childIds.includes(boundary.primaryChildId) &&
          operationContainer.childIds.includes(boundary.neighborChildId),
        "Operation boundary children must be distinct direct children"
      );
      const axis = axisForDirection(boundary.direction);
      const horizontal = axis === "horizontal";
      invariant(
        !operationAxes.has(axis),
        "Resize Operation must have at most one boundary per axis"
      );
      operationAxes.add(axis);
      invariant(
        (horizontal && operationContainer.layout === "horizontal") ||
          (!horizontal && operationContainer.layout === "vertical"),
        "Operation direction must match its split Container"
      );
      const closure = descendantClosure([boundary.primaryChildId, boundary.neighborChildId]);
      closure.containers.add(boundary.containerId);
      for (const id of closure.containers) expectedContainers.add(id);
      for (const id of closure.windows) expectedWindows.add(id);
      const neighborClosure = descendantClosure([boundary.neighborChildId]);
      invariant(
        boundary.neighborWindowId === undefined ||
          neighborClosure.windows.has(boundary.neighborWindowId),
        "Operation neighbor Window must descend from its boundary child"
      );
      for (const weights of [boundary.baseWeights, boundary.overlayWeights]) {
        invariant(
          Number.isFinite(weights[boundary.primaryChildId]) &&
            weights[boundary.primaryChildId] > 0 &&
            Number.isFinite(weights[boundary.neighborChildId]) &&
            weights[boundary.neighborChildId] > 0,
          "Operation boundary weights must be positive and finite"
        );
      }
    }
    invariant(
      new Set(operation.affectedContainerIds).size === operation.affectedContainerIds.length &&
        new Set(operation.affectedWindowIds).size === operation.affectedWindowIds.length,
      "Operation affected identities must be unique"
    );
    invariant(
      operation.affectedContainerIds.length === expectedContainers.size &&
        operation.affectedContainerIds.every((id) => expectedContainers.has(id)),
      "Operation affected Containers must equal its boundary closure"
    );
    invariant(
      operation.affectedWindowIds.length === expectedWindows.size &&
        operation.affectedWindowIds.every((id) => expectedWindows.has(id)),
      "Operation affected Windows must equal its boundary closure"
    );
    invariant(
      operation.affectedWindowIds.includes(operation.windowId),
      "Operation Window must be included in affected Windows"
    );
    invariant(
      operation.topologyRevision <= inspection.revision,
      "Operation topology revision must not be in the future"
    );
    const expectedTopologySignature = [...operation.affectedContainerIds]
      .sort((left, right) => left.localeCompare(right))
      .map((id) => {
        const container = containers.get(id);
        return container
          ? `${container.id}:${container.surfaceId}:${container.layout}:${container.childIds.join(
              ","
            )}`
          : `${id}:missing`;
      })
      .join("|");
    invariant(
      operation.topologySignature === expectedTopologySignature,
      "Operation topology signature must match its affected Containers"
    );
    invariant(
      operation.affectedContainerIds.every((id) => containerIds.has(id)),
      "Operation affected Containers must resolve"
    );
    invariant(
      operation.affectedWindowIds.every((id) => windowIds.has(id)),
      "Operation affected Windows must resolve"
    );
    invariant(
      operation.affectedContainerIds.every((id) => !operatedContainers.has(id)),
      "Active operations have disjoint containers"
    );
    for (const id of operation.affectedContainerIds) operatedContainers.add(id);
    for (const id of operation.affectedWindowIds) {
      invariant(!operatedWindows.has(id), "Active operations have disjoint windows");
      operatedWindows.add(id);
    }
  }

  for (const plan of inspection.renderPlan.windows) {
    invariant(windowIds.has(plan.id), `Window plan ${plan.id} must resolve`);
    invariant(surfaceIds.has(plan.surfaceId), `Window plan ${plan.id} Surface must resolve`);
    invariant(
      Number.isFinite(plan.frame.x) &&
        Number.isFinite(plan.frame.y) &&
        Number.isInteger(plan.frame.x) &&
        Number.isInteger(plan.frame.y) &&
        Number.isInteger(plan.frame.width) &&
        Number.isInteger(plan.frame.height) &&
        plan.frame.width > 0 &&
        plan.frame.height > 0,
      `Window plan ${plan.id} must have a finite positive integer frame`
    );
  }
}
