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
---
## Goal
- [cp 1] Make the 40 MB upload stop timing out

## Done
- [cp 1] Reproduced the timeout with a 40 MB fixture. files: fixtures/big.bin · verified: not-verified

## Remaining
- [cp 1] → WL-01J9AC00000000000000000000 (new) Ask ops whether the 50 MB limit is configurable; why: the answer decides whether we cap or chunk; blocked_by: none

## Notes
- discovery [cp 1]: The upload service strips Content-Length on redirect; retries must re-stream.
