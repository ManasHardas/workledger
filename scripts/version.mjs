#!/usr/bin/env node
// usage: node scripts/version.mjs <x.y.z>   (or: pnpm run version <x.y.z>)
// Set the version of packages/core and packages/cli in lockstep.
//
// The two packages are one release: the CLI bundles core at build time (scripts/bundle-cli.mjs),
// so a core change ships as a CLI version and there is no scenario where the numbers should
// diverge. `workledger --version` reads packages/cli/package.json, so that file is the one users
// see — this script keeps core's copy honest.
//
// The cli -> core range stays `workspace:*` on purpose: it is never published (core is inlined),
// and pinning it to an exact version would just be one more thing to forget to bump.

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const PACKAGES = ["packages/core", "packages/cli"];
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

const VERSION_LINE = /^(?<indent>[ \t]*)"version"(?<gap>\s*:\s*)"(?<value>[^"]*)"/m;

async function bump(pkgDir, version) {
  const file = path.join(REPO_ROOT, pkgDir, "package.json");
  const text = await readFile(file, "utf8");
  const pkg = JSON.parse(text);
  const match = VERSION_LINE.exec(text);
  if (!match || match.groups.value !== pkg.version) {
    throw new Error(`${pkgDir}/package.json: could not locate the top-level "version" field`);
  }
  // A textual edit, not a re-serialize: JSON.stringify would reflow every inline array in the
  // file and turn a one-field bump into a noisy diff.
  const patched = text.replace(
    VERSION_LINE,
    `${match.groups.indent}"version"${match.groups.gap}"${version}"`,
  );
  await writeFile(file, patched);
  return { name: pkg.name, previous: pkg.version };
}

async function main(argv) {
  const version = argv[0];
  if (!version || version === "--help" || version === "-h") {
    console.log("usage: node scripts/version.mjs <x.y.z>");
    console.log(`bumps ${PACKAGES.join(" and ")} in lockstep`);
    return version ? 0 : 1;
  }
  if (!SEMVER.test(version)) {
    console.error(`version: "${version}" is not a semver version (expected x.y.z)`);
    return 1;
  }
  for (const pkgDir of PACKAGES) {
    const { name, previous } = await bump(pkgDir, version);
    console.log(`  ${name}: ${previous} -> ${version}`);
  }
  console.log(
    "version: bumped. `pnpm install --frozen-lockfile` still passes — the cli -> core range is " +
      "`workspace:*`, which no version bump invalidates.",
  );
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
