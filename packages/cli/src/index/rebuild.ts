/**
 * Rebuild the index from the ledger.
 *
 * The index is a cache (plans/feature-p1-data-flow.md §1); this is the recovery path for one
 * that was deleted, corrupted, or written by an older schema. Everything it needs lives in
 * `.workledger/sessions/*.md` frontmatter, so a rebuild never reads a transcript and never reads
 * a session body.
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

/** The `sessions` row a validated frontmatter block implies. */
function toSessionRow(
  frontmatter: SessionFrontmatter,
  repoPath: string,
  now: string,
): { session: NewSession; checkpoints: SessionFrontmatter["checkpoints"] } {
  const checkpoints = [...frontmatter.checkpoints].sort((a, b) => a.n - b.n);
  const last = checkpoints.at(-1);
  return {
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

  const parsed: Array<ReturnType<typeof toSessionRow>> = [];
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
      parsed.push(toSessionRow(result.data, repoPath, now));
    } catch (error) {
      problems.push({ file, message: error instanceof Error ? error.message : String(error) });
    }
  }

  const written = db.transaction(() => {
    db.clearRepo(repoPath);
    let checkpoints = 0;
    for (const { session, checkpoints: rows } of parsed) {
      db.insertSession(session);
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
    return checkpoints;
  });

  return { sessions: parsed.length, checkpoints: written, problems };
}
