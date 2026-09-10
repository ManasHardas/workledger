/**
 * Which transcripts are about which repos — docs/contracts/p8/daemon-and-api.md amendment 10
 * (#116, DL-20), replacing the cwd rule and the touched-path rule of amendment 8 (#105).
 *
 * Every transcript in both harness stores is run through one inference (`touched.ts`
 * `inferContext`) against the repos asked about plus every enabled repo the index knows: the
 * roots its content qualifies are its context repos, and the repo containing its start
 * directory is the context only when nothing qualifies. The start directory is never an
 * attribution by itself — a session started in `~/Projects/dome_workspace` that wrote in
 * `card-shopify_store` is about that card, and one started in `workledger` that wrote only in
 * a card is about the card, not workledger. A transcript may therefore count for several repos,
 * and never twice for one.
 *
 * The result is per repo, in the `StoreSession` shape the P3 planner and the backfill take, so
 * a session is queued, resumed and digested by the same code wherever it started — with `cwd`
 * set to its start directory, which is where the resume spawns and what makes the repair
 * instruction say `--repo`, and `context` carrying the inference for the session row.
 */
import { existsSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";

import { isEnabled } from "../ledger-fs.js";
import { underTempDir } from "./repo-path.js";
import { isDirectory } from "./session-cwd.js";
import { claudeTranscripts, codexSessions } from "./stores.js";
import { inferContext, repoAbove } from "./touched.js";
import type { StoreSession } from "../commands/backfill.js";
import type { IndexDb } from "../index/db.js";

/** What the inference attributed to one repo. */
export interface RepoAttribution {
  /** Claude Code sessions about the repo, newest first. */
  claude: StoreSession[];
  /** Codex sessions about the repo, newest first. */
  codex: StoreSession[];
  /** Distinct start directories of those sessions that are not inside the repo — `RepoCandidate.startedIn`. */
  startedIn: string[];
  /** How many of those sessions the content qualified, and how many are the fallback — `RepoCandidate.about`. */
  about: { content: number; fallback: number };
}

/** Options for {@link attributeTranscripts}. */
export interface AttributionOptions {
  /**
   * Directories a session started under is nobody's (amendment 2) — discovery's temp-dir rule.
   * Absent means no such rule: a repo the operator named is backfilled from every transcript
   * about it, wherever that was started.
   */
  tempDirs?: readonly string[] | undefined;
}

/** `file` with symlinks resolved, or as given when it cannot be. */
function realOr(file: string): string {
  try {
    return realpathSync(file);
  } catch {
    return file;
  }
}

/** One transcript of either harness, as the inference needs it. */
interface Transcript {
  harness: "claude-code" | "codex";
  session: StoreSession & { cwd: string };
}

/**
 * Every transcript in both stores whose start directory still exists and is not under one of
 * `tempDirs`. A start directory that is gone cannot be resumed in (#114), and one under the OS
 * temp dir was a test fixture's, not a project's (amendment 2) — when the caller says so.
 */
export function transcripts(homeDir: string, tempDirs: readonly string[] = []): Transcript[] {
  const found: Transcript[] = [];
  const usable = (cwd: string | undefined | null): cwd is string =>
    typeof cwd === "string" && isDirectory(cwd) && !underTempDir(cwd, tempDirs);
  for (const entry of claudeTranscripts(homeDir)) {
    if (!usable(entry.cwd)) continue;
    found.push({
      harness: "claude-code",
      session: {
        harnessSessionId: entry.harnessSessionId,
        file: entry.file,
        bytes: entry.bytes,
        mtimeMs: entry.mtimeMs,
        startedIso: entry.startedIso,
        cwd: entry.cwd,
      },
    });
  }
  for (const entry of codexSessions(homeDir)) {
    // A rollout with no id cannot be resumed, so it cannot be digested (stores.ts).
    if (entry.id === null || !usable(entry.cwd)) continue;
    found.push({
      harness: "codex",
      session: {
        harnessSessionId: entry.id,
        file: entry.file,
        bytes: entry.bytes,
        mtimeMs: entry.mtimeMs,
        startedIso: entry.startedIso,
        cwd: entry.cwd,
      },
    });
  }
  return found.sort((a, b) => b.session.mtimeMs - a.session.mtimeMs);
}

/**
 * The roots a session could be about, beyond `repos` and the enabled repos: the repo each
 * transcript was started in (or the start directory itself, when it is a repo), and — for a
 * start directory that is not a repo, a workspace folder — the git repos directly under it.
 * A root the caller did not ask about can still be what a session is about, and must be able
 * to win, or a session started in `workledger` that wrote only in a card under
 * `dome_workspace` would fall back to workledger whenever the card is not selected.
 */
function rootsAround(startDirs: Iterable<string>): string[] {
  const roots = new Set<string>();
  for (const startDir of startDirs) {
    const own = repoAbove(startDir);
    if (own !== undefined) roots.add(realOr(own));
    if (existsSync(path.join(startDir, ".git"))) continue;
    let entries;
    try {
      entries = readdirSync(startDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const child = path.join(startDir, entry.name);
      if (existsSync(path.join(child, ".git"))) roots.add(realOr(child));
    }
  }
  return [...roots];
}

/**
 * The context inference of every transcript in both stores, filed against `repos`.
 *
 * Every transcript is scored against `repos`, every enabled repo the index knows, and the roots
 * around every start directory ({@link rootsAround}), through the index cache, so the second
 * call over an unchanged store reads no transcript at all. Repos are keyed as given; the
 * comparison is on resolved paths, so a symlinked spelling is the same repo, and a context root
 * comes back spelled as the caller asked for it when it is one of `repos`.
 */
export async function attributeTranscripts(
  homeDir: string,
  repos: readonly string[],
  db: IndexDb,
  options: AttributionOptions = {},
): Promise<Map<string, RepoAttribution>> {
  const result = new Map<string, RepoAttribution>();
  // Resolved root → the spellings asked for. Two spellings of one repo share one scan.
  const spellings = new Map<string, string[]>();
  for (const repo of repos) {
    result.set(repo, { claude: [], codex: [], startedIn: [], about: { content: 0, fallback: 0 } });
    const key = realOr(repo);
    spellings.set(key, [...(spellings.get(key) ?? []), repo]);
  }
  if (spellings.size === 0) return result;
  const all = transcripts(homeDir, options.tempDirs);
  const candidates = [
    ...new Set([
      ...spellings.keys(),
      ...db.listRepos().map((repo) => realOr(repo.repo_path)).filter(isEnabled),
      ...rootsAround(new Set(all.map((entry) => entry.session.cwd))),
    ]),
  ];

  for (const { harness, session } of all) {
    const inference = await inferContext(session.file, candidates, session.cwd, { db, homeDir });
    const spelled = inference.contextRepos.map((context) => ({ ...context, root: spellings.get(context.root)?.[0] ?? context.root }));
    for (const context of inference.contextRepos) {
      for (const repo of spellings.get(context.root) ?? []) {
        const entry = result.get(repo) as RepoAttribution;
        (harness === "codex" ? entry.codex : entry.claude).push({ ...session, context: spelled });
        if (context.fallback === true) entry.about.fallback += 1;
        else entry.about.content += 1;
        if (inference.startRepo !== context.root && !entry.startedIn.includes(session.cwd)) entry.startedIn.push(session.cwd);
      }
    }
  }
  for (const entry of result.values()) entry.startedIn.sort();
  return result;
}
