import { vi } from "vitest";

class Variant {
  constructor(typeStr, value) {
    this._typeStr = typeStr;
    this._value = value;
  }

  deep_unpack() {
    return this._value;
  }
}

export { Variant };

export default {
  get_user_config_dir: vi.fn(() => "/tmp/mock-config"),
  build_filenamev: vi.fn((parts) => parts.join("/")),
  mkdir_with_parents: vi.fn(() => 0),
  idle_add: vi.fn((priority, callback) => {
    callback();
    return Math.random();
  }),
  timeout_add: vi.fn((priority, interval, callback) => {
    const id = Math.random();
    // Store reference so tests can trigger manually if needed
    return id;
  }),
  Source: {
    remove: vi.fn(),
  },
  Variant,
};
