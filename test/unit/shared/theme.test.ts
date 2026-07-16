import { describe, it, expect, vi } from "vitest";
import { ThemeManagerBase } from "../../../src/lib/shared/theme.js";

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

    expect(manager.getCssProperty(".existing", "color")?.value).toBe("blue");
    expect(manager.setCssProperty(".existing", "color", "green")).toBe(false);
    expect(overrideFile.replace_contents).not.toHaveBeenCalled();
  });
});
