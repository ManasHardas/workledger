# Close-keyword convention (PERMANENT)

## Body (paste verbatim into dispatch briefs)

> **Auto-close keyword discipline — three rules:**
>
> 1. **One issue per line.** If your PR closes one issue: PR body's first line is `Closes #<N>` on its own line. If your PR closes multiple issues (bundled-PR pattern): list each issue on its OWN `Closes #<N>` line. GitHub's auto-close keyword only matches the `Closes #N` prefix pattern PER LINE — `Closes #40 + #41` will close #40 but leave #41 stale-open.
>
> 2. **No close/fix/resolve keywords in narrative prose.** Anywhere in the PR body or commit message, do NOT write `close #N`, `fix #N`, `fixes #N`, `resolved #N`, `Partially closes #N`, or any other close-family keyword adjacent to a `#N` reference in narrative content. GitHub's auto-close regex is permissive — narrative phrasing fires it. If you need to mention an issue narratively, use either a bare `#N` (no close-keyword) or write `see #N` / `refs #N` / `tracks #N`.
>
> 3. **No `(#N)` fragments in PR titles unless that PR genuinely closes #N.** PR titles that include `(#N)` as a back-reference (e.g., "Follow-up to fix from #155") can trigger spurious auto-close on merge. Use plain prose: "Follow-up to fix from PR 155".

## Why permanent

Real-project history: bundled PRs using comma-separated or plus-separated `Closes` keywords (`Closes #40 + #41`, `Closes #40, #41`) have GitHub auto-close ONLY the first issue. The second issue stays open until manually closed at a future session opener. Wasted opener time + stale-issue-list pollution.

After encoding this clause as one-line-per-Closes, bundled PRs reliably auto-close all referenced issues on merge.

## Examples

### Single-issue PR

```
Closes #142

## Summary
- ...
```

### Bundled-PR (multiple issues)

```
Closes #155
Closes #156

## Summary
- ...
```

WRONG — only #155 closes:

```
Closes #155 + #156

## Summary
...
```

WRONG — only #155 closes:

```
Closes #155, #156

## Summary
...
```

### Narrative-adjacency (rule 2)

WRONG — `fixes #420` in narrative content auto-fires:

```
Closes #155

## Summary
This PR builds on prior fixes #420 and #421 to extend ...
```

WRONG — `Partially closes #N` literal-matches:

```
## Summary
- Partially closes #568 (full close in follow-up PR)
```

CORRECT — bare `#N` is safe:

```
Closes #155

## Summary
This PR builds on #420 and #421 to extend ...
```

### Spurious auto-close from PR title (rule 3)

WRONG — PR title `Follow-up to fix from (#155)` will auto-close #155 on merge even though this PR is not closing it:

```
Title: Follow-up to fix from (#155)
```

CORRECT — use plain prose:

```
Title: Follow-up to fix from PR 155
```

## Verification at merge — T-Y watchdog

Auto-close keyword discipline is enforced at dispatch-write-time, but verification happens after merge via T-Y (see `agents/pm.md` §Coordination watchdogs). For each merged PR:

1. Read the PR's `Closes #N` references plus any `(#N)` in the title.
2. `gh issue view <N>` each — verify state.
3. If `Closes #N` failed to fire: `gh issue close <N>` manually.
4. If a spurious auto-close fired on an unrelated issue: `gh issue reopen <N>` with a comment explaining the trigger.

T-Y catches both rule-1 (malformed bundled close) and rule-3 (spurious title close) at merge time, before the bad state propagates into the next session's SHD.

## Tracking in PR body

Build agents confirm in the "Dispatch-template clauses honored" section:

```markdown
- **Close-keyword convention:** ✅ `Closes #<N>` first line of PR body
  (or N separate lines for bundled PRs).
```
