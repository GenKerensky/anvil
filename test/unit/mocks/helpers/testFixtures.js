/**
 * Test fixtures for Anvil extension tests
 *
 * Complete fixture factories for setting up WindowManager, Tree, and related
 * objects with all necessary mocks.
 * Ported from jcrussell/forge
 */

import { vi } from "vitest";
import { installGnomeGlobals } from "./globalSetup.js";
import { WindowManager } from "../../../../src/lib/extension/window.js";
import { Tree, LAYOUT_TYPES } from "../../../../src/lib/extension/tree.js";

export const DEFAULT_SETTINGS = {
  "tiling-mode-enabled": true,
  "focus-on-hover-enabled": false,
  "move-pointer-focus-enabled": false,
  "auto-split-enabled": false,
  "stacked-tiling-mode-enabled": true,
  "tabbed-tiling-mode-enabled": true,
  "default-window-layout": "split",
  "focus-border-toggle": false,
  "focus-border-hidden-on-single": false,
  "split-border-toggle": false,
  "window-gap-size": 0,
  "window-gap-size-increment": 1,
  "window-gap-hidden-on-single": false,
  "window-maximize-on-single": false,
  "auto-unmaximize-for-tiling": false,
  "workspace-skip-tile": "",
  "monitor-skip-tile": "",
  "showtab-decoration-enabled": true,
  "quick-settings-enabled": false,
  "tray-icon-enabled": false,
  "resize-amount": 10,
  "launch-app-command": "",
};

export function createMockSettings(overrides = {}) {
  const values = { ...DEFAULT_SETTINGS, ...overrides };

  return {
    get_boolean: vi.fn((key) => {
      const value = values[key];
      return typeof value === "boolean" ? value : false;
    }),
    get_uint: vi.fn((key) => {
      const value = values[key];
      return typeof value === "number" ? value : 0;
    }),
    get_string: vi.fn((key) => {
      const value = values[key];
      return typeof value === "string" ? value : "";
    }),
    set_boolean: vi.fn((key, value) => {
      values[key] = value;
    }),
    set_uint: vi.fn((key, value) => {
      values[key] = value;
    }),
    set_string: vi.fn((key, value) => {
      values[key] = value;
    }),
    get_int: vi.fn((key) => {
      const value = values[key];
      return typeof value === "number" ? value : 0;
    }),
    set_int: vi.fn((key, value) => {
      values[key] = value;
    }),
    get_strv: vi.fn((key) => {
      const value = values[key];
      return Array.isArray(value) ? value : [];
    }),
    set_strv: vi.fn((key, value) => {
      values[key] = value;
    }),
    get_value: vi.fn((key) => ({
      deep_unpack: () => {
        const value = values[key];
        return value ?? [];
      },
    })),
    set_value: vi.fn((key, variant) => {
      values[key] = variant.deep_unpack();
    }),
    connect: vi.fn(() => Math.random()),
    disconnect: vi.fn(),
    _values: values,
  };
}

export function createMockConfigManager(options = {}) {
  const { overrides = [] } = options;

  return {
    windowProps: {
      overrides,
    },
    stylesheetFile: {
      get_path: () => "/mock/stylesheet.css",
      load_contents: () => [true, new Uint8Array(), null],
      copy: () => true,
      get_parent: () => ({ get_path: () => "/mock" }),
    },
    defaultStylesheetFile: {
      get_path: () => "/mock/default.css",
      load_contents: () => [true, new Uint8Array(), null],
    },
  };
}

export function createMockTheme() {
  return {
    loadStylesheet: vi.fn(),
  };
}

export function createMockExtension(options = {}) {
  const { settings = {}, configMgr = {}, version = "1.0.0" } = options;

  return {
    metadata: { version },
    settings: createMockSettings(settings),
    configMgr: createMockConfigManager(configMgr),
    keybindings: null,
    theme: createMockTheme(),
  };
}

export function createWindowManagerFixture(options = {}) {
  const { globals = {}, extension = {}, settings = {} } = options;

  const extOptions = {
    ...extension,
    settings: { ...extension.settings, ...settings },
  };

  const globalCtx = installGnomeGlobals(globals);
  const mockExtension = createMockExtension(extOptions);
  const windowManager = new WindowManager(mockExtension);

  return {
    windowManager,
    tree: windowManager.tree,
    extension: mockExtension,
    settings: mockExtension.settings,
    configMgr: mockExtension.configMgr,
    display: globalCtx.display,
    workspaceManager: globalCtx.workspaceManager,
    workspaces: globalCtx.workspaces,
    windowGroup: globalCtx.windowGroup,
    overview: globalCtx.overview,
    cleanup: () => {
      globalCtx.cleanup();
    },
  };
}

export function createTreeFixture(options = {}) {
  const { globals = {}, settings = {}, defaultLayout = "HSPLIT", fullExtWm = false } = options;

  const globalCtx = installGnomeGlobals(globals);
  const mockSettings = createMockSettings(settings);

  const mockWindowManager = {
    ext: {
      settings: mockSettings,
    },
    determineSplitLayout: vi.fn(() => LAYOUT_TYPES[defaultLayout] || LAYOUT_TYPES.HSPLIT),
    bindWorkspaceSignals: vi.fn(),
  };

  if (fullExtWm) {
    Object.assign(mockWindowManager, {
      move: vi.fn(),
      focusMetaWindow: null,
      currentMonWsNode: null,
      rectForMonitor: vi.fn(() => ({ x: 0, y: 0, width: 1920, height: 1080 })),
      sameParentMonitor: vi.fn(() => true),
      floatingWindow: vi.fn(() => false),
      calculateGaps: vi.fn(() => 0),
      tilingRender: {
        render: vi.fn(),
        processNode: vi.fn(),
        processGap: vi.fn((node) => node?.rect ?? { x: 0, y: 0, width: 0, height: 0 }),
        calculateGaps: vi.fn(() => 0),
        enforceUltrawideSize: vi.fn((_, r) => r),
      },
      notifyFocusChanged: vi.fn(),
    });
  }

  const tree = new Tree(mockWindowManager);

  return {
    tree,
    settings: mockSettings,
    extWm: mockWindowManager,
    display: globalCtx.display,
    workspaceManager: globalCtx.workspaceManager,
    workspaces: globalCtx.workspaces,
    windowGroup: globalCtx.windowGroup,
    cleanup: () => {
      globalCtx.cleanup();
    },
  };
}

export default {
  DEFAULT_SETTINGS,
  createMockSettings,
  createMockConfigManager,
  createMockTheme,
  createMockExtension,
  createWindowManagerFixture,
  createTreeFixture,
};
