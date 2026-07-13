import { describe, expect, it } from "vitest";

import {
  deriveWindowMaskRadius,
  getWindowMaskBounds,
  mapWindowMaskToOffscreen,
  shouldMaskWindow,
} from "../../../src/lib/extension/window-corner-mask.js";

describe("window corner mask policy", () => {
  it("keeps the border and window corner circles concentric", () => {
    const borderRadius = 18;
    const borderInset = 3;
    const maskRadius = deriveWindowMaskRadius(borderRadius, borderInset);

    expect(maskRadius).toBe(15);
    expect(-borderInset + borderRadius).toBe(maskRadius);
    expect(deriveWindowMaskRadius(0, 3)).toBe(0);
    expect(deriveWindowMaskRadius(2, 3)).toBe(0);
    expect(deriveWindowMaskRadius(18, -3)).toBe(18);
  });

  it("maps the visible frame into window actor coordinates", () => {
    expect(getWindowMaskBounds({ x: 12, y: 24, width: 96, height: 72 }, { x: 8, y: 20 })).toEqual([
      4, 4, 100, 76,
    ]);
  });

  it("accounts for Clutter's asymmetric offscreen-effect padding", () => {
    expect(
      mapWindowMaskToOffscreen(
        [10, 10, 1274, 762],
        { width: 1284, height: 772 },
        { width: 1287, height: 775 },
        1
      )
    ).toEqual({
      bounds: [12, 12, 1276, 764],
      pixelStep: [1 / 1287, 1 / 775],
    });
  });

  it("derives the same logical padding at a scaled resource size", () => {
    expect(
      mapWindowMaskToOffscreen(
        [10, 10, 1274, 762],
        { width: 1284, height: 772 },
        { width: 2574, height: 1550 },
        2
      ).bounds
    ).toEqual([12, 12, 1276, 764]);
  });

  it("masks normal windows only while window hints are enabled", () => {
    expect(shouldMaskWindow({ hintsEnabled: true, maximized: false, fullscreen: false })).toBe(
      true
    );
    expect(shouldMaskWindow({ hintsEnabled: false, maximized: false, fullscreen: false })).toBe(
      false
    );
    expect(shouldMaskWindow({ hintsEnabled: true, maximized: true, fullscreen: false })).toBe(
      false
    );
    expect(shouldMaskWindow({ hintsEnabled: true, maximized: false, fullscreen: true })).toBe(
      false
    );
  });
});
