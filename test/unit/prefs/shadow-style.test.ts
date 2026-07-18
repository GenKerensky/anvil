import { describe, expect, it } from "vitest";

import {
  formatBoxShadow,
  parseBoxShadow,
  type ShadowStyle,
} from "../../../src/lib/prefs/shadow-style.js";

describe("shadow style", () => {
  it("parses the canonical focused shadow", () => {
    expect(parseBoxShadow("0 4px 18px 2px rgba(0, 0, 0, 0.35)")).toEqual({
      xOffset: 0,
      yOffset: 4,
      blurRadius: 18,
      spreadRadius: 2,
      color: "rgba(0, 0, 0, 0.35)",
    });
  });

  it("accepts signed and fractional offsets", () => {
    expect(parseBoxShadow("-2.5px 3px 12px -1px #0008")).toEqual({
      xOffset: -2.5,
      yOffset: 3,
      blurRadius: 12,
      spreadRadius: -1,
      color: "#0008",
    });
  });

  it("rejects unsupported or incomplete values", () => {
    expect(parseBoxShadow("none")).toBeNull();
    expect(parseBoxShadow("0 4px 18px rgba(0, 0, 0, 0.35)")).toBeNull();
    expect(parseBoxShadow("0 4px -2px 2px red")).toBeNull();
    expect(parseBoxShadow("0 4px 18px 2px not-a-color")).toBeNull();
    expect(parseBoxShadow("0 4px 18px 2px red, 0 0 2px blue")).toBeNull();
  });

  it("formats a style as editable CSS", () => {
    const style: ShadowStyle = {
      xOffset: -1,
      yOffset: 5,
      blurRadius: 20,
      spreadRadius: 3,
      color: "rgba(10, 20, 30, 0.4)",
    };

    expect(formatBoxShadow(style)).toBe("-1px 5px 20px 3px rgba(10, 20, 30, 0.4)");
  });
});
