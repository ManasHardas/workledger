#!/usr/bin/env node
// usage: node scripts/check-fixtures.mjs [dir]   (default: test/fixtures)
// Re-scan committed fixtures with the vendored redaction patterns and fail on any finding.
//
// This is the *post-write* half of plans/feature-p1-data-flow.md §8 point 3: capture-fixtures.mjs
// redacts before writing, this asserts that nothing slipped through — including the case where a
// fixture was hand-edited or added without going through the capture script. CI runs it on every
// PR, so an unscrubbed byte can never reach main.
//
// Findings print a file path and a pattern name with a count. The matched text is never printed.

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

async function main(argv) {
  const target = path.resolve(REPO_ROOT, argv[0] ?? "test/fixtures");
  let fileCount;
  try {
    await stat(target);
    fileCount = (await listFiles(target)).length;
  } catch {
    console.error(`check-fixtures: ${path.relative(REPO_ROOT, target)} does not exist`);
    return 1;
  }

  const findings = await checkFixtures(target);
  for (const { file, name, count } of findings) {
    console.error(`  ${file}: ${name} x${count}`);
  }
  const scope = path.relative(REPO_ROOT, target) || ".";
  console.log(`check-fixtures: ${fileCount} files scanned in ${scope} — ${findings.length} findings`);
  return findings.length === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
