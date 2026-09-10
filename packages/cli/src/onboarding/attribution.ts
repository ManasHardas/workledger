/**
 * Which transcripts count for which repos beyond the directory they were started in —
 * docs/contracts/p8/daemon-and-api.md amendment 8 (#105).
 *
 * The cwd rule (`discover.ts`, `enumerateStore`, `enumerateCodexStore`) attributes a session to
 * the repo its working directory is in. This is the second rule beside it: every other candidate
 * root the transcript's tool inputs name at least {@link MIN_REFERENCES} times, or wrote under
 * once, gets the session too (`touched.ts`). A transcript may therefore count for several repos;
 * it never counts twice for one, because the root its cwd is in is left to the cwd rule.
 *
 * The result is per repo, in the `StoreSession` shape the P3 planner and the backfill already
 * take, so a touched session is queued, resumed and digested by the same code as any other —
 * with `cwd` set to where the session actually started, which is what the resume spawns in and
 * what makes the repair instruction say `--repo`.
 */
import { realpathSync } from "node:fs";

import { OS_TEMP_DIRS, underTempDir } from "./repo-path.js";
import { isDirectory, sessionRepoOf } from "./session-cwd.js";
import { claudeTranscripts, codexSessions } from "./stores.js";
import { meetsRule, touchedRoots } from "./touched.js";
import type { StoreSession } from "../commands/backfill.js";
import type { IndexDb } from "../index/db.js";

/** What the touched-path rule attributed to one repo. */
export interface RepoAttribution {
  /** Claude Code sessions attributed by touched paths, newest first. */
  claude: StoreSession[];
  /** Codex sessions attributed by touched paths, newest first. */
  codex: StoreSession[];
  /** Distinct start directories of those sessions — `RepoCandidate.startedIn`. */
  startedIn: string[];
}

/** Options for {@link attributeTranscripts}. */
export interface AttributionOptions {
  /** Directories nothing under is a project; the OS temp dirs when absent. */
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

/** One transcript of either harness, as the scan needs it. */
interface Transcript {
  harness: "claude-code" | "codex";
  session: StoreSession & { cwd: string };
}

/** Every transcript in both stores whose start directory still exists and is not scratch. */
function transcripts(homeDir: string, tempDirs: readonly string[]): Transcript[] {
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
  return found;
}

/**
 * The touched-path attribution of every transcript in both stores to `repos`.
 *
 * Every transcript is scanned against every repo but the one its cwd is in (`sessionRepoOf`, the
 * cwd rule's own reckoning), through the index cache, so the second call over an unchanged store
 * reads no transcript at all. Repos are keyed as given; the comparison is on resolved paths, so
 * a symlinked spelling is the same repo.
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
    result.set(repo, { claude: [], codex: [], startedIn: [] });
    const key = realOr(repo);
    spellings.set(key, [...(spellings.get(key) ?? []), repo]);
  }
  if (spellings.size === 0) return result;
  const keys = [...spellings.keys()];
  const tempDirs = options.tempDirs ?? OS_TEMP_DIRS;

  const all = transcripts(homeDir, tempDirs).sort((a, b) => b.session.mtimeMs - a.session.mtimeMs);
  for (const { harness, session } of all) {
    const own = realOr(sessionRepoOf(session.cwd));
    const candidates = keys.filter((key) => key !== own);
    if (candidates.length === 0) continue;
    const tallies = await touchedRoots(db, session.file, candidates, { cwd: session.cwd, homeDir });
    for (const [key, tally] of tallies) {
      if (!meetsRule(tally)) continue;
      for (const repo of spellings.get(key) ?? []) {
        const entry = result.get(repo) as RepoAttribution;
        (harness === "codex" ? entry.codex : entry.claude).push({ ...session });
        if (!entry.startedIn.includes(session.cwd)) entry.startedIn.push(session.cwd);
      }
    }
  }
  for (const entry of result.values()) entry.startedIn.sort();
  return result;
}
