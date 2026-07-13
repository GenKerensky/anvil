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

interface Point {
  x: number;
  y: number;
}

interface Size {
  width: number;
  height: number;
}

export interface OffscreenMaskGeometry {
  bounds: [number, number, number, number];
  pixelStep: [number, number];
}

/** Translate the border's outer radius into window-local space without moving its center. */
export function deriveWindowMaskRadius(borderRadius: number, borderInset: number): number {
  return Math.max(0, borderRadius - Math.max(0, borderInset));
}

/** Visible frame bounds expressed in the window actor's local coordinates. */
export function getWindowMaskBounds(frame: Rect, origin: Point): [number, number, number, number] {
  const left = frame.x - origin.x;
  const top = frame.y - origin.y;
  return [left, top, left + frame.width, top + frame.height];
}

/**
 * Translate actor-local geometry into Clutter's padded offscreen texture.
 *
 * Mutter stabilizes effect framebuffers by adding three logical pixels around
 * an integer-aligned paint volume: two on the top/left and one on the
 * bottom/right. Deriving the leading inset from the actual target size keeps
 * the mask aligned if that implementation detail or the resource scale changes.
 */
export function mapWindowMaskToOffscreen(
  bounds: [number, number, number, number],
  actorSize: Size,
  targetSize: Size,
  resourceScale: number
): OffscreenMaskGeometry {
  const scale = Math.max(1, resourceScale);
  const targetWidth = targetSize.width / scale;
  const targetHeight = targetSize.height / scale;
  const leadingInsetX = Math.ceil(Math.max(0, targetWidth - actorSize.width) / 2);
  const leadingInsetY = Math.ceil(Math.max(0, targetHeight - actorSize.height) / 2);

  return {
    bounds: [
      bounds[0] + leadingInsetX,
      bounds[1] + leadingInsetY,
      bounds[2] + leadingInsetX,
      bounds[3] + leadingInsetY,
    ],
    pixelStep: [targetWidth > 0 ? 1 / targetWidth : 1, targetHeight > 0 ? 1 / targetHeight : 1],
  };
}

export function shouldMaskWindow(policy: WindowMaskPolicy): boolean {
  return policy.hintsEnabled && !policy.maximized && !policy.fullscreen;
}
