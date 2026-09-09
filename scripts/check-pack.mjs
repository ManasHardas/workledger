#!/usr/bin/env node
// usage: node scripts/check-pack.mjs [--dest <dir>]
// Pack `workledger` and assert the tarball contains exactly the files the CLI needs to run.
//
// This is the publish dry-run: `npm publish` would ship precisely what `npm pack` writes, so
// checking the tarball checks the publish. It catches the two failures that only show up after a
// release — src/, tests or tsconfig leaking into the tarball, and a `dist/` that never got built.
//
// It also asserts the declared runtime dependencies equal `EXPECTED_RUNTIME_DEPS` from
// scripts/bundle-cli.mjs (empty today): `@workledger/core` is `private: true` and reaches the CLI
// as `workspace:*`, which npm cannot resolve, so the CLI inlines it at build time instead. That
// one list is where slot 7 adds `better-sqlite3`; this script reads it rather than repeating it.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { EXPECTED_RUNTIME_DEPS, assertRuntimeDeps } from "./bundle-cli.mjs";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const CLI_DIR = path.join(REPO_ROOT, "packages", "cli");
/**
 * The exact file list, not just the top-level directories: `packages/cli` is a bin-only package
 * (no `exports`, no `types`), so the tarball is the bundle, the shim and the manifest. Checking
 * whole paths is what catches `dist/main.js.map` — whose `sources` point at files the tarball
 * does not ship and at this machine's pnpm store layout — and `dist/main.d.ts`, which imports
 * `commander` from a package that no longer declares it.
 */
const REQUIRED_FILES = ["bin/workledger", "dist/main.js", "package.json"];
/** Added by npm automatically when the file exists; allowed, never required. */
const OPTIONAL_FILES = ["README.md", "LICENSE"];

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

  const stripped = entries
    .map((e) => e.replace(/^\.?\/?package\//, ""))
    .filter((e) => e && !e.endsWith("/"))
    .sort();

  const allowed = new Set([...REQUIRED_FILES, ...OPTIONAL_FILES]);
  const unexpected = stripped.filter((e) => !allowed.has(e));
  const missing = REQUIRED_FILES.filter((e) => !stripped.includes(e));

  console.log(`check-pack: ${path.basename(tarballPath)} — ${stripped.length} files`);
  for (const e of stripped) console.log(`  ${e}`);

  let failed = false;
  if (unexpected.length > 0) {
    console.error(`check-pack: unexpected entries: ${unexpected.join(", ")}`);
    failed = true;
  }
  if (missing.length > 0) {
    console.error(`check-pack: missing required entries: ${missing.join(", ")}`);
    failed = true;
  }

  const pkg = JSON.parse(readFileSync(path.join(CLI_DIR, "package.json"), "utf8"));
  const problem = assertRuntimeDeps(pkg);
  if (problem) {
    console.error(`check-pack: ${problem}`);
    failed = true;
  }

  if (failed) return 1;
  const deps = EXPECTED_RUNTIME_DEPS.length === 0 ? "no runtime deps" : EXPECTED_RUNTIME_DEPS.join(", ");
  console.log(`check-pack: file list exact, ${deps}`);
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
