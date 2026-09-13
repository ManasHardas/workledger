---
schema_version: 1
id: WL-01M27MY3DNWSS4AMSKF65TQ2K1
title: Remove the p8-x-shell worktree after the merge
status: done
proposed_by:
  harness: claude-code
  session: 01M27KMNHRQRE6GAVGPQGK9JXB
  checkpoint: 1
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
  checkpoint: 2
created: 2026-09-11T07:11:57.875Z
updated: 2026-09-11T07:16:38.781Z
history:
  - at: 2026-09-11T07:11:57.875Z
    by:
      session: 01M27KMNHRQRE6GAVGPQGK9JXB
      checkpoint: 1
    op: create
    diff: created [cp 1]
  - at: 2026-09-11T07:16:38.781Z
    by:
      session: 01M27KMNHRQRE6GAVGPQGK9JXB
      checkpoint: 2
    op: close
    diff: "status: proposed → done"
---
It stays on disk until the branch is merged
