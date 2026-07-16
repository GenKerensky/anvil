import { describe, it, expect, vi } from "vitest";
import { RGBAToHexA, ThemeManagerBase, hexAToRGBA } from "../../../src/lib/shared/theme.js";

function cssFile(path: string, contents: string, replaceSucceeds = true) {
  let bytes = new TextEncoder().encode(contents);
  return {
    get_path: () => path,
    query_exists: () => true,
    load_contents: vi.fn(() => [true, bytes.slice(), `${path}:1`]),
    replace_contents: vi.fn((next: Uint8Array | string) => {
      if (!replaceSucceeds) return [false, null];
      bytes = typeof next === "string" ? new TextEncoder().encode(next) : next.slice();
      return [true, `${path}:2`];
    }),
  };
}

class TestThemeManager extends ThemeManagerBase {
  reloadStylesheet = vi.fn(() => true);
}

function managerFixture({
  shipped = `.existing { color: blue; }\n.new-selector { border-width: 2px; }\n`,
  user = `.existing { color: magenta; }\n`,
  replaceSucceeds = true,
}: { shipped?: string; user?: string; replaceSucceeds?: boolean } = {}) {
  const baseFile = cssFile("/extension/stylesheet.css", shipped);
  const overrideFile = cssFile("/config/stylesheet.css", user, replaceSucceeds);
  const migration = {
    initialize: vi.fn(() => ({
      status: "current",
      usable: true,
      baseFile,
      overrideFile,
      contentsChanged: false,
      stateCommitted: true,
    })),
  };
  const configMgr = {
    defaultStylesheetFile: baseFile,
    userStylesheetFile: overrideFile,
    stylesheetFile: overrideFile,
  };
  const manager = new TestThemeManager({
    configMgr: configMgr as any,
    settings: {} as any,
    migrationService: migration as any,
  });
  return { manager, migration, baseFile, overrideFile };
}

describe("ThemeManagerBase stylesheet lifecycle", () => {
  it("performs no file IO or migration during construction", () => {
    const { migration, baseFile, overrideFile } = managerFixture();

    expect(migration.initialize).not.toHaveBeenCalled();
    expect(baseFile.load_contents).not.toHaveBeenCalled();
    expect(overrideFile.load_contents).not.toHaveBeenCalled();
  });

  it("explicitly initializes shipped CSS beneath user overrides", () => {
    const { manager } = managerFixture();

    const result = manager.initializeStylesheet();

    expect(result?.usable).toBe(true);
    expect(manager.getCssProperty(".existing", "color")?.value).toBe("magenta");
    expect(manager.getCssProperty(".new-selector", "border-width")?.value).toBe("2px");
  });

  it("derives reset defaults from shipped CSS rather than user overrides", () => {
    const { manager } = managerFixture({
      shipped: `.tiled { color: blue; border-width: 3px; opacity: 1; }\n.split { color: blue; border-width: 3px; opacity: 1; }\n.floated { color: blue; border-width: 3px; opacity: 1; }\n.stacked { color: blue; border-width: 3px; opacity: 1; }\n.tabbed { color: blue; border-width: 3px; opacity: 1; }\n`,
      user: `.tiled { color: magenta; border-width: 5px; opacity: 0.5; }\n`,
    });

    manager.initializeStylesheet();

    expect(manager.defaultPalette.tiled).toEqual({
      color: "blue",
      "border-width": "3",
      opacity: "1",
    });
  });

  it("materializes a user override when a selector exists only in shipped CSS", () => {
    const { manager, overrideFile } = managerFixture();
    manager.initializeStylesheet();

    expect(manager.setCssProperty(".new-selector", "border-width", "7px")).toBe(true);

    const written = String(overrideFile.replace_contents.mock.calls[0][0]);
    expect(written).toContain(".new-selector");
    expect(written).toContain("border-width: 7px");
    expect(manager.reloadStylesheet).toHaveBeenCalledOnce();
  });

  it("does not emit a reload or overwrite bytes when an etag-checked write fails", () => {
    const { manager, overrideFile } = managerFixture({ replaceSucceeds: false });
    manager.initializeStylesheet();

    expect(manager.setCssProperty(".existing", "color", "green")).toBe(false);
    expect(overrideFile.replace_contents).toHaveBeenCalledOnce();
    expect(manager.reloadStylesheet).not.toHaveBeenCalled();
    expect(manager.getCssProperty(".existing", "color")?.value).toBe("magenta");
  });

  it("keeps a successful file write when only the reload notification fails", () => {
    const { manager, overrideFile } = managerFixture();
    manager.initializeStylesheet();
    manager.reloadStylesheet.mockReturnValue(false);

    expect(manager.setCssProperty(".existing", "color", "green")).toBe(true);
    expect(overrideFile.replace_contents).toHaveBeenCalledOnce();
    expect(manager.getCssProperty(".existing", "color")?.value).toBe("green");
  });

  it("keeps malformed user CSS read-only while retaining shipped values", () => {
    const malformed = `.existing { color: magenta;`;
    const { manager, overrideFile } = managerFixture({ user: malformed });

    manager.initializeStylesheet();

    expect(manager.isStylesheetEditable).toBe(false);
    expect(manager.getCssProperty(".existing", "color")?.value).toBe("blue");
    expect(manager.setCssProperty(".existing", "color", "green")).toBe(false);
    expect(overrideFile.replace_contents).not.toHaveBeenCalled();
  });
});

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
