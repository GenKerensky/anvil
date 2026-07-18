import { describe, expect, it, vi } from "vitest";
import St from "gi://St";

import { ExtensionThemeManager } from "../../../src/lib/extension/extension-theme-manager.js";

function file(path: string, contents = `.rule { color: red; }\n`) {
  return {
    get_path: () => path,
    query_exists: () => true,
    load_contents: vi.fn(() => [true, new TextEncoder().encode(contents), `${path}:1`]),
  };
}

function fixture() {
  const baseFile = file("/extension/stylesheet.css");
  const overrideFile = file("/config/stylesheet.css", `.rule { color: blue; }\n`);
  const migrationService = {
    initialize: vi.fn(() => ({
      status: "current",
      usable: true,
      baseFile,
      overrideFile,
      contentsChanged: false,
      stateCommitted: true,
    })),
  };
  const theme = {
    load_stylesheet: vi.fn((_loaded: unknown) => true),
    unload_stylesheet: vi.fn(),
  };
  vi.spyOn(St.ThemeContext, "get_for_stage").mockReturnValue({
    get_theme: () => theme,
  } as any);
  const manager = new ExtensionThemeManager({
    metadata: { uuid: "anvil@test" },
    configMgr: {
      defaultStylesheetFile: baseFile,
      userStylesheetFile: overrideFile,
    },
    settings: {},
    migrationService,
  } as any);
  manager.initializeStylesheet();
  return { manager, theme, baseFile, overrideFile };
}

describe("ExtensionThemeManager", () => {
  it("loads only the complete user stylesheet when it is available", () => {
    const { manager, theme, baseFile, overrideFile } = fixture();

    expect(manager.reloadStylesheet()).toBe(true);

    expect(theme.load_stylesheet.mock.calls.map(([loaded]) => loaded)).toEqual([overrideFile]);
    expect(theme.unload_stylesheet).toHaveBeenCalledWith(baseFile);
    expect(manager.stylesheets).toEqual([overrideFile]);
  });

  it("keeps the shipped base active when loading the user override throws", () => {
    const { manager, theme, baseFile, overrideFile } = fixture();
    theme.load_stylesheet.mockImplementation((loaded) => {
      if (loaded === overrideFile) throw new Error("invalid user css");
      return true;
    });

    expect(manager.reloadStylesheet()).toBe(true);
    expect(manager.stylesheets).toEqual([baseFile]);
  });

  it("keeps the shipped base active when St rejects the user override", () => {
    const { manager, theme, baseFile, overrideFile } = fixture();
    theme.load_stylesheet.mockImplementation((loaded) => loaded !== overrideFile);

    expect(manager.reloadStylesheet()).toBe(true);
    expect(manager.stylesheets).toEqual([baseFile]);
  });

  it("reports failure when St rejects both user and shipped stylesheets", () => {
    const { manager, theme } = fixture();
    theme.load_stylesheet.mockReturnValue(false);

    expect(manager.reloadStylesheet()).toBe(false);
    expect(manager.stylesheets).toEqual([]);
  });

  it("unloads only previously loaded files before a repeated reload", () => {
    const { manager, theme, baseFile, overrideFile } = fixture();
    manager.reloadStylesheet();
    manager.reloadStylesheet();

    expect(theme.unload_stylesheet.mock.calls.map(([loaded]) => loaded)).toEqual([
      baseFile,
      overrideFile,
    ]);
  });

  it("unloads every active layer when the extension is disabled", () => {
    const { manager, theme, baseFile, overrideFile } = fixture();
    manager.reloadStylesheet();

    manager.unloadStylesheets();

    expect(theme.unload_stylesheet.mock.calls.map(([loaded]) => loaded)).toEqual([
      baseFile,
      overrideFile,
    ]);
    expect(manager.stylesheets).toEqual([]);
    expect(manager.stylesheet).toBeNull();
  });

  it("retains failed unloads and retries them before loading replacement layers", () => {
    const { manager, theme, baseFile, overrideFile } = fixture();
    manager.reloadStylesheet();
    theme.unload_stylesheet.mockImplementationOnce(() => {
      throw new Error("temporary St failure");
    });

    expect(manager.reloadStylesheet()).toBe(false);
    expect(manager.stylesheets).toEqual([overrideFile]);
    expect(manager.stylesheet).toBe(overrideFile);
    expect(theme.load_stylesheet).toHaveBeenCalledTimes(1);

    expect(manager.reloadStylesheet()).toBe(true);
    expect(theme.unload_stylesheet.mock.calls.map(([loaded]) => loaded)).toEqual([
      baseFile,
      overrideFile,
      overrideFile,
    ]);
    expect(manager.stylesheets).toEqual([overrideFile]);
  });

  it("refreshes a fallback selection when a user override becomes available", () => {
    const { manager, theme, baseFile, overrideFile } = fixture();
    const initialize = vi.spyOn(manager, "initializeStylesheet");
    manager.lastMigrationResult = {
      status: "fallback",
      usable: true,
      baseFile: baseFile as any,
      overrideFile: null,
      contentsChanged: false,
      stateCommitted: false,
    };
    manager.reloadStylesheet();
    theme.load_stylesheet.mockClear();

    expect(manager.refreshStylesheet()).toBe(true);

    expect(initialize).toHaveBeenCalledOnce();
    expect(theme.load_stylesheet.mock.calls.map(([loaded]) => loaded)).toEqual([overrideFile]);
  });
});
