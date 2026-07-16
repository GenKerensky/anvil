import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  StylesheetMigrationService,
  digestStylesheetBytes,
  type StylesheetMigrationManifest,
} from "../../../src/lib/shared/stylesheet-migration.js";
import {
  BYTE_SENSITIVE,
  CUSTOM,
  MALFORMED,
  NEW_DEFAULT,
  OLD_DEFAULT,
} from "../fixtures/theme/fixtures.js";

const OLD_DIGEST = digestStylesheetBytes(new TextEncoder().encode(OLD_DEFAULT))!;
const NEW_DIGEST = digestStylesheetBytes(new TextEncoder().encode(NEW_DEFAULT))!;

const manifest: StylesheetMigrationManifest = {
  version: 39,
  currentDigest: NEW_DIGEST,
  knownDefaultDigests: [OLD_DIGEST, NEW_DIGEST],
};

type Failure =
  | "create-throw"
  | "load"
  | "verify-load"
  | "copy-false"
  | "copy-throw"
  | "move-false"
  | "move-throw"
  | "replace-false"
  | "replace-throw"
  | "write-false";

class MemoryFileSystem {
  files = new Map<string, Uint8Array>();
  revisions = new Map<string, number>();
  directories = new Set<string>();
  failures = new Map<string, Set<Failure>>();
  operations: string[] = [];
  beforeMove: ((sourcePath: string, destinationPath: string) => void) | null = null;

  file(path: string): any {
    // A file handle must retain its owning in-memory filesystem across callbacks.
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const fs = this;
    return {
      get_path: () => path,
      get_parent: () => fs.directory(path.slice(0, path.lastIndexOf("/")) || "/"),
      query_exists: () => fs.files.has(path),
      create: () => {
        fs.operations.push(`create:${path}`);
        if (fs.hasFailure(path, "create-throw")) throw new Error(`create failed: ${path}`);
        if (fs.files.has(path)) throw new Error(`already exists: ${path}`);
        fs.write(path, new Uint8Array());
        return {
          write_all: (contents: Uint8Array | string) => {
            fs.operations.push(`write:${path}`);
            if (fs.hasFailure(path, "write-false")) return [false, 0] as const;
            fs.write(path, contents);
            const length = typeof contents === "string" ? contents.length : contents.length;
            return [true, length] as const;
          },
          close: () => true,
        };
      },
      load_contents: () => {
        fs.operations.push(`load:${path}`);
        if (fs.hasFailure(path, "load")) throw new Error(`load failed: ${path}`);
        if (fs.hasFailure(path, "verify-load") && (fs.revisions.get(path) ?? 0) > 1) {
          throw new Error(`verification load failed: ${path}`);
        }
        const contents = fs.files.get(path);
        if (!contents) throw new Error(`missing: ${path}`);
        return [true, contents.slice(), fs.etag(path)] as const;
      },
      replace_contents: (contents: Uint8Array | string, etag: string | null) => {
        fs.operations.push(`replace:${path}`);
        if (fs.hasFailure(path, "replace-throw")) throw new Error(`replace failed: ${path}`);
        if (fs.hasFailure(path, "replace-false")) return [false, null] as const;
        if (etag !== null && etag !== fs.etag(path)) throw new Error(`etag conflict: ${path}`);
        fs.write(path, contents);
        return [true, fs.etag(path)] as const;
      },
      copy: (destination: ReturnType<MemoryFileSystem["file"]>) => {
        fs.operations.push(`copy:${path}->${destination.get_path()}`);
        if (fs.hasFailure(path, "copy-throw")) throw new Error(`copy failed: ${path}`);
        if (fs.hasFailure(path, "copy-false")) return false;
        const contents = fs.files.get(path);
        if (!contents || fs.files.has(destination.get_path())) return false;
        fs.write(destination.get_path(), contents);
        return true;
      },
      move: (destination: ReturnType<MemoryFileSystem["file"]>) => {
        const destinationPath = destination.get_path();
        fs.operations.push(`move:${path}->${destinationPath}`);
        fs.beforeMove?.(path, destinationPath);
        if (fs.hasFailure(path, "move-throw")) throw new Error(`move failed: ${path}`);
        if (fs.hasFailure(path, "move-false")) return false;
        const contents = fs.files.get(path);
        if (!contents || fs.files.has(destinationPath)) return false;
        fs.write(destinationPath, contents);
        fs.files.delete(path);
        return true;
      },
      delete: () => {
        fs.operations.push(`delete:${path}`);
        return fs.files.delete(path);
      },
    };
  }

  directory(path: string) {
    return {
      get_path: () => path,
      query_exists: () => this.directories.has(path),
      make_directory_with_parents: () => {
        this.operations.push(`mkdir:${path}`);
        this.directories.add(path);
        return true;
      },
    };
  }

  write(path: string, contents: Uint8Array | string) {
    const bytes = typeof contents === "string" ? new TextEncoder().encode(contents) : contents;
    this.files.set(path, bytes.slice());
    this.revisions.set(path, (this.revisions.get(path) ?? 0) + 1);
    this.directories.add(path.slice(0, path.lastIndexOf("/")) || "/");
  }

  read(path: string) {
    return new TextDecoder().decode(this.files.get(path));
  }

  fail(path: string, failure: Failure) {
    const failures = this.failures.get(path) ?? new Set<Failure>();
    failures.add(failure);
    this.failures.set(path, failures);
  }

  hasFailure(path: string, failure: Failure) {
    return this.failures.get(path)?.has(failure) ?? false;
  }

  etag(path: string) {
    return `${path}:${this.revisions.get(path) ?? 0}`;
  }
}

function createSettings(initial: Record<string, string | number> = {}) {
  const values = new Map<string, string | number>(Object.entries(initial));
  const operations: string[] = [];
  return {
    values,
    operations,
    get_uint: vi.fn((key: string) => Number(values.get(key) ?? 0)),
    get_string: vi.fn((key: string) => String(values.get(key) ?? "")),
    set_uint: vi.fn((key: string, value: number) => {
      operations.push(`set-uint:${key}:${value}`);
      values.set(key, value);
      return true;
    }),
    set_string: vi.fn((key: string, value: string) => {
      operations.push(`set-string:${key}:${value}`);
      values.set(key, value);
      return true;
    }),
  };
}

function fixture({
  user,
  tag = 38,
  digest = OLD_DIGEST,
}: { user?: string; tag?: number; digest?: string } = {}) {
  const fs = new MemoryFileSystem();
  const shippedPath = "/extension/stylesheet.css";
  const userPath = "/config/anvil/stylesheet/anvil/stylesheet.css";
  const temporaryPath = `${userPath}.tmp-test`;
  fs.write(shippedPath, NEW_DEFAULT);
  if (user !== undefined) fs.write(userPath, user);
  const settings = createSettings({ "css-last-update": tag, "css-default-digest": digest });
  const configMgr = {
    defaultStylesheetFile: fs.file(shippedPath),
    userStylesheetFile: fs.file(userPath),
    stylesheetTemporaryFile: () => fs.file(temporaryPath),
    stylesheetBackupFile: (version: number, sourceDigest: string) =>
      fs.file(`${userPath}.bak-v${version}-${sourceDigest.slice(0, 12)}`),
  };
  const service = new StylesheetMigrationService({
    configMgr: configMgr as any,
    settings: settings as any,
    manifest,
  });
  return { fs, settings, service, shippedPath, temporaryPath, userPath };
}

describe("StylesheetMigrationService", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("creates a missing user stylesheet from the exact shipped bytes", () => {
    const { fs, settings, service, userPath } = fixture({ user: undefined, tag: 0, digest: "" });

    const result = service.initialize();

    expect(result.status).toBe("created");
    expect(result.usable).toBe(true);
    expect(result.baseFile).not.toBeNull();
    expect(result.overrideFile?.get_path()).toBe(userPath);
    expect(fs.read(userPath)).toBe(NEW_DEFAULT);
    expect(fs.operations.some((operation) => operation.startsWith("copy:"))).toBe(false);
    expect(settings.values.get("css-default-digest")).toBe(NEW_DIGEST);
    expect(settings.values.get("css-last-update")).toBe(39);
  });

  it("falls back to shipped CSS and leaves state unchanged when first-install writing fails", () => {
    const { fs, settings, service, temporaryPath } = fixture({
      user: undefined,
      tag: 0,
      digest: "",
    });
    fs.fail(temporaryPath, "write-false");

    const result = service.initialize();

    expect(result.status).toBe("fallback");
    expect(result.usable).toBe(true);
    expect(result.overrideFile).toBeNull();
    expect(settings.values.get("css-last-update")).toBe(0);
    expect(settings.values.get("css-default-digest")).toBe("");
  });

  it("preserves and reclassifies a custom file created concurrently with first install", () => {
    const { fs, service, temporaryPath, userPath } = fixture({
      user: undefined,
      tag: 0,
      digest: "",
    });
    fs.beforeMove = (_sourcePath, destinationPath) => {
      if (destinationPath === userPath) fs.write(userPath, CUSTOM);
    };

    const result = service.initialize();

    expect(result.status).toBe("custom-preserved");
    expect(fs.read(userPath)).toBe(CUSTOM);
    expect(fs.files.has(temporaryPath)).toBe(false);
  });

  it("creates a missing user file when its parent directory already exists", () => {
    const { fs, service, userPath } = fixture({ user: undefined, tag: 0, digest: "" });
    fs.directories.add(userPath.slice(0, userPath.lastIndexOf("/")));

    expect(service.initialize().status).toBe("created");
    expect(fs.read(userPath)).toBe(NEW_DEFAULT);
    expect(fs.operations.filter((operation) => operation.startsWith("mkdir:"))).toEqual([]);
  });

  it("backs up and replaces an untouched known old default before advancing state", () => {
    const { fs, settings, service, userPath } = fixture({ user: OLD_DEFAULT });

    const result = service.initialize();

    const backupPath = `${userPath}.bak-v38-${OLD_DIGEST.slice(0, 12)}`;
    expect(result.status).toBe("upgraded");
    expect(fs.read(userPath)).toBe(NEW_DEFAULT);
    expect(fs.read(backupPath)).toBe(OLD_DEFAULT);
    expect(settings.values.get("css-default-digest")).toBe(NEW_DIGEST);
    expect(settings.values.get("css-last-update")).toBe(39);
    expect(fs.operations.indexOf(`copy:${userPath}->${backupPath}`)).toBeLessThan(
      fs.operations.indexOf(`replace:${userPath}`)
    );
  });

  it("upgrades a true legacy default that predates digest state", () => {
    const { fs, settings, service, userPath } = fixture({
      user: OLD_DEFAULT,
      tag: 38,
      digest: "",
    });

    expect(service.initialize().status).toBe("upgraded");
    expect(fs.read(userPath)).toBe(NEW_DEFAULT);
    expect(settings.values.get("css-default-digest")).toBe(NEW_DIGEST);
  });

  it("preserves restored recovery bytes as customization after a completed migration", () => {
    const { fs, settings, service, userPath } = fixture({ user: OLD_DEFAULT });
    const first = service.initialize();
    const backupPath = `${userPath}.bak-v38-${OLD_DIGEST.slice(0, 12)}`;
    expect(first.status).toBe("upgraded");
    const recoveryBytes = fs.files.get(backupPath)!.slice();

    fs.write(userPath, recoveryBytes);
    const restored = service.initialize();

    expect(restored.status).toBe("custom-preserved");
    expect(fs.files.get(userPath)).toEqual(recoveryBytes);
    expect(settings.values.get("css-default-digest")).toBe(NEW_DIGEST);
    expect(settings.values.get("css-last-update")).toBe(39);
  });

  it("is idempotent after a successful upgrade", () => {
    const { fs, service, userPath } = fixture({ user: OLD_DEFAULT });
    service.initialize();
    fs.operations.length = 0;

    const result = service.initialize();

    expect(result.status).toBe("current");
    expect(fs.operations.filter((operation) => operation.startsWith("copy:"))).toEqual([]);
    expect(fs.operations.filter((operation) => operation === `replace:${userPath}`)).toEqual([]);
  });

  it("preserves customized bytes and layers them over the new shipped base", () => {
    const { fs, settings, service, shippedPath, userPath } = fixture({ user: BYTE_SENSITIVE });
    const before = fs.files.get(userPath)!.slice();

    const result = service.initialize();

    expect(result.status).toBe("custom-preserved");
    expect(result.baseFile?.get_path()).toBe(shippedPath);
    expect(result.overrideFile?.get_path()).toBe(userPath);
    expect(fs.files.get(userPath)).toEqual(before);
    expect(fs.operations.filter((operation) => operation.startsWith("copy:"))).toEqual([]);
    expect(settings.values.get("css-default-digest")).toBe(OLD_DIGEST);
    expect(settings.values.get("css-last-update")).toBe(39);
  });

  it("treats malformed and unknown legacy bytes as opaque customization", () => {
    const { fs, service, userPath } = fixture({
      user: MALFORMED,
      tag: 12,
      digest: "not-a-digest",
    });

    const result = service.initialize();

    expect(result.status).toBe("custom-preserved");
    expect(fs.read(userPath)).toBe(MALFORMED);
    expect(result.overrideFile?.get_path()).toBe(userPath);
  });

  it("uses the shipped base without changing an unreadable user file", () => {
    const { fs, settings, service, shippedPath, userPath } = fixture({ user: CUSTOM });
    fs.fail(userPath, "load");

    const result = service.initialize();

    expect(result.status).toBe("fallback");
    expect(result.baseFile?.get_path()).toBe(shippedPath);
    expect(result.overrideFile).toBeNull();
    expect(settings.values.get("css-last-update")).toBe(38);
  });

  it.each(["copy-false", "copy-throw"] as const)(
    "leaves the active old default and markers intact when backup %s",
    (failure) => {
      const { fs, settings, service, userPath } = fixture({ user: OLD_DEFAULT });
      fs.fail(userPath, failure);

      const result = service.initialize();

      expect(result.status).toBe("fallback");
      expect(fs.read(userPath)).toBe(OLD_DEFAULT);
      expect(result.overrideFile?.get_path()).toBe(userPath);
      expect(settings.values.get("css-last-update")).toBe(38);
      expect(settings.values.get("css-default-digest")).toBe(OLD_DIGEST);
    }
  );

  it.each(["replace-false", "replace-throw"] as const)(
    "retains active bytes and recovery backup when replacement %s",
    (failure) => {
      const { fs, settings, service, userPath } = fixture({ user: OLD_DEFAULT });
      fs.fail(userPath, failure);

      const result = service.initialize();

      const backupPath = `${userPath}.bak-v38-${OLD_DIGEST.slice(0, 12)}`;
      expect(result.status).toBe("fallback");
      expect(fs.read(userPath)).toBe(OLD_DEFAULT);
      expect(fs.read(backupPath)).toBe(OLD_DEFAULT);
      expect(settings.values.get("css-last-update")).toBe(38);
    }
  );

  it("reports changed contents and selects the base when post-write verification fails", () => {
    const { fs, settings, service, userPath } = fixture({ user: OLD_DEFAULT });
    fs.fail(userPath, "verify-load");

    const result = service.initialize();

    expect(result.status).toBe("fallback");
    expect(result.contentsChanged).toBe(true);
    expect(result.overrideFile).toBeNull();
    expect(fs.read(userPath)).toBe(NEW_DEFAULT);
    expect(settings.values.get("css-last-update")).toBe(38);
  });

  it("repairs state without another backup after replacement succeeded but marker persistence failed", () => {
    const { fs, settings, service, userPath } = fixture({ user: OLD_DEFAULT });
    settings.set_uint.mockReturnValueOnce(false);

    const first = service.initialize();
    expect(first.status).toBe("state-failed");
    expect(fs.read(userPath)).toBe(NEW_DEFAULT);
    fs.operations.length = 0;

    const second = service.initialize();

    expect(second.status).toBe("current");
    expect(settings.values.get("css-last-update")).toBe(39);
    expect(fs.operations.filter((operation) => operation.startsWith("copy:"))).toEqual([]);
  });

  it("does not advance the version when digest-state persistence fails", () => {
    const { settings, service } = fixture({ user: OLD_DEFAULT });
    settings.set_string.mockReturnValueOnce(false);

    const result = service.initialize();

    expect(result.status).toBe("state-failed");
    expect(settings.values.get("css-last-update")).toBe(38);
  });

  it("does not trust an unknown recorded digest enough to overwrite matching custom bytes", () => {
    const customDigest = digestStylesheetBytes(new TextEncoder().encode(CUSTOM))!;
    const { fs, settings, service, userPath } = fixture({ user: CUSTOM, digest: customDigest });
    const before = fs.files.get(userPath)!.slice();

    expect(service.initialize().status).toBe("custom-preserved");
    expect(fs.files.get(userPath)).toEqual(before);
    expect(settings.values.get("css-default-digest")).toBe("");
  });

  it("does not advance migration state when shipped bytes do not match the governed digest", () => {
    const { fs, settings, service, shippedPath, userPath } = fixture({ user: CUSTOM });
    fs.write(shippedPath, "unexpected release contents");

    const result = service.initialize();

    expect(result.status).toBe("invalid-shipped");
    expect(result.overrideFile?.get_path()).toBe(userPath);
    expect(settings.values.get("css-last-update")).toBe(38);
  });
});
