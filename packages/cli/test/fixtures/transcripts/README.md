Claude Code transcript fixtures for `backfill` and `repair --extract`.

Three sessions in the shape `~/.claude/projects/<slug>/<session-id>.jsonl` holds: one JSON record
per line, the first record carrying `cwd` and `timestamp`. `__CWD__` is substituted with the temp
repo's path when a test copies these into its fake `HOME`, which is what lets the enumeration's
`cwd` check be exercised against a directory that does not exist until the test runs.

Nothing here is a real transcript: the records are the minimum that exercises the filter in
`src/extract/transcript.ts` — a text user turn, an assistant turn with a `tool_use` block that
must be dropped, a `tool_result` that must be kept and truncated, and a `thinking` block that must
be dropped.
