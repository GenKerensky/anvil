import { vi } from "vitest";

const WindowTracker = {
  get_default: vi.fn(() => ({
    get_window_app: vi.fn(() => ({
      get_id: vi.fn(() => "org.mock.App"),
      get_name: vi.fn(() => "Mock App"),
      create_icon_texture: vi.fn(() => ({
        set_size: vi.fn(),
      })),
    })),
  })),
};

const ActionMode = {
  NONE: 0,
  NORMAL: 1,
  OVERVIEW: 2,
  LOCK_SCREEN: 4,
  UNLOCK_SCREEN: 8,
  LOGIN_SCREEN: 16,
  SYSTEM_MODAL: 32,
  LOOKING_GLASS: 64,
  POPUP: 128,
  ALL: 255,
};

export default {
  WindowTracker,
  ActionMode,
};
