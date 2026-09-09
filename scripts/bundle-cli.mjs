#!/usr/bin/env node
// usage: node scripts/bundle-cli.mjs [--check]
// Bundle packages/cli into a single self-contained dist/main.js.
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

import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import * as esbuild from "esbuild";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const CLI_DIR = path.join(REPO_ROOT, "packages", "cli");
const ENTRY = path.join(CLI_DIR, "src", "main.ts");
const OUTFILE = path.join(CLI_DIR, "dist", "main.js");
const CORE_SRC = path.join(REPO_ROOT, "packages", "core", "src", "index.ts");

async function main(argv) {
  const checkOnly = argv.includes("--check");

  const result = await esbuild.build({
    entryPoints: [ENTRY],
    outfile: OUTFILE,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    // Node built-ins are external by default on platform:node; everything else is inlined, so
    // the published package has no runtime dependency to resolve.
    packages: "bundle",
    alias: { "@workledger/core": CORE_SRC },
    sourcemap: true,
    sourcesContent: false,
    legalComments: "none",
    logLevel: "warning",
    metafile: true,
    write: !checkOnly,
    banner: {
      js: "// workledger CLI — bundled by scripts/bundle-cli.mjs. Edit packages/cli/src instead.",
    },
  });

  const bytes = Object.values(result.metafile.outputs).find((o) => o.entryPoint)?.bytes ?? 0;

  // The published package must declare no runtime dependencies: anything left here would have to
  // be resolvable from the registry, and `workspace:*` is not.
  const pkg = JSON.parse(await readFile(path.join(CLI_DIR, "package.json"), "utf8"));
  const declared = Object.keys(pkg.dependencies ?? {});
  if (declared.length > 0) {
    console.error(
      `bundle-cli: packages/cli declares runtime dependencies (${declared.join(", ")}) but ships a ` +
        "self-contained bundle — move them to devDependencies, or stop bundling them.",
    );
    return 1;
  }

  console.log(`bundle-cli: ${path.relative(REPO_ROOT, OUTFILE)} — ${bytes} bytes, 0 runtime deps`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
