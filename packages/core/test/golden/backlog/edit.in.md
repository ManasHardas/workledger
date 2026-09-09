---
schema_version: 1
id: WL-01J9AB00000000000000000000
title: Add a size limit before upload
status: proposed
proposed_by:
  harness: claude-code
  session: 01J9AA00000000000000000000
  checkpoint: 2
  author:
    name: Ada Lovelace
    email: ada@example.com
    dome_user: null
confirmed_by: null
owner: null
priority: null
rank: 0
area: []
blocked_by: []
done_by: null
created: 2026-09-09T15:04:40Z
updated: 2026-09-09T15:04:40Z
history:
  - at: 2026-09-09T15:04:40Z
    by:
      session: 01J9AA00000000000000000000
      checkpoint: 2
    op: create
    diff: created [cp 2]
---
server rejects >50 MB with no message
