import { describe, expect, it } from "vitest";

import {
  deriveWindowMaskRadius,
  getWindowMaskBounds,
  shouldMaskWindow,
} from "../../../src/lib/extension/window-corner-mask.js";

describe("window corner mask policy", () => {
  it("aligns the window crop with the border's inner curve", () => {
    expect(deriveWindowMaskRadius(18, 3)).toBe(15);
    expect(deriveWindowMaskRadius(2, 3)).toBe(0);
  });

  it("maps the visible frame into buffer-local coordinates", () => {
    expect(
      getWindowMaskBounds(
        { x: 12, y: 24, width: 96, height: 72 },
        { x: 8, y: 20, width: 104, height: 80 }
      )
    ).toEqual([4, 4, 100, 76]);
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
