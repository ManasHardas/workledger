---
schema_version: 1
id: WL-01JQ8ZK4T0000000000000000B
title: Round-trip frontmatter without losing unknown keys
status: accepted
proposed_by:
  harness: claude-code
  session: 01JQ8ZK4T0000000000000000A
  checkpoint: 1
  author:
    name: Ada Lovelace
    email: <redacted:email>
    dome_user: null
confirmed_by: null
owner: null
priority: p1
rank: 3
area:
  - core
  - frontmatter
blocked_by: []
done_by: null
created: 2026-09-09T12:14:03Z
updated: 2026-09-09T12:41:57Z
history:
  - at: 2026-09-09T12:14:03Z
    by:
      session: 01JQ8ZK4T0000000000000000A
      checkpoint: 1
    op: create
    diff: created from checkpoint 1
  - at: 2026-09-09T12:41:57Z
    by:
      name: Ada Lovelace
      email: <redacted:email>
      dome_user: null
    op: status
    diff: "status: proposed → accepted"
---
Unknown frontmatter keys and key order must survive a parse/stringify cycle.
