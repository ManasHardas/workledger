#!/usr/bin/env node
// usage: node scripts/check-pack.mjs [--dest <dir>]
// Pack `workledger` and assert the tarball contains exactly bin/, dist/, package.json — plus
// README.md and LICENSE when those files exist in the package.
//
// This is the publish dry-run: `npm publish` would ship precisely what `npm pack` writes, so
// checking the tarball checks the publish. It catches the two failures that only show up after a
// release — src/, tests or tsconfig leaking into the tarball, and a `dist/` that never got built.
//
// It also asserts the package declares no runtime dependencies: `@workledger/core` is
// `private: true` and reaches the CLI as `workspace:*`, which npm cannot resolve. The CLI inlines
// it at build time instead (scripts/bundle-cli.mjs), so an empty `dependencies` block is the
// invariant that keeps the published package installable.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const CLI_DIR = path.join(REPO_ROOT, "packages", "cli");
/** Always expected. */
const REQUIRED_TOP_LEVEL = ["bin", "dist", "package.json"];
/** Included by npm automatically when the file exists; allowed, never required. */
const OPTIONAL_TOP_LEVEL = ["README.md", "LICENSE"];

function run(cmd, args, cwd) {
  return execFileSync(cmd, args, { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
}

function main(argv) {
  let dest = null;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--dest") dest = argv[++i];
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  dest ??= mkdtempSync(path.join(os.tmpdir(), "workledger-pack-"));

  const out = run("pnpm", ["-F", "workledger", "pack", "--pack-destination", dest], REPO_ROOT);
  const tarball = out
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.endsWith(".tgz"))
    .pop();
  if (!tarball) {
    console.error(`check-pack: could not find the tarball name in pnpm pack output:\n${out}`);
    return 1;
  }
  const tarballPath = path.isAbsolute(tarball) ? tarball : path.join(dest, tarball);

  const entries = run("tar", ["-tzf", tarballPath], REPO_ROOT)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const stripped = entries.map((e) => e.replace(/^\.?\/?package\//, ""));
  const topLevel = [...new Set(stripped.map((e) => e.split("/")[0]).filter(Boolean))].sort();

  const allowed = new Set([...REQUIRED_TOP_LEVEL, ...OPTIONAL_TOP_LEVEL]);
  const unexpected = topLevel.filter((e) => !allowed.has(e));
  const missing = REQUIRED_TOP_LEVEL.filter((e) => !topLevel.includes(e));

  console.log(`check-pack: ${path.basename(tarballPath)} — ${entries.length} entries`);
  for (const e of stripped.sort()) console.log(`  ${e}`);

  let failed = false;
  if (unexpected.length > 0) {
    console.error(`check-pack: unexpected top-level entries: ${unexpected.join(", ")}`);
    failed = true;
  }
  if (missing.length > 0) {
    console.error(`check-pack: missing required entries: ${missing.join(", ")}`);
    failed = true;
  }
  if (!stripped.includes("dist/main.js")) {
    console.error("check-pack: dist/main.js is not in the tarball — did the build run?");
    failed = true;
  }

  const pkg = JSON.parse(readFileSync(path.join(CLI_DIR, "package.json"), "utf8"));
  const deps = Object.keys(pkg.dependencies ?? {});
  if (deps.length > 0) {
    console.error(
      `check-pack: packages/cli declares runtime dependencies (${deps.join(", ")}); the published ` +
        "package must be self-contained — see scripts/bundle-cli.mjs",
    );
    failed = true;
  }

  if (failed) return 1;
  console.log("check-pack: file list and dependency set are exactly as expected");
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(`check-pack: ${error.message}`);
    process.exitCode = 1;
  }
}
