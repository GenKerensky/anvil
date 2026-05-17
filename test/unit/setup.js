import { vi } from "vitest";

// GJS provides a global `log` function
globalThis.log = vi.fn();
globalThis.logError = vi.fn();
globalThis.print = vi.fn();

// GNOME Shell global object stubs
const mockBackend = {
  get_monitor_manager: () => {
    // Lazily require Meta mock to avoid circular issues at import time
    const Meta = globalThis.Meta || {};
    const MonitorManager = Meta.MonitorManager;
    return MonitorManager && MonitorManager.get ? MonitorManager.get() : null;
  },
};

globalThis.global = {
  display: {
    connect: vi.fn(() => 0),
    disconnect: vi.fn(),
    get_monitor_geometry: vi.fn(() => ({ x: 0, y: 0, width: 1920, height: 1080 })),
    get_monitor_scale: vi.fn(() => 1),
    get_n_monitors: vi.fn(() => 1),
    get_focus_window: vi.fn(() => null),
    get_tab_list: vi.fn(() => []),
    get_current_monitor: vi.fn(() => 0),
  },
  workspace_manager: {
    connect: vi.fn(() => 0),
    disconnect: vi.fn(),
    get_active_workspace: vi.fn(() => ({
      index: vi.fn(() => 0),
      list_windows: vi.fn(() => []),
    })),
    get_active_workspace_index: vi.fn(() => 0),
    get_n_workspaces: vi.fn(() => 1),
  },
  window_group: {
    _children: [],
    connect: vi.fn(() => 0),
    disconnect: vi.fn(),
    contains: vi.fn(function (child) {
      return this._children.includes(child);
    }),
    add_child: vi.fn(function (child) {
      if (!this._children.includes(child)) {
        this._children.push(child);
      }
    }),
    remove_child: vi.fn(function (child) {
      const index = this._children.indexOf(child);
      if (index !== -1) {
        this._children.splice(index, 1);
      }
    }),
  },
  stage: {
    connect: vi.fn(() => 0),
    disconnect: vi.fn(),
    get_key_focus: vi.fn(() => null),
  },
  get_pointer: vi.fn(() => [0, 0, 0]),
  get_window_actors: vi.fn(() => []),
  backend: mockBackend,
};
