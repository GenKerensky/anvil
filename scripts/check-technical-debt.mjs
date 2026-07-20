import console from "node:console";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, extname, join, relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL, URL } from "node:url";

import ts from "typescript";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

// These baselines make existing debt visible without allowing it to grow. Remove an entry in the
// same change that removes or connects the corresponding declaration, setting, or icon.
const UNUSED_DECLARATION_BASELINE = [];

const UNUSED_SCHEMA_KEY_BASELINE = [];

const UNREFERENCED_ICON_BASELINE = [];

const RETAINED_UNREFERENCED_ICONS = [];

const UNOWNED_MARKER_BASELINE = [];

const rootBuildToolingFiles = new Set([
  ".markdownlint.json",
  ".prettierignore",
  ".prettierrc.json",
  "Makefile",
  "eslint.config.js",
  "package-lock.json",
  "package.json",
]);

const rawDebtMarkerNames = [
  ["TO", "DO"].join(""),
  ["FIX", "ME"].join(""),
  ["HA", "CK"].join(""),
  ["X", "XX"].join(""),
];
const rawDebtMarkerPattern = new RegExp(`\\b(?:${rawDebtMarkerNames.join("|")})\\b`, "g");

const unusedDiagnosticCodes = new Set([6133, 6192, 6196]);
const textExtensions = new Set([
  ".cjs",
  ".css",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".po",
  ".pot",
  ".py",
  ".scss",
  ".sh",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".ui",
  ".xml",
  ".yaml",
  ".yml",
]);

export function trackedRepositoryFiles(root = repositoryRoot) {
  const output = execFileSync("git", ["ls-files", "-z"], {
    cwd: root,
    encoding: "utf8",
  });

  return output
    .split("\0")
    .filter(Boolean)
    .map((path) => resolve(root, path))
    .filter(existsSync);
}

function relativePath(path, root = repositoryRoot) {
  return relative(root, path).replaceAll("\\", "/");
}

function diagnosticName(diagnostic) {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, " ");
  return /^'([^']+)'/.exec(message)?.[1] ?? message;
}

function collectUnusedDeclarations(root = repositoryRoot) {
  const configPath = join(root, "tsconfig.src.json");
  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  if (configFile.error) {
    throw new Error(ts.formatDiagnostic(configFile.error, formatHost(root)));
  }

  const config = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    root,
    {
      composite: false,
      incremental: false,
      noEmit: true,
      noUnusedLocals: true,
      noUnusedParameters: true,
    },
    configPath
  );
  if (config.errors.length > 0) {
    throw new Error(ts.formatDiagnostics(config.errors, formatHost(root)));
  }

  const program = ts.createProgram({
    options: config.options,
    projectReferences: config.projectReferences,
    rootNames: config.fileNames,
  });

  return ts
    .getPreEmitDiagnostics(program)
    .filter((diagnostic) => unusedDiagnosticCodes.has(diagnostic.code) && diagnostic.file)
    .map(
      (diagnostic) =>
        `${relativePath(diagnostic.file.fileName, root)}:${diagnostic.code}:${diagnosticName(
          diagnostic
        )}`
    )
    .sort();
}

export function collectUnusedSchemaKeys(
  root = repositoryRoot,
  trackedPaths = trackedRepositoryFiles(root)
) {
  const schemaKeys = new Set();
  for (const file of trackedPaths.filter((path) => {
    const repositoryPath = relativePath(path, root);
    return repositoryPath.startsWith("src/schemas/") && path.endsWith(".gschema.xml");
  })) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/<key\b[^>]*\bname="([^"]+)"/g)) {
      schemaKeys.add(match[1]);
    }
  }

  const referenceSources = trackedPaths
    .filter((path) => {
      const relativeSourcePath = relativePath(path, root);
      return (
        relativeSourcePath.startsWith("src/") &&
        !relativeSourcePath.startsWith("src/schemas/") &&
        !relativeSourcePath.startsWith("src/resources/icons/") &&
        isTextFile(path)
      );
    })
    .map((path) => readFileSync(path, "utf8"));

  return [...schemaKeys]
    .filter((key) => !referenceSources.some((source) => source.includes(key)))
    .sort();
}

function isTextFile(path) {
  return textExtensions.has(extname(path).toLowerCase()) || path.endsWith("/Makefile");
}

export function repositoryReferenceSources(
  root = repositoryRoot,
  trackedPaths = trackedRepositoryFiles(root)
) {
  const auditFile = resolve(root, "scripts/check-technical-debt.mjs");
  const inventoryPlan = resolve(root, "docs/plans/technical-debt-inventory-and-remediation.md");
  const iconRoot = resolve(root, "src/resources/icons");

  return trackedPaths
    .filter((path) => {
      const absolutePath = resolve(path);
      return (
        isTextFile(path) &&
        absolutePath !== auditFile &&
        absolutePath !== inventoryPlan &&
        !absolutePath.startsWith(`${iconRoot}/`)
      );
    })
    .map((path) => readFileSync(path, "utf8"));
}

function isRootBuildToolingFile(repositoryPath) {
  if (repositoryPath.includes("/")) return false;

  return (
    rootBuildToolingFiles.has(repositoryPath) ||
    /^tsconfig(?:\.[^.]+)*\.json$/.test(repositoryPath) ||
    /^vitest(?:\.[^.]+)*\.config\.[cm]?js$/.test(repositoryPath)
  );
}

function isCanonicalSkillScript(repositoryPath) {
  return /^\.agents\/skills\/.+\/scripts\/.+$/.test(repositoryPath);
}

export function collectUnownedMarkers(
  root = repositoryRoot,
  trackedPaths = trackedRepositoryFiles(root)
) {
  const scopedPaths = trackedPaths
    .filter((path) => {
      const repositoryPath = relativePath(path, root);
      const rootBuildToolingFile = isRootBuildToolingFile(repositoryPath);
      const canonicalSkillScript = isCanonicalSkillScript(repositoryPath);
      return (
        (isTextFile(path) || rootBuildToolingFile) &&
        (repositoryPath.startsWith("src/") ||
          repositoryPath.startsWith("scripts/") ||
          repositoryPath.startsWith(".github/workflows/") ||
          canonicalSkillScript ||
          rootBuildToolingFile)
      );
    })
    .sort((left, right) => {
      const leftPath = relativePath(left, root);
      const rightPath = relativePath(right, root);
      return leftPath < rightPath ? -1 : leftPath > rightPath ? 1 : 0;
    });

  const findings = [];
  for (const path of scopedPaths) {
    const repositoryPath = relativePath(path, root);
    const lines = readFileSync(path, "utf8").split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      const markers = new Set([...line.matchAll(rawDebtMarkerPattern)].map((match) => match[0]));
      for (const marker of markers) findings.push(`${repositoryPath}:${index + 1}:${marker}`);
    }
  }

  return findings;
}

export function collectUnreferencedIcons(
  referenceSources,
  root = repositoryRoot,
  trackedPaths = trackedRepositoryFiles(root)
) {
  const iconRoot = resolve(root, "src/resources/icons");
  return trackedPaths
    .filter(
      (path) =>
        path.endsWith(".svg") &&
        (resolve(path) === iconRoot || resolve(path).startsWith(`${iconRoot}/`))
    )
    .map((path) => basename(path))
    .filter((file) => {
      const iconName = file.slice(0, -extname(file).length);
      return !referenceSources.some((source) => source.includes(file) || source.includes(iconName));
    })
    .sort();
}

function difference(left, right) {
  const remaining = [...right];
  return left.filter((item) => {
    const index = remaining.indexOf(item);
    if (index < 0) return true;
    remaining.splice(index, 1);
    return false;
  });
}

export function auditBaseline(label, actual, baseline, failures, logger = console) {
  const unexpected = difference(actual, baseline);
  const stale = difference(baseline, actual);
  logger.log(`${label}: ${actual.length} acknowledged`);
  for (const finding of actual) logger.log(`  - ${finding}`);

  if (unexpected.length > 0) {
    failures.push(
      `${label} has unexpected findings:\n${unexpected.map((x) => `  + ${x}`).join("\n")}`
    );
  }
  if (stale.length > 0) {
    failures.push(
      `${label} has stale allowlist entries:\n${stale.map((x) => `  - ${x}`).join("\n")}`
    );
  }
}

function formatHost(root) {
  return {
    getCanonicalFileName: (file) => file,
    getCurrentDirectory: () => root,
    getNewLine: () => "\n",
  };
}

export function runTechnicalDebtAudit(root = repositoryRoot, logger = console) {
  // Take one tracked-file snapshot so every scanner evaluates the same repository inputs. Current
  // contents of modified tracked files remain visible; ignored and untracked scratch files cannot
  // add references that conceal a finding.
  const trackedPaths = trackedRepositoryFiles(root);
  const failures = [];
  const unusedDeclarations = collectUnusedDeclarations(root);
  const unusedSchemaKeys = collectUnusedSchemaKeys(root, trackedPaths);
  const unownedMarkers = collectUnownedMarkers(root, trackedPaths);
  const referenceSources = repositoryReferenceSources(root, trackedPaths);
  const allUnreferencedIcons = collectUnreferencedIcons(referenceSources, root, trackedPaths);
  const retainedIcons = allUnreferencedIcons.filter((icon) =>
    RETAINED_UNREFERENCED_ICONS.includes(icon)
  );
  const debtIcons = allUnreferencedIcons.filter(
    (icon) => !RETAINED_UNREFERENCED_ICONS.includes(icon)
  );

  logger.log("Technical debt baseline audit\n");
  auditBaseline(
    "Unused TypeScript declarations",
    unusedDeclarations,
    UNUSED_DECLARATION_BASELINE,
    failures,
    logger
  );
  auditBaseline(
    "Unused GSettings schema keys",
    unusedSchemaKeys,
    UNUSED_SCHEMA_KEY_BASELINE,
    failures,
    logger
  );
  auditBaseline(
    "Unowned raw debt markers",
    unownedMarkers,
    UNOWNED_MARKER_BASELINE,
    failures,
    logger
  );
  auditBaseline(
    "Unreferenced packaged icons",
    debtIcons,
    UNREFERENCED_ICON_BASELINE,
    failures,
    logger
  );
  auditBaseline(
    "Retained unreferenced packaged icons",
    retainedIcons,
    RETAINED_UNREFERENCED_ICONS,
    failures,
    logger
  );

  if (failures.length > 0) {
    logger.error(`\nTechnical debt audit failed:\n\n${failures.join("\n\n")}`);
  } else {
    logger.log("\nTechnical debt audit passed; current findings match the acknowledged baseline.");
  }

  return failures;
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(resolve(entrypoint)).href) {
  const failures = runTechnicalDebtAudit();
  if (failures.length > 0) process.exitCode = 1;
}
