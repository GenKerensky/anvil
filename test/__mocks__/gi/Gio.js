import { vi } from "vitest";

const FileMock = {
  new_for_path: vi.fn((path) => ({
    get_path: vi.fn(() => path),
    get_child: vi.fn((name) => FileMock.new_for_path(`${path}/${name}`)),
    query_exists: vi.fn(() => false),
    load_contents: vi.fn(() => [true, new Uint8Array(), null]),
    replace_contents: vi.fn(() => true),
    copy: vi.fn(() => true),
    delete: vi.fn(() => true),
    make_directory_with_parents: vi.fn(() => true),
    enumerate_children: vi.fn(() => ({
      next_file: vi.fn(() => null),
      close: vi.fn(),
    })),
  })),
};

const FileCreateFlags = {
  NONE: 0,
  PRIVATE: 1,
  REPLACE_DESTINATION: 2,
};

const FileCopyFlags = {
  NONE: 0,
  OVERWRITE: 1,
  BACKUP: 2,
  NOFOLLOW_SYMLINKS: 4,
  ALL_METADATA: 8,
  NO_FALLBACK_FOR_MOVE: 16,
  TARGET_DEFAULT_PERMS: 32,
};

export default {
  File: FileMock,
  FileCreateFlags,
  FileCopyFlags,
};
