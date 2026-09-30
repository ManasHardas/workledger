---
schema_version: 1
id: WL-01M2DVCNXDDZ7VGC77PZGJKB4P
title: Add NPM_TOKEN and TAP_TOKEN as repo secrets
status: proposed
proposed_by:
  harness: claude-code
  session: 01M2C2WMACH589KZV1BE8VVQ85
  checkpoint: 6
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
created: 2026-09-13T17:00:13.611Z
updated: 2026-09-13T17:21:24.335Z
history:
  - at: 2026-09-13T17:00:13.611Z
    by:
      session: 01M2C2WMACH589KZV1BE8VVQ85
      checkpoint: 6
    op: create
    diff: created [cp 6]
  - at: 2026-09-13T17:21:24.335Z
    by:
      session: 01M2C2WMACH589KZV1BE8VVQ85
      checkpoint: 7
    op: update
    diff: "why: npm needs no secret now, but the Homebrew formula update still needs a tap token"
---
Without them a tag skips npm publish and the Homebrew formula update

- [cp 7] npm needs no secret now, but the Homebrew formula update still needs a tap token
