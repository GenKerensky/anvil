import { vi } from "vitest";

export class Extension {
  getSettings() {
    return {
      get_boolean: vi.fn(() => false),
      get_int: vi.fn(() => 0),
      get_string: vi.fn(() => ""),
      get_strv: vi.fn(() => []),
      set_boolean: vi.fn(),
      set_int: vi.fn(),
      set_string: vi.fn(),
      set_strv: vi.fn(),
      connect: vi.fn(() => 0),
      disconnect: vi.fn(),
    };
  }

  getPath() {
    return "/tmp/test-extension";
  }

  openPreferences() {}
}

export function gettext(str) {
  return str;
}
