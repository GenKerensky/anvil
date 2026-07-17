import Gio from "gi://Gio";
import GLib from "gi://GLib";

import { Logger } from "./logger.js";
import type { ConfigManager } from "./settings.js";

export const STYLESHEET_DIGEST_KEY = "css-default-digest";
export const STYLESHEET_VERSION_KEY = "css-last-update";

/**
 * Versioned identity for the stylesheet packaged with this source tree.
 *
 * When stylesheet.css changes, increment version, move the previous digest into
 * knownDefaultDigests, and update currentDigest. The governance test makes an
 * unrecorded edit fail loudly instead of silently changing migration behavior.
 */
export interface StylesheetMigrationManifest {
  version: number;
  currentDigest: string;
  knownDefaultDigests: readonly string[];
}

export const CURRENT_STYLESHEET_MANIFEST: StylesheetMigrationManifest = {
  version: 39,
  currentDigest: "cd35937ff88a7a7e491c2640a8590f6e5b445888f4f6553e39a7d394a1503997",
  knownDefaultDigests: [
    "cd35937ff88a7a7e491c2640a8590f6e5b445888f4f6553e39a7d394a1503997",
    "d32b4d2c1ffed899138b015f78ce769afbc1526bd9b6b0d52b50e0aebfc0e4ac",
  ],
};

export type StylesheetMigrationStatus =
  | "created"
  | "current"
  | "upgraded"
  | "custom-preserved"
  | "fallback"
  | "state-failed"
  | "invalid-shipped";

export interface StylesheetMigrationResult {
  status: StylesheetMigrationStatus;
  usable: boolean;
  baseFile: Gio.File | null;
  overrideFile: Gio.File | null;
  contentsChanged: boolean;
  stateCommitted: boolean;
}

interface StylesheetConfigFiles {
  defaultStylesheetFile: Gio.File | null;
  userStylesheetFile: Gio.File;
  stylesheetBackupFile(version: number, sourceDigest: string): Gio.File;
  stylesheetTemporaryFile(token: string): Gio.File;
}

interface LoadedFile {
  bytes: Uint8Array;
  etag: string | null;
  digest: string;
}

interface ReplaceAttempt {
  writeSucceeded: boolean;
  verified: boolean;
}

const DIGEST_PATTERN = /^[a-f0-9]{64}$/;

export function digestStylesheetBytes(bytes: Uint8Array): string | null {
  return GLib.compute_checksum_for_data(GLib.ChecksumType.SHA256, bytes);
}

export class StylesheetMigrationService {
  private readonly _configMgr: StylesheetConfigFiles;
  private readonly _settings: Gio.Settings;
  private readonly _manifest: StylesheetMigrationManifest;

  constructor({
    configMgr,
    settings,
    manifest = CURRENT_STYLESHEET_MANIFEST,
  }: {
    configMgr: ConfigManager | StylesheetConfigFiles;
    settings: Gio.Settings;
    manifest?: StylesheetMigrationManifest;
  }) {
    this._configMgr = configMgr;
    this._settings = settings;
    this._manifest = manifest;
  }

  initialize(): StylesheetMigrationResult {
    const baseFile = this._configMgr.defaultStylesheetFile;
    const base = baseFile ? this._load(baseFile, "shipped stylesheet") : null;
    const userFile = this._configMgr.userStylesheetFile;
    const userExists = userFile.query_exists(null);
    const user = userExists ? this._load(userFile, "user stylesheet") : null;

    if (!baseFile || !base || base.digest !== this._manifest.currentDigest) {
      Logger.error("Shipped stylesheet identity does not match its migration manifest");
      return {
        status: "invalid-shipped",
        usable: Boolean(user),
        baseFile: null,
        overrideFile: user ? userFile : null,
        contentsChanged: false,
        stateCommitted: false,
      };
    }

    if (!userExists) {
      return this._createUserStylesheet(baseFile, base, userFile);
    }

    if (!user) {
      return {
        status: "fallback",
        usable: true,
        baseFile,
        overrideFile: null,
        contentsChanged: false,
        stateCommitted: false,
      };
    }

    const recordedVersion = this._settings.get_uint(STYLESHEET_VERSION_KEY);
    const rawRecordedDigest = this._settings.get_string(STYLESHEET_DIGEST_KEY);
    const recordedDigest =
      DIGEST_PATTERN.test(rawRecordedDigest) &&
      this._manifest.knownDefaultDigests.includes(rawRecordedDigest)
        ? rawRecordedDigest
        : "";

    if (user.digest === base.digest) {
      const committed = this._commitState(base.digest, recordedVersion, rawRecordedDigest);
      return {
        status: committed ? "current" : "state-failed",
        usable: true,
        baseFile,
        overrideFile: userFile,
        contentsChanged: false,
        stateCommitted: committed,
      };
    }

    const matchesRecordedBase = recordedDigest !== "" && user.digest === recordedDigest;
    const matchesLegacyDefault =
      recordedDigest === "" && this._manifest.knownDefaultDigests.includes(user.digest);
    if (matchesRecordedBase || matchesLegacyDefault) {
      return this._upgradeUntouchedDefault(baseFile, base, userFile, user, recordedVersion);
    }

    const committed = this._commitState(recordedDigest, recordedVersion, rawRecordedDigest);
    return {
      status: committed ? "custom-preserved" : "state-failed",
      usable: true,
      baseFile,
      overrideFile: userFile,
      contentsChanged: false,
      stateCommitted: committed,
    };
  }

  private _createUserStylesheet(
    baseFile: Gio.File,
    base: LoadedFile,
    userFile: Gio.File
  ): StylesheetMigrationResult {
    const temporaryFile = this._configMgr.stylesheetTemporaryFile(GLib.uuid_string_random());
    let destinationChanged = false;
    try {
      const parent = userFile.get_parent();
      if (
        parent &&
        !parent.query_exists(null) &&
        parent.make_directory_with_parents(null) === false
      ) {
        throw new Error("stylesheet directory creation returned false");
      }

      const stream = temporaryFile.create(Gio.FileCreateFlags.NONE, null);
      try {
        const [written, bytesWritten] = stream.write_all(base.bytes, null);
        if (!written || bytesWritten !== base.bytes.length) {
          throw new Error("temporary stylesheet write did not complete");
        }
      } finally {
        stream.close(null);
      }
      if (this._load(temporaryFile, "temporary user stylesheet")?.digest !== base.digest) {
        throw new Error("temporary stylesheet verification failed");
      }

      const moved = temporaryFile.move(userFile, Gio.FileCopyFlags.NONE, null, null);
      if (!moved) throw new Error("exclusive stylesheet install returned false");
      destinationChanged = true;
      if (this._load(userFile, "created user stylesheet")?.digest !== base.digest) {
        throw new Error("created stylesheet verification failed");
      }

      const committed = this._commitState(
        base.digest,
        this._settings.get_uint(STYLESHEET_VERSION_KEY),
        this._settings.get_string(STYLESHEET_DIGEST_KEY)
      );
      return {
        status: committed ? "created" : "state-failed",
        usable: true,
        baseFile,
        overrideFile: userFile,
        contentsChanged: true,
        stateCommitted: committed,
      };
    } catch (error) {
      Logger.warn(`Could not initialize user stylesheet: ${error}`);
      if (!destinationChanged && userFile.query_exists(null)) return this.initialize();
      return {
        status: "fallback",
        usable: true,
        baseFile,
        overrideFile: null,
        contentsChanged: destinationChanged,
        stateCommitted: false,
      };
    } finally {
      try {
        if (temporaryFile.query_exists(null)) temporaryFile.delete(null);
      } catch (error) {
        Logger.warn(`Could not remove temporary stylesheet: ${error}`);
      }
    }
  }

  private _upgradeUntouchedDefault(
    baseFile: Gio.File,
    base: LoadedFile,
    userFile: Gio.File,
    user: LoadedFile,
    recordedVersion: number
  ): StylesheetMigrationResult {
    const backupFile = this._configMgr.stylesheetBackupFile(recordedVersion, user.digest);
    let contentsChanged = false;
    try {
      if (backupFile.query_exists(null)) {
        const existingBackup = this._load(backupFile, "stylesheet recovery backup");
        if (!existingBackup || existingBackup.digest !== user.digest) {
          throw new Error("existing recovery backup does not match the active stylesheet");
        }
      } else {
        const copied = userFile.copy(backupFile, Gio.FileCopyFlags.NONE, null, null);
        if (!copied) throw new Error("stylesheet backup returned false");
        const copiedBackup = this._load(backupFile, "stylesheet recovery backup");
        if (!copiedBackup || copiedBackup.digest !== user.digest) {
          throw new Error("stylesheet backup verification failed");
        }
      }

      const replacement = this._replaceAndVerify(userFile, base.bytes, user.etag, base.digest);
      contentsChanged = replacement.writeSucceeded;
      if (!replacement.verified) {
        throw new Error("stylesheet replacement returned false");
      }

      const committed = this._commitState(
        base.digest,
        recordedVersion,
        this._settings.get_string(STYLESHEET_DIGEST_KEY)
      );
      return {
        status: committed ? "upgraded" : "state-failed",
        usable: true,
        baseFile,
        overrideFile: userFile,
        contentsChanged,
        stateCommitted: committed,
      };
    } catch (error) {
      Logger.warn(`Could not migrate user stylesheet: ${error}`);
      return {
        status: "fallback",
        usable: true,
        baseFile,
        overrideFile: contentsChanged ? null : userFile,
        contentsChanged,
        stateCommitted: false,
      };
    }
  }

  private _replaceAndVerify(
    file: Gio.File,
    contents: Uint8Array,
    etag: string | null,
    expectedDigest: string
  ): ReplaceAttempt {
    try {
      const [success] = file.replace_contents(
        contents,
        etag,
        false,
        Gio.FileCreateFlags.REPLACE_DESTINATION,
        null
      );
      if (!success) return { writeSucceeded: false, verified: false };
      return {
        writeSucceeded: true,
        verified: this._load(file, "written user stylesheet")?.digest === expectedDigest,
      };
    } catch (error) {
      Logger.warn(`Could not replace stylesheet: ${error}`);
      return { writeSucceeded: false, verified: false };
    }
  }

  private _commitState(baseDigest: string, recordedVersion: number, rawRecordedDigest: string) {
    try {
      if (rawRecordedDigest !== baseDigest) {
        if (this._settings.set_string(STYLESHEET_DIGEST_KEY, baseDigest) === false) return false;
      }
      if (recordedVersion !== this._manifest.version) {
        if (this._settings.set_uint(STYLESHEET_VERSION_KEY, this._manifest.version) === false) {
          return false;
        }
      }
      return true;
    } catch (error) {
      Logger.warn(`Could not record stylesheet migration state: ${error}`);
      return false;
    }
  }

  private _load(file: Gio.File, label: string): LoadedFile | null {
    try {
      const [success, contents, etag] = file.load_contents(null);
      if (!success) return null;
      const bytes = contents as Uint8Array;
      const digest = digestStylesheetBytes(bytes);
      if (!digest) return null;
      return { bytes, etag, digest };
    } catch (error) {
      Logger.warn(`Could not read ${label}: ${error}`);
      return null;
    }
  }
}
