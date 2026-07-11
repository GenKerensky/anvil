/*
 * GrabResizeSession pure unit tests — percent delta math.
 */

import { describe, it, expect } from "vitest";
import { percentsFromSizeDelta } from "../../../src/lib/extension/grab-resize-session.js";

describe("percentsFromSizeDelta", () => {
  it("updates sibling percents from a positive width delta", () => {
    const { firstPercent, secondPercent } = percentsFromSizeDelta({
      firstSize: 500,
      secondSize: 500,
      parentSize: 1000,
      changePx: 100,
    });
    expect(firstPercent).toBeCloseTo(0.6);
    expect(secondPercent).toBeCloseTo(0.4);
  });

  it("updates sibling percents from a negative delta", () => {
    const { firstPercent, secondPercent } = percentsFromSizeDelta({
      firstSize: 500,
      secondSize: 500,
      parentSize: 1000,
      changePx: -100,
    });
    expect(firstPercent).toBeCloseTo(0.4);
    expect(secondPercent).toBeCloseTo(0.6);
  });

  it("returns zeros when parentSize is non-positive", () => {
    expect(
      percentsFromSizeDelta({
        firstSize: 10,
        secondSize: 10,
        parentSize: 0,
        changePx: 5,
      })
    ).toEqual({ firstPercent: 0, secondPercent: 0 });
  });
});
