#!/usr/bin/env node
// usage: node scripts/bundle-cli.mjs [bundle | strip-manifest | restore-manifest]
// Bundle packages/cli into a single self-contained dist/main.js (default), or swap its manifest
// for the published one and back (the `prepack` / `postpack` pair — see PUBLISHED_FIELDS below).
//
// Why bundle: `@workledger/core` is `private: true` and reaches the CLI as `workspace:*`. A
// published `workledger` tarball that declared that dependency would be uninstallable — npm
// cannot resolve `workspace:*`, and there is no `@workledger/core` on the registry to resolve it
// to. Rather than publishing a second package nobody imports directly, the CLI inlines core (and
// its third-party deps) at build time and ships with an empty `dependencies` block.
//
// Type checking stays with `tsc -b` (esbuild only transpiles). The build script runs `tsc -b`
// first, so a type error fails the build before this ever runs.
//
// `@workledger/core` is aliased to its *source*, matching vitest.config.ts: a stale or absent
// packages/core/dist can never turn into a mystifying red or a false green.

import { copyFile, cp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import * as esbuild from "esbuild";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const CLI_DIR = path.join(REPO_ROOT, "packages", "cli");
const ENTRY = path.join(CLI_DIR, "src", "main.ts");
const OUTFILE = path.join(CLI_DIR, "dist", "main.js");
const CORE_SRC = path.join(REPO_ROOT, "packages", "core", "src", "index.ts");
/**
 * The index migrations. They are data, not code, so esbuild has nothing to do with them: they
 * are copied next to the bundle instead, which is why `packages/cli/src/index/db.ts` can resolve
 * them with the same `new URL("./migrations/", import.meta.url)` from `src/index/db.ts` under
 * vitest and from `dist/main.js` in the published package.
 */
export const MIGRATIONS_SRC = path.join(REPO_ROOT, "packages", "cli", "src", "index", "migrations");
export const MIGRATIONS_OUT = path.join(CLI_DIR, "dist", "migrations");

/** Migration filenames, in the order the runner applies them. Read by scripts/check-pack.mjs. */
export async function migrationFiles() {
  return (await readdir(MIGRATIONS_SRC)).filter((name) => name.endsWith(".sql")).sort();
}

/**
 * Runtime dependencies the published package is allowed to declare. Everything else the CLI
 * imports is inlined, so the tarball installs with only this list to resolve.
 *
 * `better-sqlite3` is the one entry and always will be under the current design: it is a native
 * module, and esbuild cannot inline a `.node` binary. It is in `EXTERNAL` below, in
 * `packages/cli` `dependencies`, and in `pnpm-workspace.yaml` `allowBuilds` (it has a real
 * install script, unlike esbuild). The CI step that runs the packed CLI therefore does
 * `npm install --omit=dev` in the extracted directory rather than asserting `node_modules` is
 * absent.
 */
export const EXPECTED_RUNTIME_DEPS = ["better-sqlite3"];

/** Bare specifiers esbuild must not inline. Kept in step with EXPECTED_RUNTIME_DEPS. */
const EXTERNAL = ["better-sqlite3"];

/**
 * The one place the "published package declares exactly the dependencies it needs" invariant
 * lives; scripts/check-pack.mjs asserts the same thing against the tarball it just built.
 */
export function assertRuntimeDeps(pkg) {
  const declared = Object.keys(pkg.dependencies ?? {}).sort();
  const expected = [...EXPECTED_RUNTIME_DEPS].sort();
  if (declared.join(",") === expected.join(",")) return null;
  return (
    `packages/cli declares runtime dependencies [${declared.join(", ")}] but the bundle expects ` +
    `[${expected.join(", ")}] — anything not in EXPECTED_RUNTIME_DEPS is inlined by ` +
    "scripts/bundle-cli.mjs and must not also be installed from the registry."
  );
}

/**
 * The complete field list of the published manifest, in the order it is written.
 *
 * The development manifest cannot be published as-is: `devDependencies` carries
 * `@workledger/core` as `workspace:*`, which `pnpm pack` rewrites into a bare `0.0.1` that no
 * registry can resolve, so `npm install --omit=dev` inside the extracted package fails with
 * `E404 @workledger/core@0.0.1`. `scripts.build` is just as wrong in a tarball — it shells out to
 * `../../scripts/bundle-cli.mjs`, a path that only exists in this repo. Neither is needed by a
 * consumer: the bundle is already built and core is already inlined into it.
 *
 * So `prepack` swaps this subset in and `postpack` puts the original back (verified: pnpm reads
 * the lifecycle scripts before `prepack` runs, so `postpack` still fires even though the manifest
 * it swapped in has no `scripts` key). `publishConfig` was tried first and does not do this job —
 * pnpm applies `publishConfig.scripts` but ignores `publishConfig.devDependencies`, and leaves
 * `publishConfig` itself in the packed manifest.
 *
 * `type` is on the list because it is load-bearing, not metadata: `dist/main.js` is ESM and the
 * bin shim reaches it with `import()`. Drop `type: "module"` and Node parses the bundle as
 * CommonJS and the installed CLI dies on its first line.
 */
export const PUBLISHED_FIELDS = [
  "name",
  "version",
  "type",
  "description",
  "license",
  "repository",
  "bin",
  "files",
  "engines",
  "dependencies",
];

const MANIFEST = path.join(CLI_DIR, "package.json");
/**
 * Where `strip-manifest` parks the development manifest for `restore-manifest` to put back. Not
 * in `files`, so an interrupted pack can never ship it; gitignored, so one can never be committed.
 */
const MANIFEST_BACKUP = path.join(CLI_DIR, "package.json.prepack-backup");

/** The published manifest: `PUBLISHED_FIELDS` of `pkg` that are actually present, in that order. */
export function publishedManifest(pkg) {
  return Object.fromEntries(
    PUBLISHED_FIELDS.filter((field) => pkg[field] !== undefined).map((field) => [field, pkg[field]]),
  );
}

async function exists(file) {
  try {
    await readFile(file);
    return true;
  } catch {
    return false;
  }
}

/** `prepack`: park the development manifest and write the published one in its place. */
async function stripManifest() {
  // A backup already here means an earlier pack died between prepack and postpack, so the
  // manifest on disk is the *published* one and re-stripping it would lose the development
  // fields for good. Restoring first makes the pair self-healing instead.
  if (await exists(MANIFEST_BACKUP)) await restoreManifest();

  const source = await readFile(MANIFEST, "utf8");
  const published = publishedManifest(JSON.parse(source));
  const problem = assertRuntimeDeps(published);
  if (problem) {
    console.error(`bundle-cli: ${problem}`);
    return 1;
  }

  await writeFile(MANIFEST_BACKUP, source);
  await writeFile(MANIFEST, `${JSON.stringify(published, null, 2)}\n`);
  console.log(`bundle-cli: packed manifest — ${Object.keys(published).join(", ")}`);
  return 0;
}

/** `postpack`: put the development manifest back. A no-op when there is nothing parked. */
async function restoreManifest() {
  if (!(await exists(MANIFEST_BACKUP))) return 0;
  await copyFile(MANIFEST_BACKUP, MANIFEST);
  await rm(MANIFEST_BACKUP);
  return 0;
}

async function main(argv) {
  const [command = "bundle", ...rest] = argv;
  if (rest.length > 0) {
    console.error(`bundle-cli: unexpected argument "${rest[0]}" — commands take none`);
    return 1;
  }
  if (command === "strip-manifest") return stripManifest();
  if (command === "restore-manifest") return restoreManifest();
  if (command !== "bundle") {
    console.error(
      `bundle-cli: unknown command "${command}" — expected bundle, strip-manifest or restore-manifest`,
    );
    return 1;
  }

  const result = await esbuild.build({
    entryPoints: [ENTRY],
    outfile: OUTFILE,
    // Pinned so the output does not depend on where the script was invoked from: esbuild writes
    // module banners and metafile keys as paths relative to its working directory, so without
    // this `pnpm -r build` (cwd packages/cli) and `node scripts/bundle-cli.mjs` (cwd repo root)
    // produced byte-different bundles of the same source.
    absWorkingDir: REPO_ROOT,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    // Node built-ins are external by default on platform:node; everything else is inlined, so
    // the published package has no runtime dependency to resolve — except EXTERNAL.
    packages: "bundle",
    external: EXTERNAL,
    alias: { "@workledger/core": CORE_SRC },
    // No sourcemap in the published bundle: its `sources` would point at files the tarball does
    // not ship (packages/cli/src, and the local pnpm store layout for third-party code), so it
    // would be dead weight that also leaks this machine's paths. dist/main.js *is* the shipped
    // artifact; a stack trace against it is the honest one.
    sourcemap: false,
    legalComments: "none",
    logLevel: "warning",
    metafile: true,
    banner: {
      // The bundle is ESM, but the third-party code it inlines (`yaml`, reached through
      // `@workledger/core`) is CJS, and esbuild's interop shim falls back to a bare `require`
      // that ESM does not define — "Dynamic require of \"process\" is not supported" at import
      // time. Defining `require` from `createRequire` is what the shim probes for, so the
      // inlined CJS resolves against this module instead of throwing.
      js:
        "// workledger CLI — bundled by scripts/bundle-cli.mjs. Edit packages/cli/src instead.\n" +
        'import { createRequire as __workledgerCreateRequire } from "node:module";\n' +
        "const require = __workledgerCreateRequire(import.meta.url);",
    },
  });

  const bytes = Object.values(result.metafile.outputs).find((o) => o.entryPoint)?.bytes ?? 0;

  // Removed first: a migration renamed or deleted in src must not linger in dist and get applied
  // out of order by a runner that reads the directory.
  await rm(MIGRATIONS_OUT, { recursive: true, force: true });
  const migrations = await migrationFiles();
  for (const name of migrations) {
    await cp(path.join(MIGRATIONS_SRC, name), path.join(MIGRATIONS_OUT, name), { recursive: true });
  }

  // `@workledger/core` is private and reaches the CLI as `workspace:*`, which npm cannot resolve.
  // Anything left in `dependencies` would have to be resolvable from the registry.
  const pkg = JSON.parse(await readFile(path.join(CLI_DIR, "package.json"), "utf8"));
  const problem = assertRuntimeDeps(pkg);
  if (problem) {
    console.error(`bundle-cli: ${problem}`);
    return 1;
  }

  const deps = EXPECTED_RUNTIME_DEPS.length === 0 ? "0 runtime deps" : EXPECTED_RUNTIME_DEPS.join(", ");
  console.log(
    `bundle-cli: ${path.relative(REPO_ROOT, OUTFILE)} — ${bytes} bytes, ${deps}, ` +
      `${migrations.length} migration(s)`,
  );
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
