/*
 * GrabResizeSession pure unit tests — percent delta math.
 */

import Meta from "gi://Meta";
import { describe, it, expect, vi } from "vitest";
import type { Node } from "../../../src/lib/extension/tree.js";
import {
  findEligibleResizePair,
  percentsFromSizeDelta,
} from "../../../src/lib/extension/grab-resize-session.js";

function node(name: string): Node {
  return { nodeValue: name } as unknown as Node;
}

describe("findEligibleResizePair", () => {
  it.each([Meta.MotionDirection.RIGHT, Meta.MotionDirection.DOWN])(
    "skips unavailable candidates along direction %s",
    (direction) => {
      const focus = node("focus");
      const floating = node("floating");
      const minimized = node("minimized");
      const eligible = node("eligible");
      const nextVisible = vi.fn((current: Node) => {
        if (current === focus) return floating;
        if (current === floating) return minimized;
        if (current === minimized) return eligible;
        return null;
      });

      expect(
        findEligibleResizePair({
          focusNode: focus,
          direction,
          nextVisible,
          isEligible: (candidate) => candidate === eligible,
        })
      ).toBe(eligible);
      expect(nextVisible).toHaveBeenCalledTimes(3);
    }
  );

  it("returns null when no participating candidate exists", () => {
    const focus = node("focus");
    const unavailable = node("unavailable");

    expect(
      findEligibleResizePair({
        focusNode: focus,
        direction: Meta.MotionDirection.LEFT,
        nextVisible: (current) => (current === focus ? unavailable : null),
        isEligible: () => false,
      })
    ).toBeNull();
  });

  it("stops at a surface boundary instead of walking onto another monitor", () => {
    const focus = node("focus");
    const monitor = node("monitor");
    const remote = node("remote");
    const nextVisible = vi.fn((current: Node) => (current === focus ? monitor : remote));

    expect(
      findEligibleResizePair({
        focusNode: focus,
        direction: Meta.MotionDirection.RIGHT,
        nextVisible,
        isBoundary: (candidate) => candidate === monitor,
        isEligible: (candidate) => candidate === remote,
      })
    ).toBeNull();
    expect(nextVisible).toHaveBeenCalledOnce();
  });

  it("selects an eligible nested container", () => {
    const focus = node("focus");
    const container = node("container");

    expect(
      findEligibleResizePair({
        focusNode: focus,
        direction: Meta.MotionDirection.LEFT,
        nextVisible: (current) => (current === focus ? container : null),
        isEligible: (candidate) => candidate === container,
      })
    ).toBe(container);
  });

  it("terminates when a malformed traversal cycles", () => {
    const focus = node("focus");
    const unavailable = node("unavailable");

    expect(
      findEligibleResizePair({
        focusNode: focus,
        direction: Meta.MotionDirection.UP,
        nextVisible: () => unavailable,
        isEligible: () => false,
      })
    ).toBeNull();
  });
});

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
