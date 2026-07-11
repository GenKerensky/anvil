import { describe, it, expect } from "vitest";
import { computeSnapLayout } from "../../../src/lib/extension/snap-layout.js";

const workarea = { x: 0, y: 0, width: 1920, height: 1080 };

describe("computeSnapLayout", () => {
  it("LEFT uses amount fraction of workarea", () => {
    const r = computeSnapLayout("Left", workarea, 1 / 3, null);
    expect(r?.processGap).toBe(true);
    expect(r?.rect).toEqual({
      x: 0,
      y: 0,
      width: 640,
      height: 1080,
    });
  });

  it("RIGHT anchors to right edge", () => {
    const r = computeSnapLayout("RIGHT", workarea, 2 / 3, null);
    expect(r?.rect).toEqual({
      x: 640,
      y: 0,
      width: 1280,
      height: 1080,
    });
  });

  it("CENTER keeps frame size and symbolic position", () => {
    const r = computeSnapLayout("Center", workarea, undefined, {
      x: 10,
      y: 20,
      width: 400,
      height: 300,
    });
    expect(r?.processGap).toBe(false);
    expect(r?.rect).toEqual({
      x: "center",
      y: "center",
      width: 400,
      height: 300,
    });
  });

  it("unknown direction returns null", () => {
    expect(computeSnapLayout("Up", workarea, 0.5, null)).toBeNull();
  });
});
