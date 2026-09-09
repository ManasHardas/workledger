/**
 * Rebuild the index from the ledger.
 *
 * The index is a cache (plans/feature-p1-data-flow.md §1); this is the recovery path for one
 * that was deleted, corrupted, or written by an older schema. Everything it needs lives in
 * `.workledger/sessions/*.md` frontmatter, so a rebuild never reads a transcript and never reads
 * a session body.
 *
 * Two ledger files can legitimately claim one `(harness, harness_session_id)`: data-flow §2 mints
 * a *new* ulid on `resume`/`fork` when the index has no row for the harness session, so any index
 * loss followed by a resume produces exactly that pair. The unique constraint allows one of them,
 * so the rebuild picks a winner and reports the loser rather than aborting.
 *
 * Counter semantics, per data-flow §3: the "since" counters reset to zero and `last_offset`
 * comes from the last checkpoint's `transcript_offset`. `turns_total` is *not* zeroed — the last
 * checkpoint's `turns` is cumulative by contract, so restoring it is what keeps the next
 * checkpoint's `turns` from going backwards. A session with no checkpoints starts at zero.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { SessionFrontmatter, parseFrontmatter } from "@workledger/core";

import type { IndexDb, NewSession } from "./db.js";

/** One session file the rebuild could not use, and why. */
export interface RebuildProblem {
  /** Absolute path of the offending file. */
  file: string;
  message: string;
}

/** What one `rebuildIndex` run reconstructed. */
export interface RebuildResult {
  sessions: number;
  checkpoints: number;
  /**
   * Files that were skipped. A rebuild is the recovery path, so one unreadable file must not
   * cost the caller every other session; the caller reports these rather than the rebuild
   * throwing on the first bad one.
   */
  problems: RebuildProblem[];
}

/** `.md` files in `sessionsDir`, sorted, or `null` when the directory does not exist. */
function listSessionFiles(sessionsDir: string): string[] | null {
  try {
    return readdirSync(sessionsDir)
      .filter((name) => name.endsWith(".md"))
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** One session file, parsed and ready to insert. */
interface ParsedSession {
  /** Absolute path of the file it came from. */
  file: string;
  /** `started` from the frontmatter, kept for the duplicate tie-break. */
  started: string;
  session: NewSession;
  checkpoints: SessionFrontmatter["checkpoints"];
}

/** The `sessions` row a validated frontmatter block implies. */
function toSessionRow(
  frontmatter: SessionFrontmatter,
  repoPath: string,
  now: string,
  file: string,
): ParsedSession {
  const checkpoints = [...frontmatter.checkpoints].sort((a, b) => a.n - b.n);
  const last = checkpoints.at(-1);
  return {
    file,
    started: frontmatter.started,
    session: {
      ulid: frontmatter.id,
      repo_path: repoPath,
      harness: frontmatter.harness,
      harness_session_id: frontmatter.harness_session_id,
      // The transcript path is a harness-store detail that the ledger never records; the next
      // hook invocation supplies it.
      transcript_path: null,
      status: frontmatter.status,
      private: frontmatter.private ? 1 : 0,
      last_offset: last?.transcript_offset ?? 0,
      turns_total: last?.turns ?? 0,
      turns_since_checkpoint: 0,
      last_checkpoint_at: last?.at ?? null,
      last_block_turn: null,
      last_block_trigger: null,
      blocks_since_checkpoint: 0,
      last_attempt_at: null,
      last_attempt_exit: null,
      last_attempt_errors: null,
      updated_at: now,
    },
    checkpoints,
  };
}

/**
 * Rank two files claiming one `(harness, harness_session_id)`: the newest `started` wins, then
 * the one with more checkpoints, then the earlier filename. The newest is the live session — the
 * older one is the pre-resume ulid whose ledger file is already complete — and the tie-breaks
 * exist only so the choice is deterministic for a given directory.
 *
 * @returns a negative number when `a` should win
 */
function preferNewer(a: ParsedSession, b: ParsedSession): number {
  const byStarted = Date.parse(b.started) - Date.parse(a.started);
  if (byStarted !== 0 && Number.isFinite(byStarted)) return byStarted;
  const byCheckpoints = b.checkpoints.length - a.checkpoints.length;
  if (byCheckpoints !== 0) return byCheckpoints;
  return a.file.localeCompare(b.file);
}

/**
 * Keep one file per `(harness, harness_session_id)` and describe every file dropped, so the
 * unique constraint can never turn one duplicated harness session into a failed rebuild.
 */
function dedupe(parsed: ParsedSession[], problems: RebuildProblem[]): ParsedSession[] {
  const groups = new Map<string, ParsedSession[]>();
  for (const entry of parsed) {
    const key = `${entry.session.harness}\u0000${entry.session.harness_session_id}`;
    const group = groups.get(key);
    if (group) group.push(entry);
    else groups.set(key, [entry]);
  }

  const kept = new Set<ParsedSession>();
  for (const group of groups.values()) {
    const [winner, ...losers] = [...group].sort(preferNewer);
    if (!winner) continue;
    kept.add(winner);
    for (const loser of losers) {
      problems.push({
        file: loser.file,
        message:
          `harness session "${loser.session.harness_session_id}" is also claimed by ` +
          `${path.basename(winner.file)} (started ${winner.started}), which the index can only ` +
          "hold one row for; keeping the newer session",
      });
    }
  }
  // Filename order, not group order, so the rebuild is deterministic.
  return parsed.filter((entry) => kept.has(entry));
}

/**
 * Replace every row this repo owns with what `sessionsDir` says, under one `BEGIN IMMEDIATE` so
 * a concurrent hook either sees the old index or the new one but never a half-rebuilt cache.
 *
 * @param db an open index
 * @param repoPath absolute path of the repo whose rows are being replaced
 * @param sessionsDir the repo's `.workledger/sessions` directory; a missing directory rebuilds
 * to zero rows rather than throwing, which is what an enabled repo with no sessions yet looks like
 */
export function rebuildIndex(db: IndexDb, repoPath: string, sessionsDir: string): RebuildResult {
  const files = listSessionFiles(sessionsDir);
  const problems: RebuildProblem[] = [];
  const now = new Date().toISOString();

  const parsed: ParsedSession[] = [];
  for (const name of files ?? []) {
    const file = path.join(sessionsDir, name);
    try {
      const { data } = parseFrontmatter(readFileSync(file, "utf8"));
      const result = SessionFrontmatter.safeParse(data);
      if (!result.success) {
        const detail = result.error.issues
          .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
          .join("; ");
        problems.push({ file, message: `frontmatter does not match SessionFrontmatter — ${detail}` });
        continue;
      }
      parsed.push(toSessionRow(result.data, repoPath, now, file));
    } catch (error) {
      problems.push({ file, message: error instanceof Error ? error.message : String(error) });
    }
  }

  const candidates = dedupe(parsed, problems);

  const written = db.transaction(() => {
    db.clearRepo(repoPath);
    let sessions = 0;
    let checkpoints = 0;
    for (const { file, session, checkpoints: rows } of candidates) {
      try {
        db.insertSession(session);
      } catch (error) {
        // `dedupe` has already resolved the one duplicate the ledger produces by design; this
        // catches the rest — two files carrying the same `id`, most likely — without letting one
        // of them cost the caller every session that follows it in the directory.
        problems.push({
          file,
          message: `could not be indexed: ${error instanceof Error ? error.message : String(error)}`,
        });
        continue;
      }
      sessions += 1;
      for (const row of rows) {
        db.insertCheckpoint({
          session_ulid: session.ulid,
          n: row.n,
          at: row.at,
          transcript_offset: row.transcript_offset,
          turns: row.turns,
          trigger: row.trigger,
        });
        checkpoints += 1;
      }
    }
    return { sessions, checkpoints };
  });

  return { ...written, problems };
}
