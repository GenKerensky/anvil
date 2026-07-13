import type {
  ContainerInspection,
  ContainerPlan,
  Rect,
  SurfaceInspection,
  TilingPolicy,
  WindowInspection,
  WindowPlan,
} from "./contracts.js";

export function copyRect(rect: Rect): Rect {
  return { ...rect };
}

export function sameRect(left: Rect, right: Rect): boolean {
  return (
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height
  );
}

function inset(rect: Rect, gap: number): Rect {
  if (gap <= 0 || rect.width <= gap * 2 || rect.height <= gap * 2) return copyRect(rect);
  return {
    x: rect.x + gap,
    y: rect.y + gap,
    width: rect.width - gap * 2,
    height: rect.height - gap * 2,
  };
}

function constrain(
  rect: Rect,
  constraint: TilingPolicy["constraints"][string] | undefined,
  minimumSize: WindowInspection["minimumSize"]
): Rect {
  let { x, y, width, height } = rect;
  if (
    constraint?.maxWidth !== undefined &&
    constraint.maxWidth > 0 &&
    width > constraint.maxWidth
  ) {
    x += Math.floor((width - constraint.maxWidth) / 2);
    width = constraint.maxWidth;
  }
  if (
    constraint?.maxHeight !== undefined &&
    constraint.maxHeight > 0 &&
    height > constraint.maxHeight
  ) {
    y += Math.floor((height - constraint.maxHeight) / 2);
    height = constraint.maxHeight;
  }
  width = Math.max(width, minimumSize?.width ?? 0);
  height = Math.max(height, minimumSize?.height ?? 0);
  return { x, y, width, height };
}

type ChildId = ContainerInspection["childIds"][number];

type DerivedPlans = Readonly<{
  windows: WindowPlan[];
  containers: ContainerPlan[];
}>;

function presentationHeaderRect(
  container: ContainerInspection,
  rect: Rect,
  policy?: TilingPolicy
): Rect | undefined {
  if (
    (container.layout !== "stacked" && container.layout !== "tabbed") ||
    !policy ||
    policy.headerExtent <= 0 ||
    rect.height <= 1
  ) {
    return undefined;
  }
  const height = Math.min(policy.headerExtent, rect.height - 1);
  return { x: rect.x, y: rect.y, width: rect.width, height };
}

function allocateChildRects(
  container: ContainerInspection,
  rect: Rect,
  available: (id: ChildId) => boolean
): Map<ChildId, Rect> {
  const result = new Map<ChildId, Rect>();
  const active = container.childIds.filter(available);
  for (const childId of container.childIds) result.set(childId, copyRect(rect));
  if (active.length === 0 || container.layout === "stacked" || container.layout === "tabbed") {
    return result;
  }

  const horizontal = container.layout === "horizontal";
  const total = horizontal ? rect.width : rect.height;
  const rawWeights = active.map((id) => container.weights[id] ?? 1);
  const totalWeight = rawWeights.reduce((sum, weight) => sum + weight, 0);
  let cursor = horizontal ? rect.x : rect.y;
  for (const [index, childId] of active.entries()) {
    const consumed = cursor - (horizontal ? rect.x : rect.y);
    const size =
      index === active.length - 1
        ? total - consumed
        : Math.floor((total * rawWeights[index]) / totalWeight);
    const childRect = horizontal
      ? { x: cursor, y: rect.y, width: size, height: rect.height }
      : { x: rect.x, y: cursor, width: rect.width, height: size };
    result.set(childId, childRect);
    cursor += size;
  }
  return result;
}

function derivePlans(
  surfaces: readonly SurfaceInspection[],
  windows: readonly WindowInspection[],
  containers: readonly ContainerInspection[],
  policy?: TilingPolicy
): DerivedPlans {
  const windowById = new Map(windows.map((window) => [window.id, window]));
  const containerById = new Map(containers.map((container) => [container.id, container]));
  const availability = new Map<string, boolean>();
  const visiting = new Set<string>();
  const isAvailable = (id: ChildId): boolean => {
    const cached = availability.get(id);
    if (cached !== undefined) return cached;
    const window = windowById.get(id as WindowInspection["id"]);
    if (window) {
      const result = window.participating && window.available;
      availability.set(id, result);
      return result;
    }
    const container = containerById.get(id as ContainerInspection["id"]);
    if (!container || visiting.has(id)) return false;
    visiting.add(id);
    const result = container.childIds.some(isAvailable);
    visiting.delete(id);
    availability.set(id, result);
    return result;
  };

  const windowPlans: WindowPlan[] = [];
  const containerPlans: ContainerPlan[] = [];
  for (const surface of surfaces) {
    const availableCount = windows.filter(
      (window) => window.surfaceId === surface.id && window.participating && window.available
    ).length;
    const gap = policy ? (policy.hideGapWhenSingle && availableCount === 1 ? 0 : policy.gap) : 0;
    const visit = (container: ContainerInspection, rect: Rect, ancestors: Set<string>): void => {
      if (ancestors.has(container.id)) return;
      const headerRect = presentationHeaderRect(container, rect, policy);
      containerPlans.push({
        id: container.id,
        surfaceId: container.surfaceId,
        rect: copyRect(rect),
        ...(headerRect ? { headerRect } : {}),
        layout: container.layout,
        ...(container.selectedChildId ? { selectedChildId: container.selectedChildId } : {}),
        stackingOrder: [...container.childIds],
      });
      const contentRect = headerRect
        ? {
            x: rect.x,
            y: rect.y + headerRect.height,
            width: rect.width,
            height: rect.height - headerRect.height,
          }
        : rect;
      const childRects = allocateChildRects(container, contentRect, isAvailable);
      const nextAncestors = new Set(ancestors).add(container.id);
      for (const childId of container.childIds) {
        const childRect = childRects.get(childId) ?? rect;
        const window = windowById.get(childId as WindowInspection["id"]);
        if (window) {
          if (
            policy &&
            window.participating &&
            window.available &&
            window.surfaceId === surface.id
          ) {
            windowPlans.push({
              id: window.id,
              surfaceId: window.surfaceId,
              frame: constrain(
                inset(childRect, gap),
                policy.constraints[surface.id],
                window.minimumSize
              ),
            });
          }
          continue;
        }
        const childContainer = containerById.get(childId as ContainerInspection["id"]);
        if (childContainer && childContainer.surfaceId === surface.id) {
          visit(childContainer, childRect, nextAncestors);
        }
      }
    };
    const root = containerById.get(surface.rootId);
    if (root) visit(root, surface.workArea, new Set());
  }
  return {
    windows: windowPlans.sort((left, right) => left.id.localeCompare(right.id)),
    containers: containerPlans.sort((left, right) => left.id.localeCompare(right.id)),
  };
}

export function deriveWindowPlans(
  surfaces: readonly SurfaceInspection[],
  windows: readonly WindowInspection[],
  containers: readonly ContainerInspection[],
  policy: TilingPolicy
): WindowPlan[] {
  return derivePlans(surfaces, windows, containers, policy).windows;
}

export function deriveContainerPlans(
  surfaces: readonly SurfaceInspection[],
  windows: readonly WindowInspection[],
  containers: readonly ContainerInspection[],
  policy: TilingPolicy
): ContainerPlan[] {
  return derivePlans(surfaces, windows, containers, policy).containers;
}
