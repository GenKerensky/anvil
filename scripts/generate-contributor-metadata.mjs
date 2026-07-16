#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const defaultRepository = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function usage() {
  return `Usage: node scripts/generate-contributor-metadata.mjs [options]

Options:
  --repository PATH  Git repository to inspect (default: repository root)
  --output PATH      Generated module (default: src/lib/prefs/metadata.js)
  -h, --help         Show this help
`;
}

function parseArguments(argv) {
  let repository = defaultRepository;
  let output;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "-h" || argument === "--help") {
      process.stdout.write(usage());
      process.exit(0);
    }
    if (argument === "--repository" || argument === "--output") {
      const value = argv[index + 1];
      if (!value) throw new Error(`${argument} requires a path`);
      if (argument === "--repository") repository = resolve(value);
      else output = resolve(value);
      index += 1;
      continue;
    }
    throw new Error(`unknown argument: ${argument}`);
  }

  return {
    repository,
    output: output ?? resolve(repository, "src/lib/prefs/metadata.js"),
  };
}

function contributorLines(repository) {
  try {
    return execFileSync("git", ["-C", repository, "shortlog", "-sne", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).split("\n");
  } catch {
    return [];
  }
}

function contributors(repository) {
  const seenEmails = new Set();
  const result = [];

  for (const line of contributorLines(repository)) {
    const match = /^\s*\d+\s+(.+?)\s+<([^<>]+)>\s*$/.exec(line);
    if (!match) continue;
    const [, name, email] = match;
    if (/dependabot|noreply/i.test(`${name} ${email}`)) continue;
    const identity = email.toLowerCase();
    if (seenEmails.has(identity)) continue;
    seenEmails.add(identity);
    result.push(`${name} <${email}>`);
  }

  return result;
}

function generateModule(developers) {
  if (developers.length === 0) return "export const developers = [];\n";
  const entries = developers.map((developer) => `  ${JSON.stringify(developer)},`).join("\n");
  return `export const developers = [\n${entries}\n];\n`;
}

try {
  const { repository, output } = parseArguments(process.argv.slice(2));
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, generateModule(contributors(repository)), "utf8");
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.stderr.write(usage());
  process.exitCode = 2;
}
