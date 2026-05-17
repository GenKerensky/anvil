/**
 * Global setup helpers for GNOME Shell mocks
 * Ported from jcrussell/forge
 */

import { vi } from "vitest";
// eslint-disable-next-line vitest/no-mocks-import
import { Workspace, Rectangle } from "../../__mocks__/gi/Meta.js";

export const DEFAULT_MONITOR_GEOMETRY = { x: 0, y: 0, width: 1920, height: 1080 };

export function createMockDisplay(options = {}) {
  const { monitorCount = 1, monitorGeometries = null, getFocusWindow = () => null } = options;

  const geometries =
    monitorGeometries ||
    Array.from({ length: monitorCount }, (_, i) => ({
      x: i * DEFAULT_MONITOR_GEOMETRY.width,
      y: 0,
      width: DEFAULT_MONITOR_GEOMETRY.width,
      height: DEFAULT_MONITOR_GEOMETRY.height,
    }));

  return {
    get_workspace_manager: vi.fn(),
    get_n_monitors: vi.fn(() => monitorCount),
    get_focus_window: vi.fn(getFocusWindow),
    get_current_monitor: vi.fn(() => 0),
    get_current_time: vi.fn(() => 12345),
    get_monitor_geometry: vi.fn((index) => {
      const geom = geometries[index] || geometries[0];
      return new Rectangle(geom);
    }),
    get_monitor_scale: vi.fn(() => 1),
    get_monitor_neighbor_index: vi.fn(() => -1),
    get_tab_list: vi.fn(() => []),
    get_tab_next: vi.fn(() => null),
    sort_windows_by_stacking: vi.fn((windows) => windows),
  };
}

export function createMockWorkspaceManager(options = {}) {
  const { workspaceCount = 1, activeWorkspaceIndex = 0, workspaces = null } = options;

  const wsArray =
    workspaces || Array.from({ length: workspaceCount }, (_, i) => new Workspace({ index: i }));

  const workspaceManager = {
    get_n_workspaces: vi.fn(() => wsArray.length),
    get_workspace_by_index: vi.fn((i) => wsArray[i] || new Workspace({ index: i })),
    get_active_workspace_index: vi.fn(() => activeWorkspaceIndex),
    get_active_workspace: vi.fn(() => wsArray[activeWorkspaceIndex]),
  };

  return { workspaceManager, workspaces: wsArray };
}

export function createMockWindowGroup() {
  const children = [];
  return {
    _children: children,
    contains: vi.fn((child) => children.includes(child)),
    add_child: vi.fn((child) => {
      if (!children.includes(child)) children.push(child);
    }),
    remove_child: vi.fn((child) => {
      const index = children.indexOf(child);
      if (index !== -1) children.splice(index, 1);
    }),
    insert_child_below: vi.fn((child, sibling) => {
      const index = sibling ? children.indexOf(sibling) : -1;
      if (index >= 0) {
        children.splice(index, 0, child);
      } else {
        children.push(child);
      }
    }),
  };
}

export function createMockStage(options = {}) {
  const { width = 1920, height = 1080 } = options;
  return {
    get_width: vi.fn(() => width),
    get_height: vi.fn(() => height),
  };
}

export function createMockOverview(options = {}) {
  const { visible = false } = options;
  const _signals = {};
  return {
    visible,
    _signals,
    connect: vi.fn((signal, callback) => {
      if (!_signals[signal]) _signals[signal] = [];
      const id = Math.random();
      _signals[signal].push({ id, callback });
      return id;
    }),
    disconnect: vi.fn((id) => {
      for (const signal in _signals) {
        _signals[signal] = _signals[signal].filter((s) => s.id !== id);
      }
    }),
  };
}

export function installGnomeGlobals(options = {}) {
  const displayOpts = options.display || {};
  const wmOpts = options.workspaceManager || {};

  const display = createMockDisplay(displayOpts);
  const { workspaceManager, workspaces } = createMockWorkspaceManager(wmOpts);
  display.get_workspace_manager.mockReturnValue(workspaceManager);

  global.display = display;
  global.workspace_manager = workspaceManager;

  let windowGroup = null;
  if (options.windowGroup !== false) {
    windowGroup = createMockWindowGroup();
    global.window_group = windowGroup;
  }

  let stage = null;
  if (options.stage !== false) {
    stage = createMockStage(options.stage || {});
    global.stage = stage;
  }

  let overview = null;
  if (options.overview !== false) {
    overview = createMockOverview(options.overview || {});
    if (!global.Main) global.Main = {};
    global.Main.overview = overview;
  }

  global.get_current_time = vi.fn(() => 12345);
  global.get_pointer = vi.fn(() => [0, 0, 0]);
  global.get_window_actors = vi.fn(() => []);

  const cleanup = () => {
    vi.clearAllTimers();
    delete global.display;
    delete global.workspace_manager;
    delete global.window_group;
    delete global.stage;
    delete global.get_current_time;
    delete global.get_pointer;
    delete global.get_window_actors;
    if (global.Main) delete global.Main.overview;
  };

  return {
    display,
    workspaceManager,
    workspaces,
    windowGroup,
    stage,
    overview,
    cleanup,
  };
}

export default {
  DEFAULT_MONITOR_GEOMETRY,
  createMockDisplay,
  createMockWorkspaceManager,
  createMockWindowGroup,
  createMockStage,
  createMockOverview,
  installGnomeGlobals,
};
