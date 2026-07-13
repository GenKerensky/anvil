import type {
  ContainerId,
  Layout,
  OperationId,
  Rect,
  SurfaceId,
  TilingInspection,
  WindowId,
} from "../tiling/index.js";

export type GnomePresentationPlan = Readonly<{
  revision: number;
  surfaces: readonly Readonly<{ id: SurfaceId; workArea: Rect }>[];
  containers: readonly Readonly<{
    id: ContainerId;
    surfaceId: SurfaceId;
    parentId?: ContainerId;
    rect: Rect;
    layout: Layout;
    selectedChildId?: ContainerId | WindowId;
    stackingOrder: readonly (ContainerId | WindowId)[];
  }>[];
  windows: readonly Readonly<{
    id: WindowId;
    surfaceId: SurfaceId;
    parentId?: ContainerId;
    frame: Rect;
    parentLayout?: Layout;
    selected: boolean;
  }>[];
  previews: readonly Readonly<{
    operationId: OperationId;
    surfaceId: SurfaceId;
    rect: Rect;
  }>[];
}>;

function globalRect(
  surfaceId: SurfaceId,
  rect: Rect,
  surfaceOrigins: ReadonlyMap<SurfaceId, Readonly<{ x: number; y: number }>>
): Rect {
  const origin = surfaceOrigins.get(surfaceId);
  if (!origin) throw new Error(`missing GNOME origin for ${surfaceId}`);
  return {
    x: rect.x + origin.x,
    y: rect.y + origin.y,
    width: rect.width,
    height: rect.height,
  };
}

function isPresented(inspection: TilingInspection, windowId: WindowId): boolean {
  let childId: ContainerId | WindowId = windowId;
  let parentId = inspection.windows.find((window) => window.id === windowId)?.parentId;
  while (parentId) {
    const parent = inspection.containers.find((container) => container.id === parentId);
    if (!parent) return false;
    if (
      (parent.layout === "stacked" || parent.layout === "tabbed") &&
      parent.selectedChildId !== childId
    ) {
      return false;
    }
    childId = parent.id;
    parentId = parent.parentId;
  }
  return true;
}

export function createGnomePresentationPlan(
  inspection: TilingInspection,
  surfaceOrigins: ReadonlyMap<SurfaceId, Readonly<{ x: number; y: number }>>
): GnomePresentationPlan {
  return {
    revision: inspection.revision,
    surfaces: inspection.renderPlan.surfaces.map((surface) => ({
      id: surface.id,
      workArea: globalRect(surface.id, surface.workArea, surfaceOrigins),
    })),
    containers: inspection.renderPlan.containers.map((container) => {
      const topology = inspection.containers.find((candidate) => candidate.id === container.id);
      return {
        id: container.id,
        surfaceId: container.surfaceId,
        ...(topology?.parentId ? { parentId: topology.parentId } : {}),
        rect: globalRect(container.surfaceId, container.rect, surfaceOrigins),
        layout: container.layout,
        ...(container.selectedChildId ? { selectedChildId: container.selectedChildId } : {}),
        stackingOrder: [...container.stackingOrder],
      };
    }),
    windows: inspection.renderPlan.windows.map((window) => {
      const topology = inspection.windows.find((candidate) => candidate.id === window.id);
      const parent = inspection.containers.find((candidate) => candidate.id === topology?.parentId);
      return {
        id: window.id,
        surfaceId: window.surfaceId,
        ...(topology?.parentId ? { parentId: topology.parentId } : {}),
        frame: globalRect(window.surfaceId, window.frame, surfaceOrigins),
        ...(parent ? { parentLayout: parent.layout } : {}),
        selected: isPresented(inspection, window.id),
      };
    }),
    previews: inspection.renderPlan.previews.map((preview) => ({
      operationId: preview.operationId,
      surfaceId: preview.surfaceId,
      rect: globalRect(preview.surfaceId, preview.rect, surfaceOrigins),
    })),
  };
}
