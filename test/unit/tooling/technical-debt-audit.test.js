import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  auditBaseline,
  collectUnownedMarkers,
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

  it("finds raw markers only in tracked production and tooling scope", () => {
    const trackedFiles = new Map([
      [".agents/skills/testing/scripts/check.py", "# FIXME stale harness\n"],
      [".github/workflows/ci.yml", "# XXX release credentials\n"],
      ["Makefile", "# TODO package the extension\n"],
      ["docs/history.md", "TODO historical note\n"],
      ["scripts/check-technical-debt.mjs", "TODO FIXME HACK XXX\n"],
      ["scripts/release.mjs", "// FIXME publish transaction\n"],
      ["src/extension.ts", "const ready = true;\n// TODO connect owner\n// HACK temporary\n"],
      ["test/unit/example.test.ts", "// TODO test-only note\n"],
    ]);
    for (const [path, contents] of trackedFiles) {
      mkdirSync(dirname(join(repository, path)), { recursive: true });
      writeFileSync(join(repository, path), contents, "utf8");
    }
    writeFileSync(join(repository, ".gitignore"), "src/ignored.ts\n", "utf8");
    execFileSync("git", ["add", "."], { cwd: repository });

    writeFileSync(join(repository, "src/ignored.ts"), "// TODO ignored\n", "utf8");
    writeFileSync(join(repository, "src/untracked.ts"), "// FIXME untracked\n", "utf8");

    const trackedPaths = trackedRepositoryFiles(repository);

    expect(collectUnownedMarkers(repository, trackedPaths)).toEqual([
      ".agents/skills/testing/scripts/check.py:1:FIXME",
      ".github/workflows/ci.yml:1:XXX",
      "Makefile:1:TODO",
      "scripts/check-technical-debt.mjs:1:TODO",
      "scripts/check-technical-debt.mjs:1:FIXME",
      "scripts/check-technical-debt.mjs:1:HACK",
      "scripts/check-technical-debt.mjs:1:XXX",
      "scripts/release.mjs:1:FIXME",
      "src/extension.ts:2:TODO",
      "src/extension.ts:3:HACK",
    ]);
  });

  it("matches complete marker words and reports their source lines deterministically", () => {
    const sourceDirectory = join(repository, "src");
    mkdirSync(sourceDirectory, { recursive: true });
    writeFileSync(
      join(sourceDirectory, "markers.ts"),
      [
        "// TODO first TODO",
        "// TODOING MYTODO TODO_ lowercase-todo",
        "// (FIXME), HACK! XXX.",
        "// TODO-after-punctuation",
      ].join("\n"),
      "utf8"
    );
    execFileSync("git", ["add", "src/markers.ts"], { cwd: repository });

    const trackedPaths = trackedRepositoryFiles(repository);

    expect(collectUnownedMarkers(repository, trackedPaths)).toEqual([
      "src/markers.ts:1:TODO",
      "src/markers.ts:3:FIXME",
      "src/markers.ts:3:HACK",
      "src/markers.ts:3:XXX",
      "src/markers.ts:4:TODO",
    ]);
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
