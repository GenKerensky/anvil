import { describe, it, expect } from "vitest";
import { RGBAToHexA, hexAToRGBA } from "../../../src/lib/shared/theme.js";

describe("RGBAToHexA", () => {
  it("converts comma-separated rgba to hex with alpha", () => {
    const result: string = RGBAToHexA("rgba(255,128,0,1)");
    expect(result).toBe("#ff8000ff");
  });

  it("converts comma-separated rgba with fractional alpha", () => {
    const result: string = RGBAToHexA("rgba(255,0,0,0.5)");
    expect(result).toBe("#ff000080");
  });

  it("converts space-separated rgba values", () => {
    const result: string = RGBAToHexA("rgba(100 200 50 / 0.8)");
    expect(result).toBe("#64c832cc");
  });

  it("converts percentage values for RGB channels", () => {
    const result: string = RGBAToHexA("rgba(100%,50%,0%,1)");
    expect(result).toBe("#ff8000ff");
  });

  it("zero-pads single-digit hex channels", () => {
    const result: string = RGBAToHexA("rgba(0,0,0,0.05)");
    expect(result).toBe("#0000000d");
  });

  it("handles all channels needing zero-padding", () => {
    const result: string = RGBAToHexA("rgba(1,2,3,0.004)");
    expect(result).toBe("#01020301");
  });

  it("converts white with full opacity", () => {
    const result: string = RGBAToHexA("rgba(255,255,255,1)");
    expect(result).toBe("#ffffffff");
  });

  it("converts black with zero opacity", () => {
    const result: string = RGBAToHexA("rgba(0,0,0,0)");
    expect(result).toBe("#00000000");
  });

  it("handles mid-range values correctly", () => {
    const result: string = RGBAToHexA("rgba(128,64,32,0.75)");
    expect(result).toBe("#804020bf");
  });
});

describe("hexAToRGBA", () => {
  it("converts 5-char shorthand hex to rgba", () => {
    // #f00f -> r=0xff, g=0x00, b=0x00, a=0xff
    const result: string = hexAToRGBA("#f00f");
    expect(result).toBe("rgba(255,0,0,1)");
  });

  it("converts 5-char shorthand hex with partial alpha", () => {
    // #f808 -> r=0xff, g=0x88, b=0x00, a=0x88
    const result: string = hexAToRGBA("#f808");
    expect(result).toBe("rgba(255,136,0," + (0x88 / 255).toFixed(3) + ")");
  });

  it("converts 9-char full hex to rgba", () => {
    const result: string = hexAToRGBA("#ff8000ff");
    expect(result).toBe("rgba(255,128,0,1)");
  });

  it("converts 9-char full hex with partial alpha", () => {
    const result: string = hexAToRGBA("#ff000080");
    expect(result).toBe("rgba(255,0,0," + (0x80 / 255).toFixed(3) + ")");
  });

  it("converts black with zero alpha", () => {
    const result: string = hexAToRGBA("#00000000");
    expect(result).toBe("rgba(0,0,0,0)");
  });

  it("converts white with full alpha", () => {
    const result: string = hexAToRGBA("#ffffffff");
    expect(result).toBe("rgba(255,255,255,1)");
  });

  it("handles shorthand #0000 (all zeros)", () => {
    const result: string = hexAToRGBA("#0000");
    expect(result).toBe("rgba(0,0,0,0)");
  });

  it("handles shorthand #ffff (all max)", () => {
    const result: string = hexAToRGBA("#ffff");
    expect(result).toBe("rgba(255,255,255,1)");
  });
});

describe("round-trip conversions", () => {
  it("RGBAToHexA -> hexAToRGBA produces consistent results", () => {
    const originalRgba = "rgba(128,64,32,1)";
    const hex: string = RGBAToHexA(originalRgba);
    const backToRgba: string = hexAToRGBA(hex);
    expect(backToRgba).toBe("rgba(128,64,32,1)");
  });

  it("hexAToRGBA -> RGBAToHexA produces consistent results", () => {
    const originalHex = "#ff8040ff";
    const rgba: string = hexAToRGBA(originalHex);
    const backToHex: string = RGBAToHexA(rgba);
    expect(backToHex).toBe(originalHex);
  });

  it("round-trip preserves values for mid-alpha", () => {
    const originalHex = "#aabbcc80";
    const rgba: string = hexAToRGBA(originalHex);
    const backToHex: string = RGBAToHexA(rgba);
    expect(backToHex).toBe(originalHex);
  });
});
