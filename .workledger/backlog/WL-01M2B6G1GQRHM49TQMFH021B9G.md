---
schema_version: 1
id: WL-01M2B6G1GQRHM49TQMFH021B9G
title: Confirm whether Jobs and Health stay off the nav
status: done
proposed_by:
  harness: claude-code
  session: 01M27KMNHRQRE6GAVGPQGK9JXB
  checkpoint: 9
  author:
    name: Manas Hardas
    email: manas.hardas@gmail.com
confirmed_by: null
owner: null
priority: null
rank: 0
area: []
blocked_by: []
done_by:
  session: 01M27KMNHRQRE6GAVGPQGK9JXB
  checkpoint: 10
created: 2026-09-12T16:16:34.837Z
updated: 2026-09-12T17:51:13.249Z
history:
  - at: 2026-09-12T16:16:34.837Z
    by:
      session: 01M27KMNHRQRE6GAVGPQGK9JXB
      checkpoint: 9
    op: create
    diff: created [cp 9]
  - at: 2026-09-12T17:51:13.249Z
    by:
      session: 01M27KMNHRQRE6GAVGPQGK9JXB
      checkpoint: 10
    op: close
    diff: "status: proposed → done"
---
A jobs test asserts nav-current, which cannot hold while they are off it
