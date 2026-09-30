---
schema_version: 1
id: WL-01M2DWKEVGJZVY21NEQKW6AKTX
title: Move the release workflow to npm trusted publishing with provenance
status: proposed
proposed_by:
  harness: claude-code
  session: 01M2C2WMACH589KZV1BE8VVQ85
  checkpoint: 7
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
created: 2026-09-13T17:21:24.335Z
updated: 2026-09-13T17:21:24.335Z
history:
  - at: 2026-09-13T17:21:24.335Z
    by:
      session: 01M2C2WMACH589KZV1BE8VVQ85
      checkpoint: 7
    op: create
    diff: created [cp 7]
---
The workflow still expects NPM_TOKEN and uses the npm CLI bundled with Node 22
