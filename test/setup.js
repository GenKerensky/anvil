import { vi } from "vitest";

// GJS provides a global `log` function
globalThis.log = vi.fn();
globalThis.logError = vi.fn();
globalThis.print = vi.fn();

// GNOME Shell global object stubs
globalThis.global = {
  display: {
    connect: vi.fn(() => 0),
    disconnect: vi.fn(),
    get_monitor_geometry: vi.fn(() => ({ x: 0, y: 0, width: 1920, height: 1080 })),
    get_monitor_scale: vi.fn(() => 1),
    get_n_monitors: vi.fn(() => 1),
    get_focus_window: vi.fn(() => null),
    get_tab_list: vi.fn(() => []),
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
    connect: vi.fn(() => 0),
    disconnect: vi.fn(),
  },
  stage: {
    connect: vi.fn(() => 0),
    disconnect: vi.fn(),
    get_key_focus: vi.fn(() => null),
  },
  get_pointer: vi.fn(() => [0, 0, 0]),
  get_window_actors: vi.fn(() => []),
};
