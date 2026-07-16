import { vi } from "vitest";
import { createHash } from "node:crypto";

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

const ChecksumType = {
  MD5: 0,
  SHA1: 1,
  SHA256: 2,
  SHA512: 3,
  SHA384: 4,
};

export default {
  get_environ: vi.fn(() => []),
  environ_getenv: vi.fn((env, variable) => {
    const prefix = `${variable}=`;
    const entry = env?.find((value) => value.startsWith(prefix));
    return entry ? entry.slice(prefix.length) : null;
  }),
  get_user_config_dir: vi.fn(() => "/tmp/mock-config"),
  build_filenamev: vi.fn((parts) => parts.join("/")),
  mkdir_with_parents: vi.fn(() => 0),
  compute_checksum_for_data: vi.fn((type, data) => {
    if (type !== ChecksumType.SHA256) throw new Error(`Unsupported checksum type: ${type}`);
    return createHash("sha256").update(data).digest("hex");
  }),
  uuid_string_random: vi.fn(() => crypto.randomUUID()),
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
  ChecksumType,
};
