---
schema_version: 1
id: WL-01M26FB1E3PBQ4NJ6QXW8S020V
title: "Finish #114 so sessions attributed by touched paths are resumed from their start directory, then rebuild, restart the daemon and retry the session-not-found jobs."
status: proposed
proposed_by:
  harness: claude-code
  session: 01M26DA5RBBZ89HE4RGRD72600
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
created: 2026-09-10T20:14:55.937Z
updated: 2026-09-10T20:14:55.937Z
history:
  - at: 2026-09-10T20:14:55.937Z
    by:
      session: 01M26DA5RBBZ89HE4RGRD72600
      checkpoint: 1
    op: create
    diff: created [cp 1]
---
Every workspace-started session, including card-shopify_store, fails to resume until then.
