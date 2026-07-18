import { vi } from "vitest";
import { withSignals } from "../../mocks/helpers/signalMixin.js";

class Settings extends withSignals() {
  constructor(schemaId) {
    super();
    this.schema_id = schemaId;
    this._settings = new Map();
  }

  static new(schemaId) {
    return new Settings(schemaId);
  }

  get_boolean(key) {
    return this._settings.get(key) ?? false;
  }

  set_boolean(key, value) {
    this._settings.set(key, value);
  }

  get_int(key) {
    return this._settings.get(key) ?? 0;
  }

  set_int(key, value) {
    this._settings.set(key, value);
  }

  get_string(key) {
    return this._settings.get(key) ?? "";
  }

  set_string(key, value) {
    this._settings.set(key, value);
  }

  get_strv(key) {
    return this._settings.get(key) ?? [];
  }

  set_strv(key, value) {
    this._settings.set(key, value);
  }

  get_uint(key) {
    return this._settings.get(key) ?? 0;
  }

  set_uint(key, value) {
    this._settings.set(key, value);
  }

  get_value(key) {
    const stored = this._settings.has(key) ? this._settings.get(key) : [];
    return {
      deep_unpack: () => stored,
    };
  }

  set_value(key, value) {
    // If it's a Variant mock with deep_unpack, unpack to store the raw data
    const raw = value && typeof value.deep_unpack === "function" ? value.deep_unpack() : value;
    this._settings.set(key, raw);
  }
}

const FileMock = {
  new_for_path: vi.fn((path) => ({
    get_path: vi.fn(() => path),
    get_parent: vi.fn(() => {
      const parts = path.split("/");
      parts.pop();
      return FileMock.new_for_path(parts.join("/"));
    }),
    get_child: vi.fn((name) => FileMock.new_for_path(`${path}/${name}`)),
    query_exists: vi.fn(() => true),
    load_contents: vi.fn(() => [true, "", null]),
    replace_contents: vi.fn(() => [true, null]),
    copy: vi.fn(() => true),
    delete: vi.fn(() => true),
    make_directory_with_parents: vi.fn(() => true),
    enumerate_children: vi.fn(() => ({
      next_file: vi.fn(() => null),
      close: vi.fn(),
    })),
    create: vi.fn(() => ({
      write_all: vi.fn((contents, cancellable) => [true, contents.length]),
      close: vi.fn(() => true),
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

const DBus = {
  session: {
    call_sync: vi.fn(() => null),
  },
};

const DBusCallFlags = {
  NONE: 0,
};

export { Settings, FileMock as File, FileCreateFlags, FileCopyFlags, DBus, DBusCallFlags };

export default {
  Settings,
  File: FileMock,
  FileCreateFlags,
  FileCopyFlags,
  DBus,
  DBusCallFlags,
};
