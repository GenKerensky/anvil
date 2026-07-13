import type {
  ContainerInspection,
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

function splitFrames(
  workArea: Rect,
  windows: readonly WindowInspection[],
  layout: TilingPolicy["defaultLayout"],
  gap: number
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
  const base = Math.floor(total / available.length);
  let cursor = horizontal ? workArea.x : workArea.y;
  return available.map((window, index) => {
    const size = index === available.length - 1 ? total - base * index : base;
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
    const surfaceWindows = windows.filter(
      (window) => window.participating && window.surfaceId === surface.id
    );
    const availableCount = surfaceWindows.filter((window) => window.available).length;
    const gap = policy.hideGapWhenSingle && availableCount === 1 ? 0 : policy.gap;
    const root = containers.find((container) => container.id === surface.rootId);
    return splitFrames(surface.workArea, surfaceWindows, root?.layout ?? policy.defaultLayout, gap);
  });
}
