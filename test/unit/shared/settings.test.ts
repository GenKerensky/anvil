/**
 * Unit tests for ConfigManager (file I/O and config loading)
 * Ported from jcrussell/forge
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ConfigManager, isWindowConfig, production } from "../../../src/lib/shared/settings.js";
import { Logger } from "../../../src/lib/shared/logger.js";
import Gio from "gi://Gio";

const sampleWindowConfig = {
  overrides: [
    { wmClass: "Firefox", wmTitle: "Picture-in-Picture", mode: "float" },
    { wmClass: "Terminal", mode: "tile" },
  ],
};

function createMockDir(path = "/mock/extension") {
  return {
    get_path: () => path,
  } as any;
}

function createMockFile(path: string, options: Record<string, any> = {}) {
  const file: any = Gio.File.new_for_path(path);

  if (options.exists !== undefined) {
    file.query_exists = vi.fn(() => options.exists);
  }

  if (options.contents !== undefined) {
    const encoded = new TextEncoder().encode(options.contents);
    file.load_contents = vi.fn(() => [true, encoded, null]);
  }

  if (options.loadFails) {
    file.load_contents = vi.fn(() => [false, null, null]);
  }

  file.replace_contents = vi.fn(() => [true, null]);
  file.make_directory_with_parents = vi.fn(() => true);
  file.create = vi.fn(() => ({
    write_all: vi.fn(() => [true, 0]),
    close: vi.fn(() => true),
  }));

  return file;
}

describe("production constant", () => {
  it("should be exported", () => {
    expect(production).toBeDefined();
  });

  it("should be a boolean", () => {
    expect(typeof production).toBe("boolean");
  });
});

describe("isWindowConfig", () => {
  it("accepts a valid override configuration", () => {
    expect(isWindowConfig(sampleWindowConfig)).toBe(true);
  });

  it.each([
    null,
    {},
    { overrides: "not-an-array" },
    { overrides: [null] },
    { overrides: [{ mode: "float" }] },
    { overrides: [{ wmClass: "Firefox" }] },
    { overrides: [{ wmClass: "", mode: "float" }] },
    { overrides: [{ wmClass: "Firefox", mode: "unknown" }] },
  ])("rejects invalid configuration %#", (value) => {
    expect(isWindowConfig(value)).toBe(false);
  });
});

describe("ConfigManager", () => {
  let configManager: ConfigManager;
  let mockDir: any;

  beforeEach(() => {
    mockDir = createMockDir("/test/extension/path");
    configManager = new ConfigManager({ dir: mockDir });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("constructor", () => {
    it("should store extensionPath from dir", () => {
      expect(configManager.extensionPath).toBe("/test/extension/path");
    });

    it("should work with different extension paths", () => {
      const otherDir = createMockDir("/other/path");
      const cm = new ConfigManager({ dir: otherDir });
      expect(cm.extensionPath).toBe("/other/path");
    });
  });

  describe("confDir", () => {
    it("should return anvil config directory under user config", () => {
      const confDir = configManager.confDir;
      expect(confDir).toContain("anvil");
      expect(confDir).toContain("mock-config");
    });

    it("should be consistent across calls", () => {
      const first = configManager.confDir;
      const second = configManager.confDir;
      expect(first).toBe(second);
    });
  });

  describe("defaultStylesheetFile", () => {
    it("should return file when stylesheet exists", () => {
      const file = configManager.defaultStylesheetFile;
      expect(file).not.toBeNull();
    });

    it("should look for stylesheet.css in extension path", () => {
      const file = configManager.defaultStylesheetFile;
      expect(file!.get_path()).toContain("stylesheet.css");
      expect(file!.get_path()).toContain(configManager.extensionPath);
    });
  });

  describe("stylesheet paths", () => {
    it("provides stable user and versioned backup paths without IO", () => {
      const user = configManager.userStylesheetFile;
      const backup = configManager.stylesheetBackupFile(38, "abcdef0123456789");
      const temporary = configManager.stylesheetTemporaryFile("unique-token");

      expect(user.get_path()).toMatch(/stylesheet\/anvil\/stylesheet\.css$/);
      expect(backup.get_path()).toBe(`${user.get_path()}.bak-v38-abcdef012345`);
      expect(temporary.get_path()).toBe(`${user.get_path()}.tmp-unique-token`);
    });
  });

  describe("defaultWindowConfigFile", () => {
    it("should return file when config exists", () => {
      const file = configManager.defaultWindowConfigFile;
      expect(file).not.toBeNull();
    });

    it("should look for windows.json in config directory", () => {
      const file = configManager.defaultWindowConfigFile;
      expect(file!.get_path()).toContain("windows.json");
      expect(file!.get_path()).toContain("config");
    });
  });

  describe("windowConfigFile", () => {
    it("should attempt to load custom window config", () => {
      const file = configManager.windowConfigFile;
      expect(file).toBeDefined();
    });
  });

  describe("loadFile", () => {
    it("should return existing custom file", () => {
      const customPath = "/custom/path";
      const fileName = "test.json";
      const defaultFile = createMockFile("/default/test.json");

      const result = configManager.loadFile(customPath, fileName, defaultFile);
      expect(result).not.toBeNull();
    });

    it("should return null when custom file does not exist and dir creation fails", () => {
      const defaultImpl = (Gio.File.new_for_path as any).getMockImplementation();
      let callCount = 0;

      (Gio.File.new_for_path as any).mockImplementation((path: string) => {
        callCount++;
        const file = defaultImpl!(path) as any;
        if (callCount === 1) {
          file.query_exists = vi.fn(() => false);
        }
        if (callCount === 2) {
          file.query_exists = vi.fn(() => false);
          file.make_directory_with_parents = vi.fn(() => false);
        }
        return file;
      });

      const result = configManager.loadFile("/custom", "file.json", null);
      expect(result).toBeNull();

      (Gio.File.new_for_path as any).mockReset();
      if (defaultImpl) (Gio.File.new_for_path as any).mockImplementation(defaultImpl);
    });

    it("should create directory and file when neither exists", () => {
      const mockStream = {
        write_all: vi.fn(() => [true, 0]),
        close: vi.fn(() => true),
      };

      const defaultFile = createMockFile("/default/file.json", {
        contents: '{"test": true}',
      });

      const defaultImpl = (Gio.File.new_for_path as any).getMockImplementation();
      (Gio.File.new_for_path as any).mockImplementation((path: string) => {
        const file = defaultImpl!(path) as any;
        if (path.endsWith("/custom/file.json")) {
          file.query_exists = vi.fn(() => false);
          file.create = vi.fn(() => mockStream);
        }
        if (path === "/custom") {
          file.query_exists = vi.fn(() => false);
          file.make_directory_with_parents = vi.fn(() => true);
        }
        return file;
      });

      configManager.loadFile("/custom", "file.json", defaultFile);

      expect(mockStream.write_all).toHaveBeenCalled();

      (Gio.File.new_for_path as any).mockReset();
      if (defaultImpl) (Gio.File.new_for_path as any).mockImplementation(defaultImpl);
    });
  });

  describe("loadFileContents", () => {
    it("should return file contents as string", () => {
      const mockFile = createMockFile("/test/file.json", {
        contents: '{"key": "value"}',
      });

      const result = configManager.loadFileContents(mockFile);
      expect(result).toBe('{"key": "value"}');
    });

    it("should return undefined when load fails", () => {
      const mockFile = createMockFile("/test/file.json", {
        loadFails: true,
      });

      const result = configManager.loadFileContents(mockFile);
      expect(result).toBeUndefined();
    });
  });

  describe("loadDefaultWindowConfigContents", () => {
    it("should return parsed JSON from default config", () => {
      const mockFile = createMockFile("/default/windows.json", {
        contents: JSON.stringify(sampleWindowConfig),
      });

      Object.defineProperty(configManager, "defaultWindowConfigFile", {
        get: () => mockFile,
        configurable: true,
      });

      const result = configManager.loadDefaultWindowConfigContents();
      expect(result).toEqual(sampleWindowConfig);
    });

    it("should return null when no default config file", () => {
      Object.defineProperty(configManager, "defaultWindowConfigFile", {
        get: () => null,
        configurable: true,
      });

      const result = configManager.loadDefaultWindowConfigContents();
      expect(result).toBeNull();
    });

    it("should return null when file contents cannot be loaded", () => {
      const mockFile = createMockFile("/default/windows.json", {
        loadFails: true,
      });

      Object.defineProperty(configManager, "defaultWindowConfigFile", {
        get: () => mockFile,
        configurable: true,
      });

      const result = configManager.loadDefaultWindowConfigContents();
      expect(result).toBeNull();
    });

    it("rejects a structurally invalid default configuration", () => {
      const mockFile = createMockFile("/default/windows.json", {
        contents: JSON.stringify({ overrides: "invalid" }),
      });
      Object.defineProperty(configManager, "defaultWindowConfigFile", {
        get: () => mockFile,
        configurable: true,
      });

      expect(configManager.loadDefaultWindowConfigContents()).toBeNull();
    });
  });

  describe("windowProps getter", () => {
    it("should return parsed window config", () => {
      const mockFile = createMockFile("/config/windows.json", {
        contents: JSON.stringify(sampleWindowConfig),
      });

      Object.defineProperty(configManager, "windowConfigFile", {
        get: () => mockFile,
        configurable: true,
      });

      const props = configManager.windowProps;
      expect(props).toEqual(sampleWindowConfig);
    });

    it("should fall back to default when windowConfigFile is null", () => {
      const mockDefaultFile = createMockFile("/default/windows.json", {
        contents: JSON.stringify(sampleWindowConfig),
      });

      Object.defineProperty(configManager, "windowConfigFile", {
        get: () => null,
        configurable: true,
      });
      Object.defineProperty(configManager, "defaultWindowConfigFile", {
        get: () => mockDefaultFile,
        configurable: true,
      });

      const props = configManager.windowProps;
      expect(props).toEqual(sampleWindowConfig);
    });

    it("should return null when load fails", () => {
      const mockFile = createMockFile("/config/windows.json", {
        loadFails: true,
      });

      Object.defineProperty(configManager, "windowConfigFile", {
        get: () => mockFile,
        configurable: true,
      });

      const props = configManager.windowProps;
      expect(props).toBeNull();
    });

    it("rejects syntactically valid JSON with an invalid configuration shape", () => {
      const mockFile = createMockFile("/config/windows.json", {
        contents: JSON.stringify({ overrides: "invalid" }),
      });
      Object.defineProperty(configManager, "windowConfigFile", {
        get: () => mockFile,
        configurable: true,
      });
      const errorSpy = vi.spyOn(Logger, "error");

      expect(configManager.windowProps).toBeNull();
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Invalid window config"));
      expect(mockFile.replace_contents).not.toHaveBeenCalled();
    });

    it("distinguishes malformed JSON from an invalid configuration shape", () => {
      const mockFile = createMockFile("/config/windows.json", {
        contents: "{not-json",
      });
      Object.defineProperty(configManager, "windowConfigFile", {
        get: () => mockFile,
        configurable: true,
      });
      const errorSpy = vi.spyOn(Logger, "error");

      expect(configManager.windowProps).toBeNull();
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Failed to parse window config")
      );
    });
  });

  describe("windowProps setter", () => {
    it("should write JSON to config file", () => {
      const mockFile = createMockFile("/config/windows.json");
      mockFile.get_parent = vi.fn(() => ({
        get_path: () => "/config",
      }));

      Object.defineProperty(configManager, "windowConfigFile", {
        get: () => mockFile,
        configurable: true,
      });

      configManager.windowProps = sampleWindowConfig as any;

      expect(mockFile.replace_contents).toHaveBeenCalled();
      const writtenContents = (mockFile.replace_contents as any).mock.calls[0][0];
      expect(JSON.parse(writtenContents)).toEqual(sampleWindowConfig);
    });

    it("should format JSON with 4-space indentation", () => {
      const mockFile = createMockFile("/config/windows.json");
      mockFile.get_parent = vi.fn(() => ({
        get_path: () => "/config",
      }));

      Object.defineProperty(configManager, "windowConfigFile", {
        get: () => mockFile,
        configurable: true,
      });

      configManager.windowProps = sampleWindowConfig as any;

      const writtenContents = (mockFile.replace_contents as any).mock.calls[0][0];
      expect(writtenContents).toContain("    ");
    });

    it("should fall back to default file when windowConfigFile is null", () => {
      const mockDefaultFile = createMockFile("/default/windows.json");
      mockDefaultFile.get_parent = vi.fn(() => ({
        get_path: () => "/default",
      }));

      Object.defineProperty(configManager, "windowConfigFile", {
        get: () => null,
        configurable: true,
      });
      Object.defineProperty(configManager, "defaultWindowConfigFile", {
        get: () => mockDefaultFile,
        configurable: true,
      });

      configManager.windowProps = sampleWindowConfig as any;

      expect(mockDefaultFile.replace_contents).toHaveBeenCalled();
    });

    it("does not write a structurally invalid configuration", () => {
      const mockFile = createMockFile("/config/windows.json");
      mockFile.get_parent = vi.fn(() => ({ get_path: () => "/config" }));
      Object.defineProperty(configManager, "windowConfigFile", {
        get: () => mockFile,
        configurable: true,
      });

      configManager.windowProps = { overrides: "invalid" } as any;

      expect(mockFile.replace_contents).not.toHaveBeenCalled();
    });
  });

  describe("stylesheetFileName", () => {
    it("should be accessible for backup operations", () => {
      const confDir = configManager.confDir;
      expect(confDir).toBeDefined();
    });
  });
});

describe("ConfigManager file path construction", () => {
  it("should construct correct config paths", () => {
    const mockDir = createMockDir("/usr/share/gnome-shell/extensions/anvil@GenKerensky.github.com");
    const cm = new ConfigManager({ dir: mockDir });

    expect(cm.extensionPath).toBe("/usr/share/gnome-shell/extensions/anvil@GenKerensky.github.com");
    expect(cm.confDir).toContain("anvil");
  });

  it("should handle paths with special characters", () => {
    const mockDir = createMockDir("/path/with spaces/extension");
    const cm = new ConfigManager({ dir: mockDir });

    expect(cm.extensionPath).toBe("/path/with spaces/extension");
  });
});

describe("ConfigManager integration scenarios", () => {
  it("should support full config loading workflow", () => {
    const mockDir = createMockDir("/test/extension");
    const cm = new ConfigManager({ dir: mockDir });

    expect(() => cm.confDir).not.toThrow();
    expect(() => cm.defaultStylesheetFile).not.toThrow();
    expect(() => cm.defaultWindowConfigFile).not.toThrow();
  });

  it("should handle missing default files gracefully", () => {
    const mockDir = createMockDir("/test/extension");
    const cm = new ConfigManager({ dir: mockDir });
    const defaultImpl = (Gio.File.new_for_path as any).getMockImplementation();

    (Gio.File.new_for_path as any).mockImplementation((path: string) => {
      const file = defaultImpl!(path) as any;
      file.query_exists = vi.fn(() => false);
      return file;
    });

    const stylesheet = cm.defaultStylesheetFile;
    expect(stylesheet).toBeNull();

    const windowConfig = cm.defaultWindowConfigFile;
    expect(windowConfig).toBeNull();

    (Gio.File.new_for_path as any).mockReset();
  });
});
