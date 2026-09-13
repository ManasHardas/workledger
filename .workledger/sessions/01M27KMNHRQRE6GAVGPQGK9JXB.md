---
schema_version: 1
id: 01M27KMNHRQRE6GAVGPQGK9JXB
harness: claude-code
harness_session_id: c1cf6de4-7edc-4cc1-ae47-efc350dc217a
repo: github.com-personal/ManasHardas/workledger
branch: main
author:
  name: Manas Hardas
  email: manas.hardas@gmail.com
started: 2026-09-11T06:49:20.162Z
status: ended
private: false
source: live
model: claude-opus-5[1m]
needs_repair: false
checkpoint_failures: 0
checkpoints:
  - n: 1
    at: 2026-09-11T07:11:57.875Z
    turns: 1
    transcript_offset: 4142636
    trigger: bytes
  - n: 2
    at: 2026-09-11T07:16:38.781Z
    turns: 3
    transcript_offset: 4280661
    trigger: manual
  - n: 3
    at: 2026-09-11T23:20:41.418Z
    turns: 6
    transcript_offset: 4873980
    trigger: minutes
  - n: 4
    at: 2026-09-12T00:00:03.192Z
    turns: 8
    transcript_offset: 9905294
    trigger: bytes
  - n: 5
    at: 2026-09-12T00:32:58.631Z
    turns: 10
    transcript_offset: 10454897
    trigger: minutes
  - n: 6
    at: 2026-09-12T01:18:57.801Z
    turns: 14
    transcript_offset: 12035489
    trigger: minutes
  - n: 7
    at: 2026-09-12T01:47:03.311Z
    turns: 16
    transcript_offset: 12838760
    trigger: minutes
  - n: 8
    at: 2026-09-12T07:08:54.050Z
    turns: 18
    transcript_offset: 13811517
    trigger: minutes
  - n: 9
    at: 2026-09-12T16:16:34.837Z
    turns: 20
    transcript_offset: 14484739
    trigger: minutes
  - n: 10
    at: 2026-09-12T17:51:13.249Z
    turns: 22
    transcript_offset: 14814165
    trigger: minutes
  - n: 11
    at: 2026-09-12T18:16:39.440Z
    turns: 25
    transcript_offset: 15455361
    trigger: minutes
  - n: 12
    at: 2026-09-12T22:25:34.838Z
    turns: 27
    transcript_offset: 15939158
    trigger: minutes
  - n: 13
    at: 2026-09-13T00:29:58.462Z
    turns: 29
    transcript_offset: 16887322
    trigger: minutes
started_in: /Users/manashardas/Projects/workledger
about:
  - /Users/manashardas/Projects
  - /Users/manashardas/Projects/workledger
end_reason: clean
ended: 2026-09-13T00:32:29.871Z
---
## Goal
- [cp 1] Make the web UI look like X: a centred three-column layout with X’s font, palette and style, replacing the Linear-shaped shell the operator called hideous.

## Done
- [cp 13] The redesign is finally running in the app, not sitting on a branch
  detail: Merged to main, installed the font dependency the merge introduced, rebuilt and restarted the daemon. Proven by the artefact rather than the command: the served bundle changed hash, and the served CSS carries the new palette and Inter while the JS carries the new nav labels. · commit: 975ea77 · files: apps/web/src/components/app-shell.tsx · verified: tests-passed
- [cp 13] The Figma mocks show the nav you asked for, on all four screens
  detail: Home, Ledger, Sessions, Review, then Jobs and Health under a separator, with the right item active per screen. Rebuilt from the file’s variables rather than retyped, so the mocks re-theme with everything else. · files: docs/design/figma.md · verified: not-verified
- [cp 12] The Figma mocks now show the nav you asked for, on all four screens
  detail: Home, Ledger, Sessions, Review, then Jobs and Health under a separator, with the right item marked active on each screen. The nav was rebuilt from the variables rather than retyped, so it re-themes with everything else. · files: docs/design/figma.md · verified: not-verified
- [cp 12] A session row leads with the goal now, and the Ledger groups sessions by day
  detail: The row put the author first, which is not what anyone scans for; the goal leads and the author drops to the foot with the counts. Day grouping is presentational only, so j and k still walk the flat order across headings. · files: apps/web/src/features/ledger/session-card.tsx, apps/web/src/features/ledger/session-list.tsx · verified: tests-failed
- [cp 12] Home marks a tracked folder that is really the parent of other projects
  detail: Derived from the repo list alone: a repo whose path is a prefix of another tracked repo’s. That is what makes the Projects folder carry more open items than every real project combined. · files: apps/web/src/features/home/repo-card.tsx, apps/web/src/features/home/home-view.tsx · verified: tests-failed
- [cp 11] The four-view rebuild is green: every test now describes the nav you asked for
  detail: 42 failures to none. About thirty were detail tests mounting the Ledger, which no longer owns the detail; the rest named views that no longer exist. Several tests keep asserting the old hashes on purpose, so the aliases that keep saved links alive stay covered. · commit: b7dc346 · files: apps/web/test/shell.test.tsx, apps/web/test/ledger.test.tsx, apps/web/test/narrow.test.tsx · verified: tests-passed
- [cp 11] The app wears the Linear palette and Inter now, instead of X’s black and blue
  detail: from-figma rewrote every colour and scale token from the design-system file, so the app follows Figma rather than a hand copy. Inter is bundled, not fetched. The CLI bundle grew to 342 KiB gzipped against its 1024 KiB cap. · commit: 4b57dff · files: packages/tokens/tokens.json, apps/web/src/index.css · verified: tests-passed
- [cp 11] A session now leads with a recap of a few points instead of a flat list of every outcome
  detail: Outcomes sharing a commit are one point even across checkpoints; those without one group by checkpoint. A point rolls up its verification, and a single failure decides it. Nothing is stored and no model is called, so the recap cannot drift from the file. · commit: cc1f23b · files: apps/web/src/features/ledger/recap.ts, apps/web/src/features/ledger/session-detail.tsx, apps/web/test/recap.test.ts · verified: tests-passed
- [cp 10] Jobs and Health are back in the nav, set apart below a hairline from the four views you read
  detail: A nav item can now be secondary; the divider is drawn once, before the first of them, and the same tree serves the desktop column and the mobile sheet. Machine-wide routes put Jobs below the line too, so the shape reads the same wherever you are. · files: apps/web/src/components/app-shell.tsx · verified: not-verified
- [cp 10] Needs you is called Review everywhere a person can see it
  detail: The machine-wide view heading and its labelling id, Home’s group title and its list label. The note rows and count links had already been repointed. Module paths still say needs; renaming those is churn with no user-visible effect, so it waits. · files: apps/web/src/routes/all-needs.tsx, apps/web/src/features/home/home-view.tsx · verified: not-verified
- [cp 9] The nav is four destinations in the order you asked for: Home, Ledger, Session, Review
  detail: Home leads on every route. Jobs and Health came off the nav but kept their routes and their links from Home — they are machinery rather than places to read. Review carries a count of both halves it now holds: open notes plus proposed backlog. · files: apps/web/src/components/app-shell.tsx, apps/web/src/lib/router.ts · verified: tests-failed
- [cp 9] A session is its own destination now, and the Ledger went back to being just the list
  detail: Session answers with the repo’s most recent session when the route names none, using the same open-first order the list shows, and with an empty query so it cannot inherit the Ledger’s filters. The Ledger no longer renders detail. · files: apps/web/src/routes/session.tsx, apps/web/src/routes/ledger.tsx, apps/web/src/features/ledger/detail-route.ts · verified: tests-failed
- [cp 9] Review holds everything waiting on a person: answers owed first, then the backlog agents proposed
  detail: It merges the two views P2 split. Answers come first because a blocker is work already stopped. No new machinery: an answer is still a decision note on its session, and accepting still sets confirmed_by. · files: apps/web/src/routes/review.tsx, apps/web/src/app.tsx · verified: tests-failed
- [cp 9] Every old link still resolves, so no saved bookmark or open tab breaks
  detail: next, needs and needs-you alias to review; ledger/<ulid> parses as the session route it became; the machine-wide needs tab answers at review. Old spellings are a table in one place rather than scattered conditionals. · files: apps/web/src/lib/router.ts · verified: tests-failed
- [cp 8] All four product screens now exist, every one built on real data rather than placeholder content
  detail: Needs you and Home join Session and Ledger in the designs file. Needs you carries only the two judgements the current model supports: answering an open blocker or question, and accepting or discarding an agent-proposed item. Home lists all fifteen tracked projects. · files: docs/design/figma.md · verified: not-verified
- [cp 8] Home tells the operator two things about his own work that the terminal does not show
  detail: The Projects folder holds 105 open items and 34 questions — more than every real project combined — because sessions run from a worktree or sibling directory are filed there; and splitfire is tracked and hooked but has never run. Both are flagged, not averaged into a total. · files: docs/design/figma.md · verified: not-verified
- [cp 8] The Figma doc no longer contradicts itself about what exists
  detail: It described one file when there are two, and still listed screen mockups as out of scope after four screens had been built. Both corrected, along with the heading that assumed a single file. · files: docs/design/figma.md · verified: not-verified
- [cp 7] The Ledger screen is designed, and it shows the ledger’s real duplication instead of tidying it away
  detail: Sessions grouped by day, each row the goal in the human’s words with status, span, checkpoint count and outcomes versus open; the right panel carries the selected session’s recap and links through. Built on the five real sessions in this repo. · files: docs/design/figma.md · verified: not-verified
- [cp 7] The written direction no longer contradicts the drawn design: cards are the approved treatment in the reading column
  detail: The old rule said the reading column stays flat with hairline separation and no cards. The operator approved the carded rows, so the doc now records cards for a session row and a recap point, with flat hairline sections inside a record. · files: docs/design/direction.md · verified: not-verified
- [cp 7] Where the Figma work lives is written down, including why the designs file duplicates the tokens
  detail: Two files in the operator’s project: the design system and the product designs. Variables do not cross files until the system file is published as a team library, so the designs file carries its own identical copy; only the system file feeds the token sync. · files: docs/design/figma.md · verified: not-verified
- [cp 6] The data model is settled as it stands: two record types, and the session design needs no new entity
  detail: Read the zod source and a real ledger file, and showed the operator the whole model: both record types, the five body sections, the item shapes, the enums and the cache tables. He confirmed it correct, which cancels the review and decision entities designed earlier. · files: packages/core/src/schema.ts · verified: not-verified
- [cp 6] Caught two invented numbers in the mockup and a real contradiction in this session’s own record
  detail: The screen had a fabricated transcript offset and a fabricated duration; both corrected against the file — cp 5 ends at 10,454,897 B and the session ran 1 h 34 m. The file also shows three checkpoints stamped after its recorded ended time. · files: .workledger/sessions/01M27KMNHRQRE6GAVGPQGK9JXB.md · verified: not-verified
- [cp 5] Found the two gaps the review design has to fill: there is no decision entity, and an outcome has no id
  detail: Decisions exist only as notes inside session files — type, text, by, reason — with no id, status, approver or supersede. A Done item carries text, detail, files, commit and verified, and nothing anywhere assigns it an identifier. Reading only; no code changed this span. · files: packages/core/src/schema.ts, docs/superpowers/specs/2026-09-09-workledger-design.md · verified: not-verified
- [cp 5] Mapped how a human judgement would reach an agent, and what it costs in the session brief
  detail: Writes reach the ledger as a POST to the server that calls a CLI op, never a direct file write. The brief is deterministic and capped at 2000 tokens with a fixed drop order, so any new section competes with the backlog and recent work for that budget. · files: packages/core/src/brief.ts, packages/server/src/routes/write.ts, packages/cli/src/backlog-ops.ts · verified: not-verified
- [cp 4] workledger has a design system in Figma: foundations plus seven component sets, built with Linear as the reference
  detail: Two collections (30 colours in Light and Dark, 33 scale values), 9 text styles, one effect style, Cover and Foundations pages, and Button, Badge, Input, List row, Card, Panel and Nav item — 65 variants, zero unbound fills, zero default layer names. · files: docs/design/figma.md · verified: not-verified
- [cp 4] Design edits in Figma can reach the app with one command, proven end to end against the real file
  detail: Every variable is named exactly as its token path, so the sync resolved all 63 with no unknown names. The dry run would change 21 light, 30 dark and 15 scale values; nothing was written because the operator reviews the file first. · files: packages/tokens/scripts/from-figma.mjs, docs/design/figma.md · verified: not-verified
- [cp 4] The look is decided: Linear’s density and quiet chrome, with our own green accent and status colours
  detail: Palette, type ramp (13 px workhorse, hierarchy by weight and a four-step text ramp) and the 6/8/12 px shapes come from Linear’s own served CSS; the accent is the app icon’s green, #3fa87a dark and #1f7a52 light. Contrast checked: worst pair 4.58:1. · files: docs/design/figma.md · verified: not-verified
- [cp 3] The folders box is gone from the shell and the project switcher now sits at the top of the left nav
  detail: FoldersSection removed from app-shell at every width, so folders are listed on Home only; ProjectSwitcher moved under the mark, above the views; two shell tests rewritten to match. · commit: eb45e80 · files: apps/web/src/components/app-shell.tsx, apps/web/test/shell.test.tsx, apps/web/src/features/home/home-view.tsx, apps/web/src/features/home/workspace-card.tsx · verified: tests-passed
- [cp 3] The design direction is marked provisional: X was meant as inspiration, not a template
  detail: The operator judged the X restyle a wholesale copy. direction.md carries the caveat; a memory file tells future sessions to borrow named qualities from a reference and keep workledger’s own identity. · commit: eb45e80 · files: docs/design/direction.md · verified: not-verified
- [cp 3] Confirmed how Figma work will reach the app: variables must be named exactly like the token paths
  detail: from-figma.mjs refuses any variable with no token counterpart, so the Figma collection uses color/…, spacing/…, radius/…, type/size/… with Light and Dark modes, and one sync rewrites tokens.json. Linear research is under way in the background. · files: packages/tokens/scripts/from-figma.mjs · verified: not-verified
- [cp 2] The X-style look is live: the restyle is merged and the local app now serves it
  detail: PR 143 squash-merged as e2d4c27 after one review with no blockers; main rebuilt with pnpm build; daemon on 7419 stopped and reopened, serving the new index-6ZM7QhJH.css; review worktree and branch removed. · commit: e2d4c27 · verified: tests-passed
- [cp 1] The app now looks like X: a centred nav, a timeline column and a right column, true black with X blue
  detail: Tokens rewritten: #000 and #2f3336 hairlines, #1d9bf0 accent, X status hues, glow shadow, pills and 16px modules; shell is a centred 275/600/350 group; direction.md rewritten; DL-22. · commit: 8f867ef · files: packages/tokens/tokens.json, apps/web/src/components/app-shell.tsx, apps/web/src/components/ui/button.tsx, docs/design/direction.md, docs/decision-log.md · verified: tests-passed
- [cp 1] Opening a Done item now shows its details as a box in the right column, like X’s news module
  detail: PanelSlot portal target in panel.tsx; the panel docks when the 1280px-and-up right column exists, floats at the right edge from 768 to 1279 with the group shifted left, and stays a bottom sheet below 768. · commit: 8f867ef · files: apps/web/src/components/ui/panel.tsx, apps/web/src/lib/media.ts · verified: tests-passed
- [cp 1] Sessions read like a timeline, and a session’s sections are flat instead of boxed
  commit: 8f867ef · files: apps/web/src/features/ledger/session-card.tsx, apps/web/src/features/ledger/session-list.tsx, apps/web/src/features/ledger/session-detail.tsx, apps/web/src/features/ledger/provenance-panel.tsx · verified: tests-passed
- [cp 1] The font matches X as closely as the machine allows
  detail: X’s fallback stack, SF Pro on a Mac; Chirp is not bundled because it is licensed and design spec 14 forbids fetching a font; scale 13/15/17/20, weights 400/700/800. · commit: 8f867ef · files: packages/tokens/tokens.json · verified: not-verified
- [cp 1] Folder and project names on Home no longer get squeezed to two letters by their path
  commit: 8f867ef · files: apps/web/src/features/home/workspace-card.tsx, apps/web/src/features/home/repo-card.tsx · verified: tests-passed
- [cp 1] The restyle is up for review as PR 143
  detail: Branch p8-x-shell in worktree ../workledger-wt-x-shell; web tsc, eslint, 219 tests and vite build green; eyeballed at 3440, 1100 and 390 px on fixtures. · commit: 8f867ef · verified: tests-passed

## Remaining
- [cp 13] → WL-01M2C2QFA0GSJ4RKE13R97FT62 (new) Put Ledger and Sessions in the nav on Home; why: Home is a machine route with no project scope, so both are missing entirely
- [cp 13] → WL-01M2C2QFA1TETMXG56W5Q3540H (new) Make the shell flush left instead of a centred group; why: Home floats mid-screen with dead space either side, unlike the mock
- [cp 13] → WL-01M2C2QFA1TETMXG56W5Q3540J (new) Shrink the nav to 28 px rows and 13 px labels; why: It is still the 52 px X pill, not the density the design calls for
- [cp 13] → WL-01M2C2QFA1TETMXG56W5Q3540K (new) Rebuild Home to the mock; why: It still shows the old overview, not the summary, flag and active-quiet split
- [cp 12] → WL-01M2BVKPKS8J3CV1RF3DP04RS5 (new) Merge the four-view branch and restart the daemon; why: Four commits sit on a branch, so the operator has seen none of this
- [cp 12] → WL-01M2BVKPKS8J3CV1RF3DP04RS6 (new) Repoint three tests at the day-grouped list and the new counts; why: They assert one session list and the old done-and-remaining wording
- [cp 11] → WL-01M2B6G1GQRHM49TQMFH021B9F (closes) Update the web tests to the four-view contract; why: Done: 225 tests pass, lint and type-check clean
- [cp 11] → WL-01M2B6G1GQRHM49TQMFH021B9H (updates) Apply the Figma screen designs to the four views; why: Session is done; the Ledger list and Home still wear the old layout
- [cp 11] → WL-01M2BDBX8JG8Z4XY3528NEH8W8 (new) Rewrite the session row to lead with the goal; why: The row still leads with the author, which is not what you scan for
- [cp 11] → WL-01M2BDBX8KAQVAB3X3MHZS4M1Q (new) Group the Ledger list by day; why: The list is undifferentiated, so a burst of sessions reads as one run
- [cp 11] → WL-01M2BDBX8KAQVAB3X3MHZS4M1R (new) Flag a tracked folder that is not a project on Home; why: Projects holds 105 open items that belong to the repos beneath it
- [cp 11] → WL-01M2BDBX8KAQVAB3X3MHZS4M1S (new) Open the pull request for the four-view branch; why: Four commits sit on a branch nobody has reviewed
- [cp 10] → WL-01M2B6G1GQRHM49TQMFH021B9G (closes) Confirm whether Jobs and Health stay off the nav; why: Answered: restore them under a separator, which is done
- [cp 10] → WL-01M2B6G1GQRHM49TQMFH021B9F (updates) Update the web tests to the four-view contract; why: 42 failures stand; the six files and their exact assertions are mapped
- [cp 10] → WL-01M2BBXAV3A34WS2A34PQVPYVK (new) Rename the needs module paths to review; why: The UI says Review while the directories still say needs
- [cp 9] → WL-01M2B6G1GQRHM49TQMFH021B9F (new) Update the web tests to the four-view contract; why: 42 tests fail: stale view ids, and detail tests mounting the Ledger
- [cp 9] → WL-01M2B6G1GQRHM49TQMFH021B9G (new) Confirm whether Jobs and Health stay off the nav; why: A jobs test asserts nav-current, which cannot hold while they are off it
- [cp 9] → WL-01M2B6G1GQRHM49TQMFH021B9H (new) Apply the Figma screen designs to the four views; why: The routes are restructured but still wear the old layout
- [cp 8] → WL-01M29MQWRH3XPQ8EJ2DG4B9414 (closes) Design the Review page over the current data model; why: Done: the Needs you screen carries answers owed and proposals to triage
- [cp 8] → WL-01M29MQWRJH6KJ91443QBQMXAC (closes) Design the Home page across tracked repos; why: Done: fifteen projects, active first, on the daemon’s real counts
- [cp 8] → WL-01M29GG88AMXE28YF0WMZXHP9K (closes) Draw the product screens in a separate Figma file; why: Done: Session, Ledger, Needs you and Home are all built
- [cp 8] → WL-01M2A756X44BTTYQKEE43E9NPC (new) Flag near-identical sessions in the Ledger; why: Three sessions four minutes apart on 9 Sep are visible only because the list groups by day
- [cp 8] → WL-01M2A756X5JDNFFHF5P1NYM35H (new) Build the four designed screens in the app; why: The designs exist only in Figma; the running app still shows the old views
- [cp 7] → WL-01M29K4ERBFAP3AZNWRW41AWBP (closes) Flatten the recap points to hairline-separated rows; why: Dropped: the operator approved the cards and the direction doc now matches
- [cp 7] → WL-01M29K4ERCY8Y0D2JGCCHRBYKP (closes) Design the Ledger list screen; why: Done: sessions grouped by day with the recap panel beside them
- [cp 7] → WL-01M29GG88AMXE28YF0WMZXHP9K (updates) Draw the product screens in a separate Figma file; why: Session and Ledger are built; Review and Home are still empty pages
- [cp 7] → WL-01M29MQWRH3XPQ8EJ2DG4B9414 (new) Design the Review page over the current data model; why: The page is empty and the review entity work was dropped
- [cp 7] → WL-01M29MQWRJH6KJ91443QBQMXAC (new) Design the Home page across tracked repos; why: The system-of-record half of the brief has no screen yet
- [cp 7] → WL-01M29MQWRJH6KJ91443QBQMXAD (new) Publish the design system file as a Figma team library; why: Until then the designs file keeps a duplicate copy of every token
- [cp 6] → WL-01M29K4ERBFAP3AZNWRW41AWBP (new) Flatten the recap points to hairline-separated rows; why: Boxing them in cards contradicts the agreed reading-column direction
- [cp 6] → WL-01M29K4ERCY8Y0D2JGCCHRBYKP (new) Design the Ledger list screen; why: Seeing what agents are doing needs the list, not only one session
- [cp 6] → WL-01M29K4ERCY8Y0D2JGCCHRBYKQ (new) Decide whether a crashed session may keep accruing checkpoints; why: Three checkpoints are stamped after this session’s recorded ended time
- [cp 6] → WL-01M29GG889N5BKT6ZJZFKBY3PF (closes) Choose between the three review-record approaches; why: Dropped: the operator confirmed the data model as it stands
- [cp 6] → WL-01M29GG88AMXE28YF0WMZXHP9G (closes) Write the review and decisions design spec; why: Dropped: no review entity is being added in this phase
- [cp 6] → WL-01M29GG88AMXE28YF0WMZXHP9H (closes) Give every outcome a stable id at checkpoint time; why: Dropped: nothing now points at an individual outcome
- [cp 6] → WL-01M29GG88AMXE28YF0WMZXHP9J (closes) Promote decisions into their own entity with a status lifecycle; why: Dropped: decisions stay notes under the confirmed model
- [cp 6] → WL-01M29GG88AMXE28YF0WMZXHP9K (updates) Draw the product screens in a separate Figma file; why: The Session screen exists; Ledger, Review and Home are still empty
- [cp 5] → WL-01M29GG889N5BKT6ZJZFKBY3PF (new) Choose between the three review-record approaches; why: The design cannot be written until record placement is settled
- [cp 5] → WL-01M29GG88AMXE28YF0WMZXHP9G (new) Write the review and decisions design spec; why: The product design has no written artefact yet
- [cp 5] → WL-01M29GG88AMXE28YF0WMZXHP9H (new) Give every outcome a stable id at checkpoint time; why: Per-outcome verdicts have nothing durable to point at
- [cp 5] → WL-01M29GG88AMXE28YF0WMZXHP9J (new) Promote decisions into their own entity with a status lifecycle; why: A decision cannot be approved or superseded while it is a note
- [cp 5] → WL-01M29GG88AMXE28YF0WMZXHP9K (new) Draw the product screens in a separate Figma file; why: The operator asked for screens outside the design-system file
- [cp 4] → WL-01M29CBWPCBVAT1DYQYTPDGS3D (closes) Authorize the Figma MCP connector; why: Done: authorized, and the file was created in the operator’s folder
- [cp 4] → WL-01M29CBWPDC8MGC2977DA7E40T (closes) Agree what to borrow from Linear and what stays workledger’s own; why: Done: the borrow and keep boundary is agreed and written down
- [cp 4] → WL-01M29CBWPDC8MGC2977DA7E40V (closes) Build the design system in the Figma folder as variables and components; why: Done: foundations and seven component sets exist
- [cp 4] → WL-01M29EKZ3TCQZKHP28GHVX9QG7 (new) Review the Figma file and change anything you disagree with; why: The palette and type ramp are the agent’s proposal, not yet the operator’s
- [cp 4] → WL-01M29CBWPDC8MGC2977DA7E40W (updates) Restyle the app from the Linear-derived tokens; why: The app still wears the X palette, type and shapes
- [cp 4] → WL-01M29EKZ3V6R1K9XC93BRQ2R0Q (new) Bundle Inter and point the sans stack at it; why: The type ramp assumes Inter and no web font may be fetched at runtime
- [cp 4] → WL-01M29EKZ3V6R1K9XC93BRQ2R0R (new) Draw the icon set and swap it into Nav item; why: Nav item carries a placeholder slot instead of an icon
- [cp 4] → WL-01M29EKZ3V6R1K9XC93BRQ2R0S (new) Add Code Connect mappings for the seven components; why: Dev Mode cannot show a component’s code until they exist
- [cp 3] → WL-01M29CBWPCBVAT1DYQYTPDGS3D (new) Authorize the Figma MCP connector; why: No Figma file can be created until the operator completes the OAuth flow
- [cp 3] → WL-01M29CBWPDC8MGC2977DA7E40T (new) Agree what to borrow from Linear and what stays workledger’s own; why: Without the boundary the restyle risks being another wholesale copy
- [cp 3] → WL-01M29CBWPDC8MGC2977DA7E40V (new) Build the design system in the Figma folder as variables and components; why: The operator wants to iterate on the design in Figma, not in code
- [cp 3] → WL-01M29CBWPDC8MGC2977DA7E40W (new) Restyle the app from the Linear-derived tokens; why: The app still wears the X palette and type
- [cp 3] → WL-01M29CBWPDC8MGC2977DA7E40X (new) Start the workledger desktop Figma server or drop it from the config; why: The figma-desktop MCP server refuses connections every session
- [cp 2] → WL-01M27MY3DMMXD6VXZ32DSS8X16 (closes) Merge PR 143 after its single review; why: Done: merged as e2d4c27
- [cp 2] → WL-01M27MY3DNWSS4AMSKF65TQ2K0 (closes) Restart the daemon from the main build after the merge; why: Done: daemon reopened on 7419 from the new build
- [cp 2] → WL-01M27MY3DNWSS4AMSKF65TQ2K1 (closes) Remove the p8-x-shell worktree after the merge; why: Done: worktree and branch removed
- [cp 1] → WL-01M27MY3DMMXD6VXZ32DSS8X16 (new) Merge PR 143 after its single review; why: The daemon on 7419 still serves the old Linear look
- [cp 1] → WL-01M27MY3DNWSS4AMSKF65TQ2K0 (new) Restart the daemon from the main build after the merge; why: The operator only sees the X look on real data after a restart
- [cp 1] → WL-01M27MY3DNWSS4AMSKF65TQ2K1 (new) Remove the p8-x-shell worktree after the merge; why: It stays on disk until the branch is merged
- [cp 1] → WL-01M27MY3DNWSS4AMSKF65TQ2K2 (new) Attribute sibling git worktrees to the repo they belong to; why: Work in a ../workledger-wt-* worktree is filed under the outer Projects repo

## Notes
- discovery [cp 1] by agent: The Stop hook attributed writes in the sibling worktree /Users/manashardas/Projects/workledger-wt-x-shell to the outer /Users/manashardas/Projects repo, because the worktree path is not under the workledger checkout. A worktree should resolve to its main repo via git rev-parse --git-common-dir.
- decision [cp 1] by agent: Dock the evidence panel in the right column as a module instead of keeping it floating over the page.; reason: X’s right column is its natural home, and docking stops the panel covering the timeline on wide screens.
- decision [cp 3] by human: Take Linear as the primary design inspiration, with Jira plus Confluence and Zenhub as secondary references, and build the design system in Figma first, iterating through the Figma MCP connector.; reason: Operator: workledger is a place where humans see what agents are doing, what backlog is generated, where the work is filed and what decisions are committed to memory; X is not the right ancestor for that kind of tool.
- blocker [cp 3] by agent: The Figma MCP connector needs the operator to complete an OAuth flow before any file or variable can be created; the separate figma-desktop MCP server refuses connections.
- decision [cp 4] by human: Linear is the reference for density, quiet chrome, one accent used sparingly and keyboard-first affordances; the accent hue, the status colours, the vocabulary and the layout emphasis stay workledger’s own.; reason: The operator rejected the X pass as a wholesale copy: a reference supplies qualities, not a palette, a type scale or component names. Linear’s brand terms restrict their marks and any implied affiliation, not inspiration.
- discovery [cp 4] by agent: A hover state that paints the same colour as its default is a lie: secondary, muted and selected were one value in light mode, so a hovered Secondary button did not change. color/selected moved one step past muted — dark #232529, light #e9edf0 — which also gives list rows a real selected surface. Tertiary text still clears AA on it at 4.58:1.
- discovery [cp 4] by agent: Figma traps worth knowing next time: createAutoLayout frames carry a default white fill that paints slabs through a dark theme; resize resets sizing modes to FIXED, so long labels overflow if it runs after the sizing is set; and a TEXT component property on a variant set shares one default across every variant, which flattens per-variant sample copy.
- decision [cp 5] by human: The screens target team scale over git: several people on shared repos, no server, no sync.; reason: The operator chose it over an organization with a sync service; it keeps every screen buildable on the architecture that exists, where the file format is the API and cloud mode is deferred.
- decision [cp 5] by human: One review surface carries three judgements: a verdict on each outcome, triage of the backlog agents propose, and approval of decisions.; reason: The operator chose all three over any single one. They are all a human steering agents, and splitting them across screens would scatter the same sitting into three places.
- decision [cp 5] by human: A human judgement informs an agent and never blocks it in this phase; a decision carries an enforce_as field that nothing evaluates yet.; reason: Operator choice: keep the blocking hook possible later without building predicate evaluation, false-positive tuning and a second product surface now.
- decision [cp 5] by human: The unit of judgement is the individual outcome, not the session.; reason: The operator changed this mid-conversation. A session-level verdict can only name the session, so a correction leaves the agent to infer which of eight outcomes was wrong.
- discovery [cp 5] by agent: Per-outcome review is high volume — around fifty judgements a day at the operator’s pace — so the review screen has to be keyboard-first with bulk actions and an unreviewed-only default, or unreviewed work piles up faster than anyone clears it.
- question [cp 5] by agent: Three approaches are on the table for where a verdict lives: its own ULID-named review file batched per sitting (recommended), inline on the outcome line in the session file, or a new note type. The operator has not chosen yet, and the design waits on it.
- decision [cp 6] by human: Keep the current data model and drop the review, verdict and decision-entity design. The session view leads with a succinct recap of a few points, and the provenance shows exactly what was done.; reason: Operator: the review design was getting too complicated and needed a rethink; after seeing the whole data model he judged it correct, so the work becomes presentation over the existing records rather than new schema.
- discovery [cp 6] by agent: A recap needs no new field and no model call. Outcomes already carry their evidence, so grouping them by commit and checkpoint is mechanical: this session’s sixteen outcomes fall into four groups — ship the X restyle, reverse it, build the design system, investigate the review design. The recap is derived at render time, which keeps the brief deterministic.
- discovery [cp 6] by agent: This session is status crashed with ended 2026-09-11T08:23:49Z, yet checkpoints 3, 4 and 5 are stamped 23:20, 00:00 and 00:32 — after the recorded end. Either the Stop hook should refuse to append to an ended session or ended should be advanced; until then any session view renders a contradiction.
- question [cp 6] by agent: The four recap points are drawn as cards, which contradicts the agreed direction that the reading column stays flat with hairline separation and cards are reserved for separable objects. Waiting on the operator to confirm flattening them.
- decision [cp 7] by human: Keep cards in the reading column for a session row and a recap point; the reading column is not flat after all. Sections inside a single record stay flat and hairline-separated.; reason: Operator: I love the design, keep going in the current direction. The written rule said the opposite, and a rule nobody follows is worse than no rule, so direction.md was amended to match what is drawn rather than leaving the two in conflict.
- discovery [cp 7] by agent: The ledger’s own data already contains something worth surfacing: on 9 September three sessions were started at 23:08, 23:10 and 23:12 with near-identical goals, each producing one outcome. The Ledger list groups by day so the duplication is visible rather than smoothed over. Detecting that pattern, rather than only rendering it, would be the first thing the product tells the operator that he did not already know.
- discovery [cp 7] by agent: Figma variables and styles do not cross files until the owning file is published as a team library, which the MCP connector cannot do. The designs file therefore carries its own identical copy of the two collections and the nine text styles; a token change has to be made in both places until the system file is published, and only the system file is the one from-figma reads.
- discovery [cp 8] by agent: Home on real data is the first screen that tells the operator something he did not already know: the Projects folder carries 105 open items and 34 questions, more than every real project combined, because worktree and sibling-directory sessions are filed there rather than in the repo they were about; and splitfire is tracked, hooked and has never run. Both are surfaced as flags rather than folded into a total.
- discovery [cp 8] by agent: Every screen was drawn against this repo’s own ledger and the running daemon’s repo list, which caught two fabricated numbers in the Session mockup that placeholder content would have hidden. Designing on real records is what made the Home findings visible at all; lorem would have shown fifteen tidy projects with plausible counts.
- blocker [cp 8] by agent: The design system file cannot be published as a Figma team library through the MCP connector; only the operator can do it in the Figma UI. Until then the designs file keeps its own duplicate copy of both variable collections and the nine text styles, a token change has to be made in both files, and the two will drift.
- decision [cp 9] by human: The left panel carries four views in this order: Home, Ledger, Session, Review. Home is everything, Ledger is the sessions of one project, Session is one session’s activities, Review is everything that needs a human.; reason: Operator instruction on 2026-09-12, moving from design to implementation. Review absorbing both Next and Needs you follows from his own description of it as all the needs-you stuff, and matches the Review screen already designed in Figma.
- discovery [cp 9] by agent: About thirty of the forty-two failures are not a regression: ledger.test.tsx and excerpt.test.tsx mount the Ledger view directly and then expect session detail from it, which was true when the Ledger owned the detail route and is not now that Session does. They need to mount the Session view instead. The rest are stale view ids in assertions.
- question [cp 9] by agent: Jobs and Health are off the nav but still routable and still linked from Home. The operator listed only four views, and a nav of six blunts the four that matter, but this removes the only visible way to reach the recovery queue and the diagnostics. Confirm they stay off, or restore them below a separator.
- decision [cp 10] by human: Jobs and Health return to the nav below a separator, and Needs you becomes Review throughout the interface.; reason: Operator answered both open questions on 2026-09-12. Keeping the two off the nav entirely would have left the recovery queue and the diagnostics with no visible route, and a nav whose label disagreed with the heading it opens would teach two names for one thing.
- discovery [cp 10] by agent: An edit to the nav map silently did not apply: the anchor text no longer matched because an earlier pass had already rewritten that comment. Nothing warned — the helper and its prop existed while nothing passed them, so the separator would simply never have drawn. Re-reading the block before re-editing caught it. Blind edits against remembered text are how a refactor ends up half-applied.
- discovery [cp 10] by agent: The 42 failures are mapped to six files and their exact assertions: the route table and nav hrefs in shell, the detail tests in ledger and excerpt that mount the wrong view, the view table in narrow, and the Needs you labels in home and machine. Two judgement calls are encoded in the fix: the machine-wide needs test becomes a Review test rather than being deleted, and narrow gains Session to its 375 px sweep so a new view cannot scroll sideways on a phone uncaught.
- discovery [cp 11] by agent: The recap shows five points for this session where the Figma mockup showed four. The mockup merged two checkpoints into one ship-it point, which was me editorialising; the mechanical rule groups by the evidence actually recorded and gives 8f867ef, e2d4c27, eb45e80, then the two checkpoints with no commit. The code stayed honest and the Figma frame is now the thing that needs correcting.
- decision [cp 11] by agent: One test changed meaning rather than being deleted: the session page may now show a commit, because the recap groups outcomes by it.; reason: The rule that test protected was that a Done item’s evidence — its detail, files and verification — stays off the page and waits in the drawer. Those assertions stay. Deleting the whole test would have quietly dropped the rule along with the one clause that had genuinely changed.
- discovery [cp 11] by agent: The Inter package ships no Latin-only entry point: index.css and wght.css declare the same seven unicode subsets, so two attempts at trimming the bundle changed nothing. It sits at 342 KiB gzipped against a 1024 KiB cap, which is fine here but matters for the Dome card target and its 5 MB budget. Trimming further would mean vendoring a subset by hand.
- blocker [cp 12] by human: The operator has seen no change in the running app across four sessions, because every commit went to a branch in a worktree while the daemon serves the main checkout’s build. Shipping to a branch is not shipping. Merge and restart the daemon as part of the work, not after it.
- decision [cp 12] by human: The left panel is Home, Ledger, Sessions, Review in that order, and the Figma mocks are correct otherwise.; reason: Operator instruction on 2026-09-12, with the label now plural. The mocks were corrected first and the code label follows them, so the drawing and the app agree before anyone builds against either.
- discovery [cp 13] by agent: Home cannot reach Ledger or Sessions at all. navFor takes a repo-scoped route to build those links, and a machine-wide route has no repo in scope, so it returns only Home, Review and Jobs. The fix is to point them at the most recently active project — a nav item that guesses sensibly beats one that is absent.
- discovery [cp 13] by agent: Two near-misses while shipping, both from trusting a command sequence instead of the artefact. The merge ran in ~/Projects — the outer empty repo — and failed with a message a pipe swallowed; then the build failed because main lacked the font dependency the merge introduced, and the daemon was restarted anyway, serving the old bundle. Checking the served hash caught both. Verify the thing changed, not that the commands ran.
- decision [cp 13] by agent: On a machine-wide route, Ledger and Sessions link to the most recently active project rather than being hidden.; reason: The operator asked for four views in the left panel; omitting two of them on the one screen that is always reachable makes the nav inconsistent and strands those views behind the project switcher.

## Memory
- [cp 3] When the operator points at another product’s UI, borrow the named qualities and keep workledger’s own identity; never reproduce its palette, type scale, shapes or module names one-for-one. file: ~/.claude/projects/-Users-manashardas-Projects-workledger/memory/reference-design-is-inspiration.md
- [cp 4] The design system is Figma file O8nwIMP8e9zqqtOEJuCIyd; its variables must be named exactly as tokens.json paths or the from-figma sync refuses to write. file: ~/.claude/projects/-Users-manashardas-Projects-workledger/memory/figma-design-system.md
- [cp 4] Index line pointing at the Figma design system memory. file: ~/.claude/projects/-Users-manashardas-Projects-workledger/memory/MEMORY.md
