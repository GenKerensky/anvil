import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath, URL } from "node:url";

const root = fileURLToPath(new URL("../src/lib/tiling/", import.meta.url));
const forbidden = [
  /(?:from\s+|import\s*)["']gi:\/\//,
  /(?:from\s+|import\s*)["']resource:\/\//,
  /(?:from\s+|import\s*)["']node:/,
  /(?:from\s+|import\s*)["'][^"']*(?:extension|prefs)\//,
];

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path) : path.endsWith(".ts") ? [path] : [];
  });
}

const violations = [];
for (const file of files(root)) {
  if (!statSync(file).isFile()) continue;
  const source = readFileSync(file, "utf8");
  if (forbidden.some((pattern) => pattern.test(source))) {
    violations.push(relative(root, file));
  }
}

if (violations.length > 0) {
  throw new Error(`Portable tiling boundary violation:\n${violations.join("\n")}`);
}
