---
schema_version: 1
id: 01M3R6W20CYRWJM65H7Q6YQ1D0
harness: opencode
harness_session_id: ses_f0f91f854ffeEATXqlXieh9EPI
repo: github.com-personal/ManasHardas/workledger
branch: main
author:
  name: Manas Hardas
  email: manas.hardas@gmail.com
started: 2026-09-30T03:48:57.985Z
status: crashed
private: false
source: live
model: null
needs_repair: true
checkpoint_failures: 0
checkpoints:
  - n: 1
    at: 2026-09-30T21:57:05.954Z
    turns: 2
    transcript_offset: 0
    trigger: minutes
started_in: /Users/manashardas/Projects/workledger
end_reason: crashed
ended: 2026-09-30T04:20:37.961Z
about:
  - /Users/manashardas/Projects/workledger
---
## Goal
- [cp 1] Orient on workledger and diagnose the OpenCode session that the app shows as crashed.

## Done
- [cp 1] Confirmed the OpenCode session shown as crashed is alive and is this conversation
  detail: opencode.db holds 24 messages for session ses_f0f91f854ffeEATXqlXieh9EPI, first 03:48:58Z and latest 21:48Z, under the same run 5ea3aac8 since boot; the screen being viewed is this live session. · files: .workledger/sessions/01M3R6W20CYRWJM65H7Q6YQ1D0.md · verified: not-verified
- [cp 1] Traced the false crash to the orphan sweep, not to OpenCode
  detail: The ended 04:20:37Z stamp came from scan classifyOrphan: OpenCode has no transcript file, so age is measured from the index row updated_at; with orphan_minutes 30 the row looked dead 31 minutes after SessionStart. · files: packages/cli/src/commands/scan.ts · verified: not-verified
- [cp 1] Found the real defect: the OpenCode Stop hook never reaches the CLI
  detail: The index row shows turns_total 1 and last_checkpoint_at equal to SessionStart, so only SessionStart landed; the session.idle to Stop translation never produced a hook call, so no checkpoint was ever requested. · files: .opencode/plugins/workledger.ts, packages/cli/src/opencode-hooks.ts, packages/cli/src/adapters/opencode.ts · verified: not-verified
- [cp 1] Noted this repo does not list opencode as an enabled harness
  detail: config.yaml still reads harnesses claude-code only although init installed .opencode/plugins/workledger.ts; other repos such as dome_workspace/ai and backend do list opencode. · files: .workledger/config.yaml · verified: not-verified
- [cp 1] Found a repair job for this live session still sitting queued
  detail: scan queued job 01M3R8P1EYMW9ES9XDXFSJZVCM at 04:20:37Z and it was never attempted; if it fired it would run opencode run --session against this live conversation. · files: packages/cli/src/commands/scan.ts · verified: not-verified

## Remaining
- [cp 1] → WL-01M3T54FS30EJ1SXXG5ERG932X (new) Fix the OpenCode plugin so session.idle delivers Stop; why: No Stop means no checkpoint prompts and live sessions are falsely swept as crashed
- [cp 1] → WL-01M3T54FS30EJ1SXXG5ERG932Y (new) Add opencode to the repo harness list or re-run init; why: config.yaml still lists only claude-code
- [cp 1] → WL-01M3T54FS30EJ1SXXG5ERG932Z (new) Decide what to do with the queued repair job for this session; why: It would resume this still-live session headlessly if it fired

## Notes
- blocker [cp 1] by agent: workledger falsely marks a live OpenCode session as crashed: with no transcript file, freshness depends only on the Stop hook or a checkpoint, so a session the plugin never sends Stop for is swept after orphan_minutes.; reason: The app shows this running session as crashed and offers Repair.
- discovery [cp 1] by agent: The OpenCode plugin is loaded and SessionStart fires, but no Stop arrived across a 17 hour session and turns_total stayed at 1.
- discovery [cp 1]: opencode debug config resolves .opencode/plugins/workledger.ts as a local plugin, so the plugin load path itself is fine.

## Memory
