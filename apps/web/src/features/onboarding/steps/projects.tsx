import { useCallback, useMemo, useState, type FormEvent } from "react";

import { AsyncPanel } from "../../../components/async-panel.js";
import { Badge } from "../../../components/ui/badge.js";
import { Button } from "../../../components/ui/button.js";
import { Input } from "../../../components/ui/input.js";
import { cn } from "../../../lib/cn.js";
import { messageOf } from "../../../lib/errors.js";
import { isSuggested } from "../../../lib/ledger-source.js";
import type { AppSource, DiscoverResult, InitRepoResult, RepoCandidate } from "../../../lib/ledger-source.js";
import { useAsync } from "../../../lib/use-async.js";
import { useAction } from "../../jobs/use-jobs.js";
import { formatRelative, harnessCounts, harnessLabel, plural, unsuggestedHint } from "../format.js";
import { goTo, replaceWith, type WizardState } from "../state.js";
import { StepActions, StepFrame } from "../wizard.js";

/** Joins a path list into a dependency key; no path can hold it. */
const LIST_SEP = "\u0000";

/**
 * Step 1 — which repos to track (plans/feature-p8-onboarding-home.md step 2).
 *
 * Two lists from `GET /api/onboarding/discover`: the repos the harness stores already have
 * sessions for, pre-checked when the daemon suggests them (amendment 2), and the other git repos
 * under the roots, unchecked. A repo that is already enabled is shown ticked and locked so the
 * operator sees it is covered without being able to re-select it. Continue is `POST
 * /api/onboarding/init` for the selection, and the step then shows what `init` did in each repo
 * before moving on — the hook files are real writes into the operator's repos, and they get to
 * read the list.
 */
export function ProjectsStep({ state, source }: { state: WizardState; source: AppSource }) {
  // The list's identity is its contents: the array itself is a new object on every hash read.
  const rootsKey = state.roots.join(LIST_SEP);
  const discovered = useAsync(
    useCallback(
      () => source.discover(rootsKey === "" ? undefined : rootsKey.split(LIST_SEP)),
      [source, rootsKey],
    ),
  );
  const init = useAction(useCallback((repos: string[]) => source.initRepos({ repos }), [source]));

  if (init.state.state === "done") {
    return <InitSummary results={init.state.value.results} state={state} onBack={init.reset} />;
  }

  return (
    <StepFrame
      title="Choose the repos to track"
      lead={
        <>
          Repos your coding agents have worked in are listed first and pre-checked. Continue runs{" "}
          <code>workledger init</code> in each selected repo: it writes the harness hook files and a{" "}
          <code>.workledger/</code> folder there, and nothing else.
        </>
      }
    >
      <AsyncPanel result={discovered} empty="">
        {(found) => (
          <RepoPicker
            found={found}
            state={state}
            initState={init.state}
            onContinue={(repos) => init.run(repos)}
          />
        )}
      </AsyncPanel>
    </StepFrame>
  );
}

/** The selection: the checked paths, or the daemon's suggestion when nothing was touched yet. */
export function selectedRepos(found: DiscoverResult, state: WizardState): string[] {
  if (state.repos !== undefined) return state.repos;
  return found.known.filter((repo) => !repo.enabled && isSuggested(repo)).map((repo) => repo.path);
}

function RepoPicker({
  found,
  state,
  initState,
  onContinue,
}: {
  found: DiscoverResult;
  state: WizardState;
  initState: ReturnType<typeof useAction<[string[]], unknown>>["state"];
  onContinue: (repos: string[]) => void;
}) {
  const selected = useMemo(() => selectedRepos(found, state), [found, state]);
  const all = useMemo(() => [...found.known, ...found.found], [found]);
  const enabledCount = found.known.filter((repo) => repo.enabled).length;

  function toggle(path: string, on: boolean) {
    const next = on ? [...selected, path] : selected.filter((each) => each !== path);
    replaceWith({ ...state, repos: next });
  }

  const running = initState.state === "running";

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <RepoGroup
        title="Repos with agent sessions"
        candidates={found.known}
        all={all}
        selected={selected}
        onToggle={toggle}
        disabled={running}
        empty="No repo on this machine has Claude Code or Codex sessions yet."
      />
      <RepoGroup
        title={`Other git repos under ${found.roots.join(", ")}`}
        candidates={found.found}
        all={all}
        selected={selected}
        onToggle={toggle}
        disabled={running}
        empty="No other git repos under these folders."
      />
      <AddFolder state={state} disabled={running} />

      {initState.state === "failed" ? (
        <p role="alert" className="text-sm text-destructive">
          Could not enable the selected repos: {messageOf(initState.error)}
        </p>
      ) : null}

      <StepActions>
        <p className="text-sm text-muted-foreground">
          {plural(selected.length, "repo")} selected
          {enabledCount > 0 ? ` · ${plural(enabledCount, "repo")} already tracked` : ""}
        </p>
        <Button
          className="ml-auto"
          disabled={selected.length === 0 || running}
          onClick={() => onContinue(selected)}
        >
          {running ? "Enabling…" : "Continue"}
        </Button>
      </StepActions>
    </div>
  );
}

function RepoGroup({
  title,
  candidates,
  all,
  selected,
  onToggle,
  disabled,
  empty,
}: {
  title: string;
  candidates: RepoCandidate[];
  all: RepoCandidate[];
  selected: string[];
  onToggle: (path: string, on: boolean) => void;
  disabled: boolean;
  empty: string;
}) {
  const now = Date.now();
  return (
    <fieldset className="flex min-w-0 flex-col gap-2">
      <legend className="mb-2 text-sm font-semibold">{title}</legend>
      {candidates.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {candidates.map((repo) => (
            <li key={repo.path}>
              <CandidateRow
                repo={repo}
                hint={isSuggested(repo) ? null : unsuggestedHint(repo, all)}
                checked={repo.enabled || selected.includes(repo.path)}
                disabled={disabled || repo.enabled}
                onToggle={(on) => onToggle(repo.path, on)}
                now={now}
              />
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}

function CandidateRow({
  repo,
  hint,
  checked,
  disabled,
  onToggle,
  now,
}: {
  repo: RepoCandidate;
  hint: string | null;
  checked: boolean;
  disabled: boolean;
  onToggle: (on: boolean) => void;
  now: number;
}) {
  const counts = harnessCounts(repo);
  return (
    <label
      className={cn(
        "flex min-w-0 cursor-pointer items-start gap-3 rounded-lg border border-border bg-card p-3 hover:bg-muted has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
        disabled && "cursor-default opacity-70 hover:bg-card",
      )}
    >
      <input
        type="checkbox"
        className="mt-1 h-4 w-4 shrink-0 accent-primary"
        checked={checked}
        disabled={disabled}
        aria-label={repo.name}
        aria-describedby={`${repo.path}-meta`}
        onChange={(event) => onToggle(event.target.checked)}
      />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">{repo.name}</span>
          {repo.enabled ? <Badge variant="secondary">already tracked</Badge> : null}
          {!repo.hasGit ? <Badge variant="outline">not a git repo</Badge> : null}
          {hint !== null ? <Badge variant="outline">{hint}</Badge> : null}
        </span>
        <span className="break-all font-mono text-xs text-muted-foreground">{repo.path}</span>
        <span id={`${repo.path}-meta`} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {counts.map(([harness, sessions]) => (
            <span key={harness}>
              {harnessLabel(harness)} · {plural(sessions, "session")}
            </span>
          ))}
          {repo.lastSessionAt !== null ? <span>last session {formatRelative(repo.lastSessionAt, now)}</span> : null}
        </span>
      </span>
    </label>
  );
}

/** One more folder to walk for git repos. Absolute, because the daemon refuses anything else. */
function AddFolder({ state, disabled }: { state: WizardState; disabled: boolean }) {
  const [value, setValue] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    const folder = value.trim().replace(/\/+$/, "");
    if (!folder.startsWith("/")) {
      setProblem("Enter an absolute path, such as /Users/you/code.");
      return;
    }
    setProblem(null);
    setValue("");
    if (state.roots.includes(folder)) return;
    replaceWith({ ...state, roots: [...state.roots, folder] });
  }

  return (
    <form onSubmit={submit} className="flex min-w-0 flex-col gap-2">
      <label htmlFor="add-folder" className="text-sm font-semibold">
        Add folder
      </label>
      <p className="text-xs text-muted-foreground">
        Another folder to look in for git repos (up to three levels deep). Its repos join the second
        list.
      </p>
      <div className="flex min-w-0 gap-2">
        <Input
          id="add-folder"
          value={value}
          disabled={disabled}
          placeholder="/absolute/path/to/folder"
          aria-invalid={problem !== null}
          aria-describedby={problem === null ? undefined : "add-folder-problem"}
          onChange={(event) => setValue(event.target.value)}
        />
        <Button type="submit" variant="outline" disabled={disabled || value.trim() === ""}>
          Add
        </Button>
      </div>
      {problem !== null ? (
        <p id="add-folder-problem" role="alert" className="text-xs text-destructive">
          {problem}
        </p>
      ) : null}
      {state.roots.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label="Added folders">
          {state.roots.map((root) => (
            <li key={root}>
              <Badge variant="outline" className="gap-1 font-mono">
                {root}
                <button
                  type="button"
                  aria-label={`Remove ${root}`}
                  disabled={disabled}
                  className="rounded-full px-1 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => replaceWith({ ...state, roots: state.roots.filter((each) => each !== root) })}
                >
                  ×
                </button>
              </Badge>
            </li>
          ))}
        </ul>
      ) : null}
    </form>
  );
}

/** What `init` did: per repo, the files written, the Codex step if any, or why it failed. */
function InitSummary({ results, state, onBack }: { results: InitRepoResult[]; state: WizardState; onBack: () => void }) {
  const enabled = results.filter((result) => result.ok).map((result) => result.path);
  const failed = results.length - enabled.length;
  return (
    <StepFrame
      title="Repos enabled"
      lead={
        failed === 0
          ? `workledger init ran in ${plural(results.length, "repo")}. From now on every agent session in them is recorded. Next: how much history to backfill.`
          : `${plural(enabled.length, "repo")} enabled; ${plural(failed, "repo")} could not be, and will be left out of the backfill.`
      }
    >
      <ul className="flex flex-col gap-2" aria-label="Init results">
        {results.map((result) => (
          <li key={result.path} className="flex min-w-0 flex-col gap-1 rounded-lg border border-border bg-card p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{result.path.split("/").pop()}</span>
              {result.ok ? (
                <Badge variant="outline" className="border-transparent bg-success text-success-foreground">
                  enabled
                </Badge>
              ) : (
                <Badge variant="destructive">failed</Badge>
              )}
            </div>
            <span className="break-all font-mono text-xs text-muted-foreground">{result.path}</span>
            {result.ok ? (
              result.hooksWritten.length === 0 ? (
                <p className="text-xs text-muted-foreground">Already set up — no files to write.</p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Wrote{" "}
                  {result.hooksWritten.map((file, index) => (
                    <span key={file}>
                      {index > 0 ? ", " : ""}
                      <code>{file}</code>
                    </span>
                  ))}
                </p>
              )
            ) : (
              <p role="alert" className="text-xs text-destructive">
                {result.error ?? "init failed"}
              </p>
            )}
            {result.trustSteps.length > 0 ? (
              <div className="rounded-md bg-warning/20 p-2 text-xs">
                <p className="font-semibold">One-time step in Codex</p>
                <ol className="list-decimal pl-4">
                  {result.trustSteps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      <StepActions>
        <Button variant="ghost" onClick={onBack}>
          Back
        </Button>
        <Button
          className="ml-auto"
          disabled={enabled.length === 0}
          onClick={() => goTo({ ...state, step: "history", repos: enabled })}
        >
          Next: choose history
        </Button>
      </StepActions>
    </StepFrame>
  );
}
