#!/usr/bin/env node
// usage: node scripts/capture-fixtures.mjs [--slug <project-slug>] [--count <n>] [--out <dir>]
//        node scripts/capture-fixtures.mjs --verify [dir]
//        node scripts/capture-fixtures.mjs --help
//
// Copies the N most recent Claude Code transcripts off this machine into test/fixtures/, and
// synthesizes the hook payload fixtures described by docs/contracts/p1/hooks-claude-code.md.
//
// Every byte is redacted *before* it is written (plans/feature-p1-data-flow.md §8 point 3): the
// script never writes a file it has not already run through scripts/redact-patterns.mjs, and it
// re-scans the output directory afterwards, failing if anything hit. Findings name a file path
// and a pattern name; the matched text is never printed (CLAUDE.md: transcript excerpts never
// enter the repo).

import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { checkFixtures } from "./check-fixtures.mjs";
import { redact, scan } from "./redact-patterns.mjs";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const PROJECTS_DIR = path.join(os.homedir(), ".claude", "projects");

const DEFAULT_COUNT = 3;
/** Hard ceiling per transcript. Big enough that byte-threshold tests stay meaningful. */
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
/** Never truncate a transcript below this — a 10 KB fixture does not exercise the size paths. */
const MIN_BYTES = 50 * 1024;

const HELP = `capture-fixtures — copy scrubbed Claude Code transcripts + hook payloads into test/fixtures/

  node scripts/capture-fixtures.mjs [options]
  node scripts/capture-fixtures.mjs --verify [dir]

Options
  --slug <slug>    ~/.claude/projects/<slug> to read transcripts from.
                   Default: the slug for the current working directory, falling back to the
                   project directory holding the most recently modified transcript.
  --count <n>      How many of the most recent transcripts to copy (default ${DEFAULT_COUNT}).
  --out <dir>      Fixture root (default test/fixtures), relative to the repo root.
  --max-bytes <n>  Per-transcript byte cap (default ${DEFAULT_MAX_BYTES}); truncation happens on a
                   line boundary and never takes a file below ${MIN_BYTES} bytes.
  --verify [dir]   Do not capture; scan an existing fixture directory and report the finding
                   count. Exits 0 only on "0 findings".
  --list-slugs     Print the available project slugs and their transcript counts.
  --help           This text.

Redaction (scripts/redact-patterns.mjs, shared with scripts/check-fixtures.mjs)
  Absolute home paths      -> /home/user
  Emails, AWS keys, GitHub tokens, Slack tokens, JWTs, Bearer tokens, private key blocks,
  generic api-key assignments -> <redacted:PATTERN-NAME>
`;

function parseArgs(argv) {
  const opts = {
    slug: undefined,
    count: DEFAULT_COUNT,
    out: "test/fixtures",
    maxBytes: DEFAULT_MAX_BYTES,
    verify: undefined,
    listSlugs: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--help":
      case "-h":
        opts.help = true;
        break;
      case "--list-slugs":
        opts.listSlugs = true;
        break;
      case "--slug":
        opts.slug = argv[++i];
        break;
      case "--count":
        opts.count = Number(argv[++i]);
        break;
      case "--out":
        opts.out = argv[++i];
        break;
      case "--max-bytes":
        opts.maxBytes = Number(argv[++i]);
        break;
      case "--verify":
        // Optional positional: `--verify` alone means "the default fixture dir".
        opts.verify = argv[i + 1] && !argv[i + 1].startsWith("-") ? argv[++i] : "test/fixtures";
        break;
      default:
        throw new Error(`unknown argument: ${arg} (try --help)`);
    }
  }
  if (!Number.isInteger(opts.count) || opts.count < 1) {
    throw new Error("--count must be a positive integer");
  }
  return opts;
}

/** Claude Code's project-directory slug: the absolute path with non-alphanumerics as dashes. */
export function slugForCwd(cwd) {
  return cwd.replace(/[^A-Za-z0-9]/g, "-");
}

async function listProjectDirs() {
  const entries = await readdir(PROJECTS_DIR, { withFileTypes: true });
  const dirs = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const transcripts = await listTranscripts(path.join(PROJECTS_DIR, entry.name));
    dirs.push({ slug: entry.name, transcripts });
  }
  return dirs;
}

/** `*.jsonl` under `dir`, newest first, with size and mtime. */
async function listTranscripts(dir) {
  let names;
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const files = [];
  for (const name of names) {
    if (!name.endsWith(".jsonl")) continue;
    const full = path.join(dir, name);
    const info = await stat(full);
    if (info.isFile()) files.push({ name, full, size: info.size, mtimeMs: info.mtimeMs });
  }
  return files.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

async function resolveSlug(requested) {
  if (requested) {
    const dir = path.join(PROJECTS_DIR, requested);
    const transcripts = await listTranscripts(dir);
    if (transcripts.length === 0) throw new Error(`no transcripts under ${dir}`);
    return { slug: requested, transcripts };
  }
  const own = slugForCwd(process.cwd());
  const ownTranscripts = await listTranscripts(path.join(PROJECTS_DIR, own));
  if (ownTranscripts.length > 0) return { slug: own, transcripts: ownTranscripts };

  // Fall back to whichever project has the most recent transcript — in a git worktree the cwd
  // slug never matches, and "the session I just ran" is the useful default.
  const dirs = (await listProjectDirs()).filter((d) => d.transcripts.length > 0);
  if (dirs.length === 0) throw new Error(`no transcripts found under ${PROJECTS_DIR}`);
  dirs.sort((a, b) => b.transcripts[0].mtimeMs - a.transcripts[0].mtimeMs);
  return dirs[0];
}

/**
 * Cut `buffer` at the last newline at or before `maxBytes` so the fixture stays valid JSONL.
 * The cut is never taken below MIN_BYTES: a fixture small enough to skip the size-threshold
 * paths is worse than a slightly oversized one.
 */
function truncateOnLineBoundary(buffer, maxBytes) {
  const cut = Math.min(buffer.length, Math.max(maxBytes, MIN_BYTES));
  if (cut === buffer.length) return buffer;
  const lastNewline = buffer.subarray(0, cut).lastIndexOf(0x0a);
  return lastNewline >= MIN_BYTES ? buffer.subarray(0, lastNewline + 1) : buffer.subarray(0, cut);
}

/**
 * The local account name, in the forms it shows up in outside a path: the `ls -l` owner column,
 * a git remote, a GitHub handle. This one is machine-derived rather than vendored, so
 * check-fixtures.mjs cannot re-verify it in CI (the runner has a different username) — it runs
 * here, at capture time, where the name is known.
 */
function localIdentityPatterns() {
  const names = new Set([os.userInfo().username, path.basename(os.homedir())]);
  return [...names]
    .filter((n) => n && n.length >= 4 && n !== "user")
    .map((n) => new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"));
}

/**
 * Redact and write. Asserts on the *redacted* text before the write, so an unscrubbed byte can
 * never reach the fixture tree even if the process is killed mid-run.
 */
async function writeScrubbed(file, text) {
  let input = text;
  for (const re of localIdentityPatterns()) input = input.replace(re, "user");
  const { text: scrubbed, findings } = redact(input);
  const residual = scan(scrubbed);
  if (residual.length > 0) {
    const names = residual.map((f) => `${f.name} x${f.count}`).join(", ");
    throw new Error(
      `refusing to write ${path.relative(REPO_ROOT, file)}: redaction left ${names} — ` +
        "drop the fixture or extend scripts/redact-patterns.mjs",
    );
  }
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, scrubbed);
  return { bytes: Buffer.byteLength(scrubbed), findings };
}

/**
 * Hook payload fixtures. Field lists are exactly those in docs/contracts/p1/hooks-claude-code.md
 * §"Inputs consumed" — the fields the adapter reads plus the ones it explicitly ignores, so the
 * "unknown fields are ignored" rule has something to ignore.
 */
function hookFixtures({ sessionId, transcriptPath, cwd }) {
  const base = { session_id: sessionId, transcript_path: transcriptPath, cwd };
  const files = [];

  for (const source of ["startup", "resume", "clear", "compact", "fork"]) {
    files.push({
      name: `session-start-${source}.json`,
      payload: {
        ...base,
        hook_event_name: "SessionStart",
        source,
        model: "claude-opus-4-6-20260401",
        permission_mode: "default",
      },
    });
  }

  for (const active of [false, true]) {
    files.push({
      name: `stop-hook-active-${active}.json`,
      payload: {
        ...base,
        hook_event_name: "Stop",
        stop_hook_active: active,
        last_assistant_message: "Done — the build is green and the branch is pushed.",
        permission_mode: "default",
      },
    });
  }

  for (const reason of ["clear", "resume", "logout", "prompt_input_exit", "other"]) {
    files.push({
      name: `session-end-${reason}.json`,
      payload: { ...base, hook_event_name: "SessionEnd", reason },
    });
  }

  return files;
}

async function capture(opts) {
  const outRoot = path.resolve(REPO_ROOT, opts.out);
  const { slug, transcripts } = await resolveSlug(opts.slug);
  const selected = transcripts.slice(0, opts.count);

  console.log(`capture-fixtures: slug ${slug} (${transcripts.length} transcripts available)`);
  if (selected.length < opts.count) {
    console.log(
      `capture-fixtures: only ${selected.length} transcript(s) available, asked for ${opts.count}`,
    );
  }

  const written = [];
  for (const t of selected) {
    const raw = truncateOnLineBoundary(await readFile(t.full), opts.maxBytes);
    const target = path.join(outRoot, "transcripts", t.name);
    const { bytes, findings } = await writeScrubbed(target, raw.toString("utf8"));
    written.push({ file: path.relative(REPO_ROOT, target), bytes, source: t.size });
    const summary = findings.map((f) => `${f.name} x${f.count}`).join(", ") || "nothing to redact";
    console.log(
      `  transcripts/${t.name}: ${t.size} -> ${bytes} bytes; redacted ${summary}`,
    );
  }

  // Hook payloads point at the newest captured transcript so a fixture-driven test can read a
  // real transcript through the path in the payload.
  const anchor = selected[0];
  const anchorPath = anchor
    ? `/home/user/.claude/projects/${slug}/${anchor.name}`
    : "/home/user/.claude/projects/example/session.jsonl";
  const sessionId = anchor ? path.basename(anchor.name, ".jsonl") : "00000000-0000-0000-0000-000000000000";

  for (const { name, payload } of hookFixtures({
    sessionId,
    transcriptPath: anchorPath,
    cwd: "/home/user/Projects/workledger",
  })) {
    const target = path.join(outRoot, "hooks", name);
    const { bytes } = await writeScrubbed(target, `${JSON.stringify(payload, null, 2)}\n`);
    written.push({ file: path.relative(REPO_ROOT, target), bytes, source: bytes });
  }
  console.log(`  hooks/: ${hookFixtures({ sessionId, transcriptPath: anchorPath, cwd: "." }).length} payloads`);

  return verify(opts.out);
}

async function verify(dir) {
  const target = path.resolve(REPO_ROOT, dir);
  const findings = await checkFixtures(target);
  for (const { file, name, count } of findings) console.error(`  ${file}: ${name} x${count}`);
  console.log(`capture-fixtures: ${findings.length} findings in ${path.relative(REPO_ROOT, target)}`);
  return findings.length === 0 ? 0 : 1;
}

async function main(argv) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (error) {
    console.error(`capture-fixtures: ${error.message}`);
    return 1;
  }
  if (opts.help) {
    console.log(HELP);
    return 0;
  }
  if (opts.listSlugs) {
    for (const { slug, transcripts } of await listProjectDirs()) {
      console.log(`${String(transcripts.length).padStart(4)}  ${slug}`);
    }
    return 0;
  }
  try {
    return opts.verify !== undefined ? await verify(opts.verify) : await capture(opts);
  } catch (error) {
    console.error(`capture-fixtures: ${error.message}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
