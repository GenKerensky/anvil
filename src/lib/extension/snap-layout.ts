/**
 * Snap-to-fraction float layouts (LEFT / RIGHT / CENTER).
 * Pure geometry helper used by SnapLayoutMove command (B3-4).
 */

import type { RectLike } from "./tree.js";

export type SnapDirection = "LEFT" | "RIGHT" | "CENTER";

export type SnapLayoutResult = {
  rect: RectLike | { x: string; y: string; width: number; height: number };
  /** When true, apply gap processing to the rect before move. */
  processGap: boolean;
};

/**
 * Compute snap layout rect from workarea and optional current frame (CENTER).
 * `amount` is a fraction of workarea width for LEFT/RIGHT (e.g. 1/3).
 */
export function computeSnapLayout(
  direction: string,
  workarea: RectLike,
  amount: number | undefined,
  currentFrame: RectLike | null
): SnapLayoutResult | null {
  const dir = direction.toUpperCase() as SnapDirection;
  switch (dir) {
    case "LEFT":
      return {
        rect: {
          x: workarea.x,
          y: workarea.y,
          width: (amount ?? 0.5) * workarea.width,
          height: workarea.height,
        },
        processGap: true,
      };
    case "RIGHT": {
      const width = (amount ?? 0.5) * workarea.width;
      return {
        rect: {
          x: workarea.x + (workarea.width - width),
          y: workarea.y,
          width,
          height: workarea.height,
        },
        processGap: true,
      };
    }
    case "CENTER":
      if (!currentFrame) return null;
      return {
        rect: {
          x: "center",
          y: "center",
          width: currentFrame.width,
          height: currentFrame.height,
        },
        processGap: false,
      };
    default:
      return null;
  }
}
