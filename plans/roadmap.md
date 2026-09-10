# workledger roadmap — phases

Maps the spec's milestones (`docs/superpowers/specs/2026-09-09-workledger-design.md` §15) onto
agentwaves phases. Each phase has its own `plans/feature-p<N>-<slug>.md` written at its Wave 0;
only P1 exists now. Session counts are bootstrap estimates with no priors (first project through
this framework); `plans/velocity.json` replaces them as data arrives.

| Phase | Name | Ships | Sessions (est.) | Tag |
|---|---|---|---|---|
| **P1** | CLI core | Monorepo scaffold; `packages/core` schema, validation, rendering, brief, secret scan; local index; `workledger init` (Claude Code), `hook`, `checkpoint`, `brief`, `doctor`; CI; dogfood on this repo and `dome_workspace` | 3–4 | `p1-shipped` |
| **P2** | Local UI | `packages/server` (Hono, index, SSE, file watcher); `packages/api-client` with the `LedgerSource` interface and `LocalServerSource`; `apps/web` Ledger, Next (editing), Needs you, provenance panel, Health; `packages/tokens` default theme | 4–5 | `p2-shipped` |
| **P3** | Recovery and backfill | Orphan scan, `repair` by headless resume, `backfill` with the lookback selector, extraction fallback with consent and cost display, Jobs view | 2–3 | `p3-shipped` |
| **P4** | More harnesses | Cursor adapter (`followup_message`, `additional_context`, `user_email`); Codex adapter after day-one verification of its stop hook | 2–3 | `p4-shipped` |
| **P5** | Team | `auto_commit` option, teammate onboarding path, private sessions and private paths, `identities.yaml`, `doctor` completeness | 2 | `p5-shipped` |
| **P6** (deferred 2026-09-09 by the operator; spec and contracts on main) | Dome card | `CardFSSource`, `publish --target cardfs`, `pull --from cardfs`, `apps/card` with the SDK bootstrap, `dome` theme, subtree mirror to `DomeHQ/card-workledger` | 3–4 | `p6-shipped` |
| **P7** | Design pass | Figma variables into `packages/tokens`, Code Connect files, PWA and mobile polish | 2–3 | `p7-shipped` |
| **P8** (operator priority 2026-09-09, before P7 Wave 1) | Onboarding and home | One daemon per machine (`workledger` = `open`, `stop`), Home over every tracked repo, web onboarding wizard (projects, 7/30/90-day history, resume consent or extraction estimate with deny, live backfill, completion), `npm install -g` and Homebrew tap | 2 | `p8-shipped` |

Dependencies: P2 needs P1's ledger and CLI. P3 needs P2's server for jobs. P4 is independent of P3.
P5 is independent of P3 and P4. P6 needs P2 and P5 (identities). P7 needs P2 and, for the card
screens, P6. P8 needs P2 and P3 (jobs) and supersedes `serve --repo` as the default entry point.

Dogfooding rule (DL-14): from the first P1 session in which `workledger checkpoint` works, this
repository is an enabled repo and every later session records checkpoints here.
