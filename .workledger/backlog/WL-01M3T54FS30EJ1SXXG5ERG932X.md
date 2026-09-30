---
schema_version: 1
id: WL-01M3T54FS30EJ1SXXG5ERG932X
title: Fix the OpenCode plugin so session.idle delivers Stop
status: proposed
proposed_by:
  harness: opencode
  session: 01M3R6W20CYRWJM65H7Q6YQ1D0
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
done_by: null
created: 2026-09-30T21:57:05.954Z
updated: 2026-09-30T21:57:05.954Z
history:
  - at: 2026-09-30T21:57:05.954Z
    by:
      session: 01M3R6W20CYRWJM65H7Q6YQ1D0
      checkpoint: 1
    op: create
    diff: created [cp 1]
---
No Stop means no checkpoint prompts and live sessions are falsely swept as crashed
