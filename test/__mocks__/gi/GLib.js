import { vi } from "vitest";

export default {
  get_user_config_dir: vi.fn(() => "/tmp/mock-config"),
  build_filenamev: vi.fn((parts) => parts.join("/")),
  mkdir_with_parents: vi.fn(() => 0),
  Source: {
    remove: vi.fn(),
  },
};
