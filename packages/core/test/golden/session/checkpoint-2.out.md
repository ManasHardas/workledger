---
schema_version: 1
id: 01J9AA00000000000000000000
harness: claude-code
harness_session_id: hsess-0a1b2c3d4e5f6071
repo: github.com/org/repo
branch: main
author:
  name: Ada Lovelace
  email: ada@example.com
  dome_user: null
started: 2026-09-09T14:02:11Z
ended: null
end_reason: null
status: open
private: false
source: live
model: claude-opus-5
needs_repair: false
checkpoint_failures: 0
checkpoints:
  - n: 1
    at: 2026-09-09T14:31:02Z
    turns: 7
    transcript_offset: 48213
    trigger: bytes
  - n: 2
    at: 2026-09-09T15:04:40Z
    turns: 16
    transcript_offset: 131904
    trigger: minutes
---
## Goal
- [cp 1] Make the 40 MB upload stop timing out

## Done
- [cp 2] Added retry to the upload client.
  commit: a1b2c3d · files: src/upload.ts, src/upload.test.ts · verified: tests-passed
- [cp 1] Reproduced the timeout with a 40 MB fixture.
  files: fixtures/big.bin · verified: not-verified

## Remaining
- [cp 2] → WL-01J9AB00000000000000000000 (new) Add a size limit before upload; why: server rejects >50 MB with no message
- [cp 2] → WL-01J8ZZ00000000000000000000 (closes) Retry on 502 was the open item from Monday; why: it is the last blocker on the Monday thread
- [cp 1] → WL-01J9AC00000000000000000000 (new) Ask ops whether the 50 MB limit is configurable; why: the answer decides whether we cap or chunk; blocked_by: none

## Notes
- discovery [cp 1]: The upload service strips Content-Length on redirect; retries must re-stream.
- decision [cp 2] by human: Keep uploads synchronous for now; reason: async path needs the queue work first.
- blocker [cp 2]: Staging has no 50 MB fixture; cannot verify the limit path.
- question [cp 2]: Should partial uploads be resumable, or is restart acceptable?

## Memory
