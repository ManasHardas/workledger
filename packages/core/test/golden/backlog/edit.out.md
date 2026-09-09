---
schema_version: 1
id: WL-01J9AB00000000000000000000
title: Cap uploads at 50 MB
status: accepted
proposed_by:
  harness: claude-code
  session: 01J9AA00000000000000000000
  checkpoint: 2
  author:
    name: Ada Lovelace
    email: ada@example.com
    dome_user: null
confirmed_by:
  name: Grace Hopper
  email: grace@example.com
  dome_user: null
  at: 2026-09-10T09:15:00Z
owner:
  name: Ada Lovelace
  email: ada@example.com
  dome_user: null
priority: p1
rank: 3
area:
  - upload
blocked_by:
  - WL-01J9AC00000000000000000000
done_by: null
created: 2026-09-09T15:04:40Z
updated: 2026-09-10T09:15:00Z
history:
  - at: 2026-09-09T15:04:40Z
    by:
      session: 01J9AA00000000000000000000
      checkpoint: 2
    op: create
    diff: created [cp 2]
  - at: 2026-09-10T09:15:00Z
    by:
      name: Grace Hopper
      email: grace@example.com
      dome_user: null
    op: edit
    diff: "title: Add a size limit before upload → Cap uploads at 50 MB"
  - at: 2026-09-10T09:15:00Z
    by:
      name: Grace Hopper
      email: grace@example.com
      dome_user: null
    op: status
    diff: "status: proposed → accepted"
  - at: 2026-09-10T09:15:00Z
    by:
      name: Grace Hopper
      email: grace@example.com
      dome_user: null
    op: assign
    diff: "owner: none → Ada Lovelace <ada@example.com>"
  - at: 2026-09-10T09:15:00Z
    by:
      name: Grace Hopper
      email: grace@example.com
      dome_user: null
    op: edit
    diff: "priority: none → p1"
  - at: 2026-09-10T09:15:00Z
    by:
      name: Grace Hopper
      email: grace@example.com
      dome_user: null
    op: edit
    diff: "confirmed_by: none → Grace Hopper <grace@example.com>"
  - at: 2026-09-10T09:15:00Z
    by:
      name: Grace Hopper
      email: grace@example.com
      dome_user: null
    op: rank
    diff: "rank: 0 → 3"
  - at: 2026-09-10T09:15:00Z
    by:
      name: Grace Hopper
      email: grace@example.com
      dome_user: null
    op: edit
    diff: "area: [] → [upload]"
  - at: 2026-09-10T09:15:00Z
    by:
      name: Grace Hopper
      email: grace@example.com
      dome_user: null
    op: edit
    diff: "blocked_by: [] → [WL-01J9AC00000000000000000000]"
---
server rejects >50 MB with no message
