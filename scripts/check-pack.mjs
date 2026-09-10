#!/usr/bin/env node
// usage: node scripts/check-pack.mjs [--dest <dir>]
// Pack `workledger` and assert the tarball contains exactly the files the CLI needs to run.
//
// This is the publish dry-run: `npm publish` would ship precisely what `npm pack` writes, so
// checking the tarball checks the publish. It catches the two failures that only show up after a
// release — src/, tests or tsconfig leaking into the tarball, and a `dist/` that never got built.
//
// `dist/web/**` — the Vite-built UI shell — is allowed by prefix rather than by exact name
// (Vite hashes asset filenames), with `dist/web/index.html` required and the shell's gzipped
// total asserted against WEB_GZIP_CAP_BYTES so "allowed by prefix" cannot mean "unbounded".
//
// It also asserts the *packed* manifest — the one a consumer installs, not the one in the
// worktree — is exactly `PUBLISHED_FIELDS` from scripts/bundle-cli.mjs, with no `devDependencies`
// and no `scripts`, and runtime dependencies equal to `EXPECTED_RUNTIME_DEPS` (`better-sqlite3`
// alone): `@workledger/core` is `private: true` and reaches the CLI as `workspace:*`, which npm
// cannot resolve, so the CLI inlines it at build time instead, and `better-sqlite3` is a native
// module esbuild cannot inline at all. This script reads those two lists rather than repeating
// them. It then checks the worktree manifest got its development fields back, which is the only
// direct evidence that `postpack` ran.

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  EXPECTED_RUNTIME_DEPS,
  PUBLISHED_FIELDS,
  WEB_GZIP_CAP_BYTES,
  assertRuntimeDeps,
  migrationFiles,
  webGzipBytes,
} from "./bundle-cli.mjs";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const CLI_DIR = path.join(REPO_ROOT, "packages", "cli");
/**
 * The exact file list, not just the top-level directories: `packages/cli` is a bin-only package
 * (no `exports`, no `types`), so the tarball is the bundle, the shim and the manifest. Checking
 * whole paths is what catches `dist/main.js.map` — whose `sources` point at files the tarball
 * does not ship and at this machine's pnpm store layout — and `dist/main.d.ts`, which imports
 * `commander` from a package that no longer declares it.
 */
// `dist/server.js` is the second bundle `workledger serve` loads with `import("./server.js")`;
// it is separate so that `@hono/node-server`'s `node:http` imports stay out of the startup path
// of every other command (scripts/bundle-cli.mjs, SERVER_SRC).
const REQUIRED_FILES = [
  "bin/workledger",
  "dist/main.js",
  "dist/server.js",
  "dist/web/index.html",
  "package.json",
];
/**
 * Prefixes whose contents are allowed without being listed file by file. `dist/web/` is Vite
 * output — hashed asset names change on every build, so an exact list would be a lockfile nobody
 * could maintain. `dist/web/index.html` is in REQUIRED_FILES above, which is the part that
 * actually has to be there for `workledger serve` to serve anything; the size cap below is what
 * keeps "allowed" from meaning "unbounded".
 */
const ALLOWED_PREFIXES = ["dist/web/"];
/**
 * The index migrations, read from `packages/cli/src/index/migrations` rather than listed here so
 * that adding `0002_*.sql` does not also need an edit in this file. They are data the runner
 * reads at startup, so a tarball missing them is a CLI that cannot open its own index.
 */
async function requiredMigrations() {
  return (await migrationFiles()).map((name) => `dist/migrations/${name}`);
}
/** Added by npm automatically when the file exists; allowed, never required. */
const OPTIONAL_FILES = ["README.md", "LICENSE"];

function run(cmd, args, cwd) {
  return execFileSync(cmd, args, { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
}

async function main(argv) {
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

  const required = [...REQUIRED_FILES, ...(await requiredMigrations())];
  const allowed = new Set([...required, ...OPTIONAL_FILES]);
  const unexpected = stripped.filter(
    (e) => !allowed.has(e) && !ALLOWED_PREFIXES.some((prefix) => e.startsWith(prefix)),
  );
  const missing = required.filter((e) => !stripped.includes(e));

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

  const packed = JSON.parse(run("tar", ["-xzOf", tarballPath, "package/package.json"], REPO_ROOT));
  const problem = assertRuntimeDeps(packed);
  if (problem) {
    console.error(`check-pack: packed manifest — ${problem}`);
    failed = true;
  }
  // `devDependencies` and `scripts` are named rather than left to the field-list check below so
  // that the failure says which one leaked; they are the two that break the consumer install.
  for (const field of ["devDependencies", "scripts"]) {
    if (packed[field] !== undefined) {
      console.error(
        `check-pack: packed manifest still declares ${field} — packages/cli \`prepack\` ` +
          "(scripts/bundle-cli.mjs strip-manifest) did not run, or PUBLISHED_FIELDS grew an entry " +
          "the published package must not carry.",
      );
      failed = true;
    }
  }
  const extraFields = Object.keys(packed).filter((f) => !PUBLISHED_FIELDS.includes(f));
  if (extraFields.length > 0) {
    console.error(`check-pack: packed manifest has fields outside PUBLISHED_FIELDS: ${extraFields.join(", ")}`);
    failed = true;
  }

  // postpack put the development manifest back. Without this the first sign of a broken restore
  // would be an unrelated `pnpm install` failing later, or a stripped manifest getting committed.
  const source = JSON.parse(readFileSync(path.join(CLI_DIR, "package.json"), "utf8"));
  if (source.scripts?.build === undefined || source.devDependencies === undefined) {
    console.error(
      "check-pack: packages/cli/package.json is still the published manifest — `postpack` did " +
        "not restore it. Run `node scripts/bundle-cli.mjs restore-manifest`.",
    );
    failed = true;
  }
  if (existsSync(path.join(CLI_DIR, "package.json.prepack-backup"))) {
    console.error("check-pack: packages/cli/package.json.prepack-backup was left behind by `postpack`.");
    failed = true;
  }

  // The shell is allowed into the tarball by prefix, so this is the bound on what that permits.
  // Reported on every run, not only on failure: the number is the point.
  const web = await webGzipBytes();
  const kib = (n) => `${(n / 1024).toFixed(1)} KiB`;
  if (web.bytes > WEB_GZIP_CAP_BYTES) {
    console.error(
      `check-pack: dist/web is OVER THE SIZE CAP — ${web.bytes} bytes gzipped ` +
        `(${kib(web.bytes)}) against a ${kib(WEB_GZIP_CAP_BYTES)} cap.`,
    );
    failed = true;
  }

  if (failed) return 1;
  const deps = EXPECTED_RUNTIME_DEPS.length === 0 ? "no runtime deps" : EXPECTED_RUNTIME_DEPS.join(", ");
  console.log(
    `check-pack: file list exact, manifest is [${Object.keys(packed).join(", ")}], ${deps}, ` +
      `dist/web ${web.files} file(s) / ${web.bytes} bytes gzipped (${kib(web.bytes)} of ` +
      `${kib(WEB_GZIP_CAP_BYTES)} cap)`,
  );
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    console.error(`check-pack: ${error.message}`);
    process.exitCode = 1;
  }
}
