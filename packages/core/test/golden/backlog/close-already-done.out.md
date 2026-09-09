---
schema_version: 1
id: WL-01J9AB00000000000000000000
title: Add a size limit before upload
status: done
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
done_by:
  session: 01J9AA00000000000000000000
  checkpoint: 4
created: 2026-09-09T15:04:40Z
updated: 2026-09-10T09:00:00Z
history:
  - at: 2026-09-09T15:04:40Z
    by:
      session: 01J9AA00000000000000000000
      checkpoint: 2
    op: create
    diff: created [cp 2]
  - at: 2026-09-09T15:40:00Z
    by:
      session: 01J9AA00000000000000000000
      checkpoint: 3
    op: update
    diff: "why: ops confirmed the limit is fixed at 50 MB"
  - at: 2026-09-09T16:10:00Z
    by:
      session: 01J9AA00000000000000000000
      checkpoint: 4
    op: close
    diff: "status: proposed → done"
  - at: 2026-09-10T09:00:00Z
    by:
      session: 01J9BB00000000000000000000
      checkpoint: 1
    op: close
    diff: already done
---
server rejects >50 MB with no message

- [cp 3] ops confirmed the limit is fixed at 50 MB
