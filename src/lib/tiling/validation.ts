import type { Rect, SurfaceFact } from "./contracts.js";

function validRect(rect: Rect): boolean {
  return (
    Number.isFinite(rect.x) &&
    Number.isFinite(rect.y) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height) &&
    rect.width > 0 &&
    rect.height > 0
  );
}

export function validateSurfaces(surfaces: readonly SurfaceFact[]): string | null {
  const ids = new Set<string>();
  for (const surface of surfaces) {
    if (ids.has(surface.id)) return `Duplicate Surface identity: ${surface.id}`;
    if (!validRect(surface.workArea)) return `Invalid Surface work area: ${surface.id}`;
    ids.add(surface.id);
  }
  for (const surface of surfaces) {
    for (const neighbor of Object.values(surface.neighbors)) {
      if (neighbor === surface.id || !ids.has(neighbor)) {
        return `Invalid Surface neighbor on ${surface.id}`;
      }
    }
  }
  return null;
}
