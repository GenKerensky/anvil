import type {
  DragOperationInspection,
  DragPlacementInspection,
  DragRegion,
  Point,
  PreviewPlan,
  TilingInspection,
  WindowId,
  WindowInspection,
} from "./contracts.js";

export type DragTarget = Readonly<{
  plan: TilingInspection["renderPlan"]["windows"][number];
  window: WindowInspection;
}>;

function contains(
  point: Point,
  rect: { x: number; y: number; width: number; height: number }
): boolean {
  return (
    point.x >= rect.x &&
    point.y >= rect.y &&
    point.x < rect.x + rect.width &&
    point.y < rect.y + rect.height
  );
}

export function dragTargetAtPoint(
  inspection: TilingInspection,
  draggedWindowId: WindowId,
  point: Point
): DragTarget | undefined {
  return inspection.renderPlan.windows
    .filter(
      (plan) =>
        plan.id !== draggedWindowId &&
        plan.surfaceId === point.surfaceId &&
        contains(point, plan.frame)
    )
    .map((plan) => {
      const window = inspection.windows.find((candidate) => candidate.id === plan.id);
      const parent = inspection.containers.find((candidate) => candidate.id === window?.parentId);
      return {
        plan,
        window,
        selected: parent?.selectedChildId === window?.id ? 1 : 0,
      };
    })
    .filter(
      (candidate): candidate is typeof candidate & { window: WindowInspection } =>
        candidate.window !== undefined &&
        candidate.window.participating &&
        candidate.window.available
    )
    .sort(
      (left, right) =>
        right.selected - left.selected || left.window.id.localeCompare(right.window.id)
    )[0];
}

export function dragRegionAtPoint(point: Point, rect: PreviewPlan["rect"]): DragRegion {
  const center = {
    x: rect.x + rect.width * 0.3,
    y: rect.y + rect.height * 0.3,
    width: rect.width * 0.4,
    height: rect.height * 0.4,
  };
  if (contains(point, center)) return "center";
  if (point.x < rect.x + rect.width * 0.3) return "left";
  if (point.x >= rect.x + rect.width * 0.7) return "right";
  if (point.y < rect.y + rect.height * 0.3) return "up";
  return "down";
}

export function dragPreviewRect(
  placement: DragPlacementInspection,
  target: PreviewPlan["rect"]
): PreviewPlan["rect"] {
  const { region } = placement;
  if (placement.kind === "insert" && placement.layout === undefined) return { ...target };
  if (region === "center") return { ...target };
  if (region === "left" || region === "right") {
    const leading = Math.floor(target.width / 2);
    const width = region === "left" ? leading : target.width - leading;
    return {
      x: region === "left" ? target.x : target.x + leading,
      y: target.y,
      width,
      height: target.height,
    };
  }
  const leading = Math.floor(target.height / 2);
  const height = region === "up" ? leading : target.height - leading;
  return {
    x: target.x,
    y: region === "up" ? target.y : target.y + leading,
    width: target.width,
    height,
  };
}

export function resolveDragPlacement(
  inspection: TilingInspection,
  operation: DragOperationInspection,
  targetWindow: WindowInspection,
  region: DragRegion
): DragPlacementInspection | undefined {
  const parent = inspection.containers.find((candidate) => candidate.id === targetWindow.parentId);
  if (!parent) return undefined;
  const presentation = parent.layout === "stacked" || parent.layout === "tabbed";
  if (region === "center" && operation.centerAction === "swap") {
    return {
      kind: "swap",
      targetWindowId: targetWindow.id,
      region,
      containerId: parent.id,
    };
  }
  if (presentation) {
    if (region === "left" || region === "right") {
      const outer = parent.parentId
        ? inspection.containers.find((candidate) => candidate.id === parent.parentId)
        : undefined;
      const container = outer ?? parent;
      const anchorId = outer ? parent.id : targetWindow.id;
      const anchorIndex = container.childIds.indexOf(anchorId);
      return {
        kind: "detach",
        targetWindowId: targetWindow.id,
        region,
        containerId: container.id,
        ...(region === "left"
          ? { referenceChildId: anchorId }
          : anchorIndex + 1 < container.childIds.length
          ? { referenceChildId: container.childIds[anchorIndex + 1] }
          : {}),
        layout: "horizontal",
      };
    }
    return {
      kind: "insert",
      targetWindowId: targetWindow.id,
      region,
      containerId: parent.id,
    };
  }
  const layout =
    region === "left" || region === "right"
      ? "horizontal"
      : region === "up" || region === "down"
      ? "vertical"
      : operation.centerAction;
  if (layout === "swap" || !inspection.policy.allowedLayouts.includes(layout)) return undefined;
  const compatible = parent.layout === layout;
  if (compatible) {
    const targetIndex = parent.childIds.indexOf(targetWindow.id);
    const after = region === "right" || region === "down" || region === "center";
    return {
      kind: "insert",
      targetWindowId: targetWindow.id,
      region,
      containerId: parent.id,
      ...(after && targetIndex + 1 < parent.childIds.length
        ? { referenceChildId: parent.childIds[targetIndex + 1] }
        : !after
        ? { referenceChildId: targetWindow.id }
        : {}),
      layout,
    };
  }
  return {
    kind: "split",
    targetWindowId: targetWindow.id,
    region,
    containerId: parent.id,
    layout,
  };
}

export function sameDragPlacement(
  left: DragPlacementInspection | undefined,
  right: DragPlacementInspection | undefined
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
