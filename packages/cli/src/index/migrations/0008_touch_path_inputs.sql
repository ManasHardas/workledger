-- 0008_touch_path_inputs — the tightened attribution rule, P8 amendment 8 as amended by #110.
--
-- A session counts for a repo when it has one write under the root, or at least five references
-- of which at least one is a *path input*: a non-Bash tool's `file_path`/`path`/`notebook_path`
-- under the root, or a Bash `cd` into it. Bash command text alone (a `grep` naming the root
-- twenty times) never attributes. The scanner therefore counts path inputs beside references
-- and writes, and the cache has to carry them.
--
-- `transcript_touches` is a cache (0006): rows scanned under the old rule carry no path-input
-- count, so the table is recreated with the new column and every transcript is rescanned once.
-- `scan_counts` on workspace session rows (0007) accumulated the same tallies; those rows start
-- over from offset 0 so the next Stop rescans the transcript under the new rule.

DROP TABLE transcript_touches;
CREATE TABLE transcript_touches (
  transcript_path TEXT NOT NULL,
  root TEXT NOT NULL,
  refs INTEGER NOT NULL,
  writes INTEGER NOT NULL,
  path_inputs INTEGER NOT NULL,
  mtime_ms REAL NOT NULL,
  size INTEGER NOT NULL,
  PRIMARY KEY (transcript_path, root)
);

UPDATE sessions SET scan_offset = 0, scan_counts = NULL WHERE workspace = 1;
