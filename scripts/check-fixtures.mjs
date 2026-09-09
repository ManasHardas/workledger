#!/usr/bin/env node
// usage: node scripts/check-fixtures.mjs [dir ...]
//        with no argument: every `test/fixtures` directory in the repo
// Re-scan committed fixtures with the vendored redaction patterns and fail on any finding.
//
// This is the *post-write* half of plans/feature-p1-data-flow.md §8 point 3: capture-fixtures.mjs
// redacts before writing, this asserts that nothing slipped through — including the case where a
// fixture was hand-edited or added without going through the capture script. CI runs it on every
// PR, so an unscrubbed byte can never reach main.
//
// Findings print a file path and a pattern name with a count. The matched text is never printed.

import { execFileSync } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { scan } from "./redact-patterns.mjs";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

/** Recursively list every file under `dir` (absolute paths, sorted, `.gitkeep` excluded). */
export async function listFiles(dir) {
  const out = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return out;
    throw error;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listFiles(full)));
    else if (entry.isFile() && entry.name !== ".gitkeep") out.push(full);
  }
  return out;
}

/**
 * Scan every file under `dir`. Returns `[{ file, name, count }]` — relative path, pattern name,
 * hit count. Never carries the matched text.
 */
export async function checkFixtures(dir) {
  const findings = [];
  for (const file of await listFiles(dir)) {
    const text = await readFile(file, "utf8");
    for (const { name, count } of scan(text)) {
      findings.push({ file: path.relative(REPO_ROOT, file), name, count });
    }
  }
  return findings;
}

/**
 * Every tracked `test/fixtures` directory in the repo, not just the one this slot created.
 * Discovery is git-driven so a new package's fixtures are covered the day they land: an explicit
 * list would have to be edited by whoever adds them, and the person adding fixtures is exactly
 * the person who should not be able to opt out of the scan.
 */
function discoverFixtureDirs() {
  const tracked = execFileSync("git", ["ls-files", "-z", "--", "*test/fixtures/*"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\0")
    .filter(Boolean);
  const dirs = new Set();
  for (const file of tracked) {
    const marker = file.indexOf("test/fixtures/");
    if (marker !== -1) dirs.add(file.slice(0, marker + "test/fixtures".length));
  }
  return [...dirs].sort();
}

async function main(argv) {
  const requested = argv.length > 0 ? argv : discoverFixtureDirs();
  if (requested.length === 0) {
    console.error("check-fixtures: no test/fixtures directory found — nothing to scan");
    return 1;
  }

  let fileCount = 0;
  const findings = [];
  for (const entry of requested) {
    const target = path.resolve(REPO_ROOT, entry);
    try {
      await stat(target);
    } catch {
      console.error(`check-fixtures: ${path.relative(REPO_ROOT, target)} does not exist`);
      return 1;
    }
    fileCount += (await listFiles(target)).length;
    findings.push(...(await checkFixtures(target)));
  }

  for (const { file, name, count } of findings) {
    console.error(`  ${file}: ${name} x${count}`);
  }
  const scope = requested.map((d) => path.relative(REPO_ROOT, path.resolve(REPO_ROOT, d)) || ".");
  console.log(
    `check-fixtures: ${fileCount} files scanned in ${scope.join(", ")} — ${findings.length} findings`,
  );
  return findings.length === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
