import type { TilingInspection } from "./contracts.js";

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
  invariant(surfaceIds.size === inspection.surfaces.length, "Surface identities must be unique");
  invariant(windowIds.size === inspection.windows.length, "Window identities must be unique");
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
    }
    for (const weight of Object.values(container.weights)) {
      invariant(
        Number.isFinite(weight) && weight > 0,
        `Container ${container.id} weights are positive`
      );
    }
  }

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
  for (const operation of inspection.operations) {
    invariant(
      !operatedContainers.has(operation.containerId),
      "Active operations have disjoint containers"
    );
    operatedContainers.add(operation.containerId);
    for (const id of [operation.windowId, operation.neighborWindowId]) {
      if (!id) continue;
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
