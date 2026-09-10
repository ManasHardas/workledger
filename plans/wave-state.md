# Wave State

> **Purpose:** authoritative current state of the project. Updated by PM at session-close; read by Orchestrator at session-start. Eliminates session-amnesia about phase / wave / required activities.

> **Convention:** if you're starting a session, read THIS FILE FIRST (after fetch+reset), then `.orchestrator/agents/orchestrator.md` §Session-start ritual.

---

## Current state — 2026-09-10 (post-S3 addendum 3)

**Phase:** P8 (Onboarding and home) **built and proven**: all twenty-three build PRs merged on main (#82 #83 #84 #86 #90 #91 #92 #93 #95 #96, then #98 #102 #103 #104 after the operator's walkthrough found every backfill failing, then #106 #107 #112 #111 for workspace-root sessions, then #115 #120 #122 #123 #126 for context repos and the human-gist ledger); contract `docs/contracts/p8/daemon-and-api.md` carries amendments 1–12. All five real backfill jobs on the operator's machine succeeded after the fixes, and the six UX points the operator asked for after them shipped: projects before non-repo folders on Home, no Open/All tabs on the Ledger, a human gist per done item with the detail on demand, remaining items shorter and split, discovery notes marked agent-facing, and a Memory section. **Not yet tagged:** `p8-shipped` and `v0.4.0` wait for the operator's verdict; version is still 0.3.0 and CHANGELOG has an Unreleased section. Four facts every session needs: headless resumes hand the checkpoint over as `workledger checkpoint --payload '<json>'` (Claude Code's headless permission matcher denies stdin heredocs and pipes; DL-18) and at most 2 jobs run machine-wide, a resume refused by the operator's Claude usage limit being requeued and retried automatically after the named reset; a session's start directory is only where its transcript is stored, so every session carries `startDir` and the `contextRepos` inferred from its content and its extract is filed against those (DL-19, DL-20), a backfill resuming in the start directory and `checkpoint --repo` targeting a ledger from any cwd; a `done` item is a human gist (≤140 chars) whose `detail`, files and commit are agent evidence shown on demand, discovery notes are agent-facing, and `memory[]` facts have their own section (DL-21); agents never touch the real `~/.workledger` (every run uses a temp `WORKLEDGER_HOME`; a worktree migration once broke main's `serve`, #108), and no test may pin this repo's live dogfood ledger contents (two did; #120 and #122 repaired them to derive their values). Tags: `p1-shipped` … `p5-shipped`. P7 Wave 0 merged (#74); P7 Wave 1 blocked on Figma inputs. P6 deferred by the operator.

**Wave:** P8 Wave 3 (ship gate) pending the operator's verdict; P7 Wave 1 blocked on inputs. Lean mode (Clause #12) throughout; Clause #13 not in force here by operator decision.

**Last session:** S3 closed after PR #96 and reopened three times: after the operator's walkthrough, for workspace-root sessions, and for context repos and the human-gist ledger. 23 build PRs merged (P8 infra, two backend first-of-class, Home, wizard, three fixes, QA e2e, integration fix; four backfill fixes; four for attribution by touched paths, workspace hooks and the wizard's folder section, tracked repos selectable, the attribution rule fix; then resume-in-start-directory, `startDir`/`contextRepos` with one shared inference, the human-gist payload with `memory[]`, Home's projects-then-folders grouping, and the session view's gists with a detail drawer); ~5.35M implementer + ~2.63M reviewer tokens; 5 fix-cycles across 23 PRs. Issue #121 was filed and closed as superseded by #120 (its PR #124 closed unmerged). A model switch happened mid-session (Fable usage limit); builds resumed on Opus 5 from their existing worktrees with no rework.

**Carry-over slots:** none.

**Open blockers:** the operator's verdict gates the tag (the walkthrough ran; the backfill defects it found are fixed, five real backfills succeeded, sessions now file against the context repos inferred from their content, and the six UX points shipped); npm publish and tap automation need the `NPM_TOKEN` and `TAP_TOKEN` repository secrets from the operator (the release workflow prints the manual command when either is absent); P7 Wave 1 needs the Figma file key, node ids, and variables export.

**Next required activities (in order):**
1. ⏳ Operator's verdict on P8 after the fixed backfill; any further defect becomes a five-line issue in P8.
2. ⏳ After the verdict: bump `packages/cli` to 0.4.0, CHANGELOG 0.4.0, tag `v0.4.0` (release workflow) and `p8-shipped`, close #75 (orchestrator direct task).
3. ⏳ The three filed P8 builds, one lean PR each, in this order: #125 (Backend: one repair job per context repo), #113 (Backend: backfill must not replay a session that is still live in another terminal) and #108 (Backend: index migrations record applied names, detect a divergent schema, offer a cache rebuild instead of a raw SQLite error); any further walkthrough defect likewise.
4. ⏳ P7 Wave 1 when the Figma inputs exist. P6 deferred by the operator.

**Operating mode:** ACTIVE, Clause #12 lean (one reviewer per PR, one fix-cycle, merge on green).

**Throughput mode:** parallel on disjoint packages.

---

## Recent session history (rolling window of last 5 sessions)

| Session | Phase / Wave | Mode | PRs | Notes |
|---|---|---|---|---|
| S0 | P1 / design | n/a | 0 | Spec, decision log, roadmap, phase spec, implementation plan, agentwaves vendored |
| S1 | P1 / Wave 0 → 0.5 → 1 | ACTIVE, serial | 10 (#1 freeze, #15 amendment, 8 builds) | 8/12 slots merged; T-D on slot 5; anchors recalibrated |
| S2 | P1 close → P2 → P3 → P4 → P5 → P7 Wave 0 | ACTIVE, lean | 25 | Five phases shipped; ~6.4M implementer + 1.8M reviewer tokens; 8 fix-cycles across 25 PRs |
| S3 | P8 Wave 0 → 0.5 → 1 → 2, walkthrough fixes, workspace-root sessions, context repos and the human-gist ledger | ACTIVE, lean | 23 | P8 built and proven, the six UX points shipped, tag pending the operator's verdict; ~5.35M implementer + 2.63M reviewer tokens; 5 fix-cycles across 23 PRs; model switched to Opus 5 mid-session |

---

## Maintenance protocol

**At session-close (PM responsibility):**
1. Update `## Current state` block to reflect post-session reality.
2. Move the just-closed session into `## Recent session history` (drop oldest if window > 5).
3. Update `**Carry-over slots**` if any slots were T-A/T-D/T-G dropped.
4. Update `**Next required activities**` for the next session.
5. Commit alongside `velocity.json` + `capacity-log.md` updates in the session-close chore commit.

**At session-start (orchestrator responsibility):**
1. Read this file FIRST (after fetch+reset).
2. Cross-reference with `.orchestrator/agents/orchestrator.md` §Session-start ritual.
3. Decide operating mode (ACTIVE vs DEGRADED) per the encoded rules.
4. If carry-over slots exist, dispatch them as first slots of the new session.
