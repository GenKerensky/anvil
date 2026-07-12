export interface WindowMaskPolicy {
  hintsEnabled: boolean;
  maximized: boolean;
  fullscreen: boolean;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Radius at the window edge after accounting for the border actor's outer inset. */
export function deriveWindowMaskRadius(borderRadius: number, borderInset: number): number {
  return Math.max(0, borderRadius - borderInset);
}

/** Visible frame bounds expressed in the window buffer's local coordinates. */
export function getWindowMaskBounds(frame: Rect, buffer: Rect): [number, number, number, number] {
  const left = frame.x - buffer.x;
  const top = frame.y - buffer.y;
  return [left, top, left + frame.width, top + frame.height];
}

export function shouldMaskWindow(policy: WindowMaskPolicy): boolean {
  return policy.hintsEnabled && !policy.maximized && !policy.fullscreen;
}
