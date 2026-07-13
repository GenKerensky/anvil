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

function constrain(rect: Rect, constraint: TilingPolicy["constraints"][string] | undefined): Rect {
  if (!constraint) return rect;
  let { x, y, width, height } = rect;
  if (constraint.maxWidth !== undefined && constraint.maxWidth > 0 && width > constraint.maxWidth) {
    x += Math.floor((width - constraint.maxWidth) / 2);
    width = constraint.maxWidth;
  }
  if (
    constraint.maxHeight !== undefined &&
    constraint.maxHeight > 0 &&
    height > constraint.maxHeight
  ) {
    y += Math.floor((height - constraint.maxHeight) / 2);
    height = constraint.maxHeight;
  }
  return { x, y, width, height };
}

function splitFrames(
  workArea: Rect,
  windows: readonly WindowInspection[],
  layout: TilingPolicy["defaultLayout"],
  gap: number,
  weights: Readonly<Record<string, number>>
): WindowPlan[] {
  const available = windows.filter((window) => window.available);
  if (available.length === 0) return [];
  if (layout === "stacked" || layout === "tabbed") {
    return available.map((window) => ({
      id: window.id,
      surfaceId: window.surfaceId,
      frame: inset(workArea, gap),
    }));
  }
  const horizontal = layout === "horizontal";
  const total = horizontal ? workArea.width : workArea.height;
  const rawWeights = available.map((window) => weights[window.id] ?? 1);
  const totalWeight = rawWeights.reduce((sum, weight) => sum + weight, 0);
  let cursor = horizontal ? workArea.x : workArea.y;
  return available.map((window, index) => {
    const consumed = cursor - (horizontal ? workArea.x : workArea.y);
    const size =
      index === available.length - 1
        ? total - consumed
        : Math.floor((total * rawWeights[index]) / totalWeight);
    const frame = horizontal
      ? { x: cursor, y: workArea.y, width: size, height: workArea.height }
      : { x: workArea.x, y: cursor, width: workArea.width, height: size };
    cursor += size;
    return { id: window.id, surfaceId: window.surfaceId, frame: inset(frame, gap) };
  });
}

export function deriveWindowPlans(
  surfaces: readonly SurfaceInspection[],
  windows: readonly WindowInspection[],
  containers: readonly ContainerInspection[],
  policy: TilingPolicy
): WindowPlan[] {
  return surfaces.flatMap((surface) => {
    const root = containers.find((container) => container.id === surface.rootId);
    const surfaceWindows = (root?.childIds ?? [])
      .map((id) => windows.find((window) => window.id === id))
      .filter(
        (window): window is WindowInspection =>
          window !== undefined && window.participating && window.surfaceId === surface.id
      );
    const availableCount = surfaceWindows.filter((window) => window.available).length;
    const gap = policy.hideGapWhenSingle && availableCount === 1 ? 0 : policy.gap;
    return splitFrames(
      surface.workArea,
      surfaceWindows,
      root?.layout ?? policy.defaultLayout,
      gap,
      root?.weights ?? {}
    )
      .map((plan) => ({
        ...plan,
        frame: constrain(plan.frame, policy.constraints[surface.id]),
      }))
      .sort((left, right) => left.id.localeCompare(right.id));
  });
}

export function deriveContainerPlans(
  surfaces: readonly SurfaceInspection[],
  containers: readonly ContainerInspection[]
): ContainerPlan[] {
  return containers
    .map((container) => {
      const surface = surfaces.find((candidate) => candidate.id === container.surfaceId);
      if (!surface) return null;
      return {
        id: container.id,
        surfaceId: container.surfaceId,
        rect: copyRect(surface.workArea),
        layout: container.layout,
        ...(container.selectedChildId ? { selectedChildId: container.selectedChildId } : {}),
        stackingOrder: [...container.childIds],
      } as ContainerPlan;
    })
    .filter((container): container is ContainerPlan => container !== null)
    .sort((left, right) => left.id.localeCompare(right.id));
}
