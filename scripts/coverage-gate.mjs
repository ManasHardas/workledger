#!/usr/bin/env node
// usage: node scripts/coverage-gate.mjs [--base <ref>] [--threshold <pct>] [--report-only]
// Changed-lines coverage gate: of the lines this branch adds or edits under packages/**/src/**,
// at least <threshold>% of the *executable* ones must be covered by coverage/lcov.info.
//
// Whole-repo coverage percentages punish a branch for code it never touched and reward it for
// code it never tested. Changed lines are the only number a reviewer can act on, so that is the
// number the gate uses.
//
// On a `push` to main there is nothing to diff against a base branch in any meaningful sense, so
// the gate reports and exits 0 (also reachable with --report-only).
//
// Run `pnpm test:coverage` first — this script only reads the report, it never produces one.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const LCOV = path.join(REPO_ROOT, "coverage", "lcov.info");
const DEFAULT_THRESHOLD = 70;
/**
 * The set of files whose changed lines are gated: the union of vitest's coverage `include` in
 * vitest.config.ts (package sources plus scripts/*.ts) widened to the other places first-party
 * code lives — app sources under apps/, and packages/<name>/bin, since bin/workledger is real
 * logic today. If a file can be covered, a change to it has to be covered; keep this list in
 * step with vitest.config.ts.
 */
const SCOPE = [
  /^packages\/[^/]+\/src\/.+\.(?:ts|tsx|mts|cts)$/,
  /^packages\/[^/]+\/bin\/[^/]+$/,
  /^apps\/[^/]+\/src\/.+\.(?:ts|tsx|mts|cts)$/,
  /^scripts\/[^/]+\.ts$/,
];
/** git pathspec matching SCOPE, so the diff does not have to walk the whole tree. */
const SCOPE_PATHSPEC = ["packages", "apps", "scripts"];

function inScope(file) {
  return SCOPE.some((re) => re.test(file));
}

function git(args, quiet = false) {
  return execFileSync("git", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", quiet ? "ignore" : "inherit"],
  });
}

function parseArgs(argv) {
  const opts = {
    base: process.env.COVERAGE_BASE_REF ?? "origin/main",
    threshold: Number(process.env.COVERAGE_THRESHOLD ?? DEFAULT_THRESHOLD),
    reportOnly: process.env.GITHUB_EVENT_NAME === "push",
  };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--base") opts.base = argv[++i];
    else if (argv[i] === "--threshold") opts.threshold = Number(argv[++i]);
    else if (argv[i] === "--report-only") opts.reportOnly = true;
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  // A typo'd threshold would otherwise become NaN, and `NaN >= x` is false — the gate would fail
  // every branch with a message naming "NaN%".
  if (!Number.isFinite(opts.threshold) || opts.threshold < 0 || opts.threshold > 100) {
    throw new Error(`threshold must be a number between 0 and 100, got "${opts.threshold}"`);
  }
  if (!opts.base) throw new Error("--base needs a git ref");
  return opts;
}

/** The merge base of `base` and HEAD, or null when `base` is not resolvable (shallow clone). */
function mergeBase(base) {
  try {
    return git(["merge-base", base, "HEAD"], true).trim();
  } catch {
    return null;
  }
}

/**
 * Line numbers added or modified by `base...HEAD`, per file, from a zero-context diff. Only the
 * `+` side matters: a deleted line has no coverage to measure.
 */
function changedLines(base) {
  const diff = git([
    "diff",
    "--unified=0",
    "--diff-filter=ACMR",
    `${base}...HEAD`,
    "--",
    ...SCOPE_PATHSPEC,
  ]);
  const byFile = new Map();
  let file = null;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) {
      const p = line.slice(4).trim();
      file = p === "/dev/null" ? null : p.replace(/^b\//, "");
      if (file && !inScope(file)) file = null;
      if (file && !byFile.has(file)) byFile.set(file, new Set());
      continue;
    }
    if (!file || !line.startsWith("@@")) continue;
    const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (!m) continue;
    const start = Number(m[1]);
    const count = m[2] === undefined ? 1 : Number(m[2]);
    for (let i = 0; i < count; i += 1) byFile.get(file).add(start + i);
  }
  return byFile;
}

/** `{ 'packages/x/src/y.ts': Map<line, hits> }` from an lcov report. */
function parseLcov(text) {
  const byFile = new Map();
  let current = null;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("SF:")) {
      const file = line.slice(3);
      const rel = path.relative(REPO_ROOT, path.resolve(REPO_ROOT, file)).split(path.sep).join("/");
      current = byFile.get(rel) ?? new Map();
      byFile.set(rel, current);
    } else if (line.startsWith("DA:") && current) {
      const [n, hits] = line.slice(3).split(",");
      current.set(Number(n), (current.get(Number(n)) ?? 0) + Number(hits));
    } else if (line === "end_of_record") {
      current = null;
    }
  }
  return byFile;
}

function main(argv) {
  const opts = parseArgs(argv);
  const verdict = opts.reportOnly ? "report" : "gate";

  const base = mergeBase(opts.base);
  if (!base) {
    // Never silently green: a shallow checkout, a renamed base branch or a typo'd
    // COVERAGE_BASE_REF would otherwise turn the gate into a no-op that still prints a
    // pass-shaped line. Same shape as the missing-lcov branch below.
    console.error(
      `coverage-gate: base ref ${opts.base} is not resolvable — cannot compute a changed-line ` +
        "set. Fetch the base branch (actions/checkout fetch-depth: 0) or set COVERAGE_BASE_REF.",
    );
    return opts.reportOnly ? 0 : 1;
  }

  const changed = changedLines(base);
  if (changed.size === 0) {
    console.log(
      `coverage-gate: no gated source changed vs ${opts.base} ` +
        `(scope: ${SCOPE_PATHSPEC.join(", ")}) — pass`,
    );
    return 0;
  }

  if (!existsSync(LCOV)) {
    console.error("coverage-gate: coverage/lcov.info is missing — run `pnpm test:coverage` first");
    return opts.reportOnly ? 0 : 1;
  }
  const lcov = parseLcov(readFileSync(LCOV, "utf8"));

  let total = 0;
  let covered = 0;
  const rows = [];
  for (const [file, lines] of [...changed].sort()) {
    const report = lcov.get(file);
    let fileTotal = 0;
    let fileCovered = 0;
    const uncovered = [];
    for (const line of [...lines].sort((a, b) => a - b)) {
      const hits = report?.get(line);
      // A line with no DA entry is not executable (blank, comment, type-only) — not a miss.
      if (hits === undefined) continue;
      fileTotal += 1;
      if (hits > 0) fileCovered += 1;
      else uncovered.push(line);
    }
    total += fileTotal;
    covered += fileCovered;
    if (fileTotal > 0) rows.push({ file, fileTotal, fileCovered, uncovered });
  }

  if (total === 0) {
    console.log(
      `coverage-gate: ${changed.size} changed file(s), 0 executable changed lines vs ${opts.base} — pass`,
    );
    return 0;
  }

  const pct = (covered / total) * 100;
  for (const row of rows) {
    const list = row.uncovered.length > 0 ? `  uncovered: ${row.uncovered.join(", ")}` : "";
    console.log(`  ${row.file}: ${row.fileCovered}/${row.fileTotal}${list}`);
  }
  console.log(
    `coverage-gate: ${covered}/${total} changed executable lines covered = ${pct.toFixed(1)}% ` +
      `(threshold ${opts.threshold}%, base ${opts.base}, mode ${verdict})`,
  );

  if (pct + 1e-9 >= opts.threshold) return 0;
  if (opts.reportOnly) {
    console.log("coverage-gate: report-only — not failing the job");
    return 0;
  }
  console.error(`coverage-gate: below ${opts.threshold}% on changed lines`);
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(`coverage-gate: ${error.message}`);
    process.exitCode = 1;
  }
}
