import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  auditBaseline,
  collectUnusedSchemaKeys,
  collectUnreferencedIcons,
  repositoryReferenceSources,
  trackedRepositoryFiles,
} from "../../../scripts/check-technical-debt.mjs";

describe("technical debt audit", () => {
  let repository;

  beforeEach(() => {
    repository = mkdtempSync(join(tmpdir(), "anvil-debt-audit-"));
    execFileSync("git", ["init", "--quiet"], { cwd: repository });
  });

  afterEach(() => {
    rmSync(repository, { force: true, recursive: true });
  });

  it("does not let ignored or untracked scratch references hide an orphaned icon", () => {
    const iconDirectory = join(repository, "src/resources/icons/hicolor/scalable/actions");
    const iconName = "orphan-symbolic.svg";
    mkdirSync(iconDirectory, { recursive: true });
    writeFileSync(join(repository, ".gitignore"), "ignored-scratch.md\n", "utf8");
    writeFileSync(join(iconDirectory, iconName), "<svg/>\n", "utf8");
    execFileSync(
      "git",
      ["add", ".gitignore", `src/resources/icons/hicolor/scalable/actions/${iconName}`],
      {
        cwd: repository,
      }
    );

    writeFileSync(join(repository, "ignored-scratch.md"), `temporary ${iconName} reference\n`);
    writeFileSync(join(repository, "untracked-scratch.md"), `temporary ${iconName} reference\n`);

    const trackedPaths = trackedRepositoryFiles(repository);
    const referenceSources = repositoryReferenceSources(repository, trackedPaths);

    expect(collectUnreferencedIcons(referenceSources, repository, trackedPaths)).toEqual([
      iconName,
    ]);
  });

  it("does not let ignored or untracked scratch references hide an unused schema key", () => {
    const schemaDirectory = join(repository, "src/schemas");
    const settingName = "orphan-setting";
    mkdirSync(schemaDirectory, { recursive: true });
    writeFileSync(join(repository, ".gitignore"), "src/ignored-scratch.ts\n", "utf8");
    writeFileSync(
      join(schemaDirectory, "org.example.test.gschema.xml"),
      `<schemalist><schema id="org.example.test"><key name="${settingName}" type="b"/></schema></schemalist>\n`,
      "utf8"
    );
    execFileSync("git", ["add", ".gitignore", "src/schemas/org.example.test.gschema.xml"], {
      cwd: repository,
    });

    mkdirSync(join(repository, "src"), { recursive: true });
    writeFileSync(join(repository, "src/ignored-scratch.ts"), `const key = "${settingName}";\n`);
    writeFileSync(join(repository, "src/untracked-scratch.ts"), `const key = "${settingName}";\n`);

    const trackedPaths = trackedRepositoryFiles(repository);

    expect(collectUnusedSchemaKeys(repository, trackedPaths)).toEqual([settingName]);
  });

  it("fails for both unexpected findings and stale baseline entries", () => {
    const failures = [];
    const logger = { log: vi.fn() };

    auditBaseline(
      "Packaged icons",
      ["expected.svg", "unexpected.svg"],
      ["expected.svg", "stale.svg"],
      failures,
      logger
    );

    expect(failures).toEqual([
      "Packaged icons has unexpected findings:\n  + unexpected.svg",
      "Packaged icons has stale allowlist entries:\n  - stale.svg",
    ]);
  });
});
