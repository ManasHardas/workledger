/**
 * The onboarding wizard (#79) — `#/onboarding`, step by step, against a stubbed source.
 *
 * The stub delegates to the fixture source and records every wizard call, so each test asserts
 * both what the operator sees and what the daemon was asked. The URL is the wizard's state, so
 * "reload resumes" is a test that sets the hash and renders; "Back works" is a test that the
 * step change pushed a history entry and a selection change did not.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../src/app.js";
import { REPOS_CHANGED_EVENT } from "../src/features/home/live.js";
import { BackfillBanner } from "../src/features/onboarding/banner.js";
import { BACKFILL_RUN_KEY, readBackfillRun, startBackfillRun } from "../src/features/onboarding/flags.js";
import { unsuggestedHint } from "../src/features/onboarding/format.js";
import { INITIAL_STATE, parseWizardHash, wizardHref } from "../src/features/onboarding/state.js";
import { outcomeLine } from "../src/features/onboarding/steps/done.js";
import { RESUME_QUESTION, explainRunFailure } from "../src/features/onboarding/steps/method.js";
import { jobsOfRun, progressByRepo } from "../src/features/onboarding/use-backfill-progress.js";
import { formatLocalTime } from "../src/features/jobs/format.js";
import { OnboardingWizard, reachableStep } from "../src/features/onboarding/wizard.js";
import { FIXTURE_DISCOVER, FIXTURE_HISTORY, FIXTURE_REPOS, FIXTURE_TRUST_STEP, FIXTURE_WORKSPACE } from "../src/lib/fixtures.js";
import { createSource } from "../src/lib/ledger-source.js";
import { ONBOARDING_HREF } from "../src/lib/router.js";
import { MachineProvider } from "../src/lib/source-context.js";

import type {
  AppSource,
  Job,
  JobAcrossRepos,
  LedgerEvent,
  OnboardingStatus,
  Repo,
  RepoCandidate,
} from "../src/lib/ledger-source.js";

const DASHERO = `${FIXTURE_DISCOVER.roots[0]!}/dashero`;
const KUBERA = `${FIXTURE_DISCOVER.roots[0]!}/kubera`;
const MENTAT = `${FIXTURE_DISCOVER.roots[0]!}/mentat`;

function job(overrides: Partial<Job> = {}): Job {
  return {
    id: "01JOB000000000000000000001",
    kind: "backfill",
    session_ulid: "01JBQ4Z8W2K7N3RQ9XMDT5V0AE",
    repo_path: DASHERO,
    status: "queued",
    attempts: 1,
    created_at: "2026-09-09T09:00:00.000Z",
    started_at: null,
    finished_at: null,
    heartbeat_at: null,
    error: null,
    cost_estimate_usd: null,
    log_path: null,
    error_code: null,
    retry_after: null,
    ...overrides,
  };
}

interface Stub {
  source: AppSource;
  /** Every wizard call, as `name:json-args`. */
  calls: string[];
  emit: (event: LedgerEvent) => void;
}

/** The fixture source with the wizard's calls recorded and any of them replaceable. */
function stubSource(overrides: Partial<AppSource> = {}): Stub {
  const base = createSource("fixture");
  const calls: string[] = [];
  const handlers = new Set<(event: LedgerEvent) => void>();
  const record =
    <A extends unknown[], T>(name: string, call: (...args: A) => Promise<T>) =>
    (...args: A): Promise<T> => {
      calls.push(`${name}:${JSON.stringify(args)}`);
      return call(...args);
    };
  // An override replaces the fixture's answer, never the recording around it.
  const source = Object.assign(Object.create(base) as AppSource, {
    capabilities: { write: true, live: true, provenance: false },
    subscribe(handler: (event: LedgerEvent) => void) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    ...overrides,
    discover: record("discover", (roots?: string[]) => (overrides.discover ?? base.discover.bind(base))(roots)),
    history: record("history", (repos: string[]) => (overrides.history ?? base.history.bind(base))(repos)),
    initRepos: record("initRepos", (input: Parameters<AppSource["initRepos"]>[0]) =>
      (overrides.initRepos ?? base.initRepos.bind(base))(input),
    ),
    plan: record("plan", (input: Parameters<AppSource["plan"]>[0]) => (overrides.plan ?? base.plan.bind(base))(input)),
    run: record("run", (input: Parameters<AppSource["run"]>[0]) => (overrides.run ?? base.run.bind(base))(input)),
    status: record("status", () => (overrides.status ?? base.status.bind(base))()),
  });
  return { source, calls, emit: (event) => handlers.forEach((handler) => handler(event)) };
}

function renderWizard(source: AppSource, hash = ONBOARDING_HREF) {
  window.location.hash = hash;
  return render(
    <MachineProvider source={source}>
      <OnboardingWizard />
    </MachineProvider>,
  );
}

/** The hash's query, decoded, for assertions on the wizard's state. */
function state() {
  return parseWizardHash(window.location.hash);
}

/**
 * Node ≥ 22 defines an experimental `globalThis.localStorage` that is `undefined` without
 * `--localstorage-file`, and vitest's jsdom environment leaves an existing global alone — so the
 * app's storage is stubbed here with the same `Storage` shape a browser has.
 */
function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (index) => [...map.keys()][index] ?? null,
    removeItem: (key) => void map.delete(key),
    setItem: (key, value) => void map.set(key, String(value)),
  };
}

beforeAll(() => {
  Object.defineProperty(window, "localStorage", { value: memoryStorage(), configurable: true });
});

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, "", "#/");
});

afterEach(cleanup);

describe("wizard state in the hash", () => {
  it("round-trips every field and tells an empty selection from none", () => {
    const full = {
      step: "history" as const,
      roots: ["/Users/me/code", "/srv/a,b"],
      repos: [DASHERO, KUBERA],
      workspaces: [`${FIXTURE_DISCOVER.roots[0]!}/dome_workspace`],
      since: "all" as const,
      method: "resume" as const,
    };
    expect(parseWizardHash(wizardHref(full))).toEqual(full);
    expect(parseWizardHash(ONBOARDING_HREF)).toEqual(INITIAL_STATE);
    expect(parseWizardHash("#/onboarding?step=nope&since=2d")).toEqual(INITIAL_STATE);
    // `repos=` present and empty is "every box unticked"; absent is "not chosen yet".
    expect(parseWizardHash("#/onboarding?step=projects&repos=").repos).toEqual([]);
    expect(parseWizardHash("#/onboarding?step=projects").repos).toBeUndefined();
  });

  it("never lands on a step whose inputs the URL does not hold", () => {
    expect(reachableStep({ ...INITIAL_STATE, step: "history" })).toBe("projects");
    expect(reachableStep({ ...INITIAL_STATE, step: "running", repos: [DASHERO] })).toBe("history");
    expect(reachableStep({ ...INITIAL_STATE, step: "running", repos: [DASHERO], since: "7d" })).toBe("method");
    expect(reachableStep({ ...INITIAL_STATE, step: "running", repos: [DASHERO], since: "7d", method: "resume" })).toBe(
      "running",
    );
    expect(reachableStep({ ...INITIAL_STATE, step: "done", repos: [DASHERO], since: "none" })).toBe("done");
    expect(reachableStep({ ...INITIAL_STATE, step: "running", repos: [DASHERO], since: "7d", method: "none" })).toBe(
      "done",
    );
  });
});

describe("projects step", () => {
  it("lists known repos pre-checked when suggested, found repos unchecked, tracked repos locked", async () => {
    const { source, calls } = stubSource();
    renderWizard(source);
    await screen.findByRole("heading", { name: "Choose the repos to track" });
    expect(calls).toEqual(["discover:[]"]);

    const known = screen.getByRole("group", { name: "Repos with agent sessions" });
    const found = screen.getByRole("group", { name: `Other git repos under ${FIXTURE_DISCOVER.roots[0]!}` });

    const workledger = within(known).getByRole("checkbox", { name: "workledger" }) as HTMLInputElement;
    expect(workledger.checked).toBe(true);
    expect(workledger.disabled).toBe(true);
    expect(within(known).getByText("already tracked")).toBeDefined();

    const dashero = within(known).getByRole("checkbox", { name: "dashero" }) as HTMLInputElement;
    expect(dashero.checked).toBe(true);
    expect(dashero.disabled).toBe(false);
    // Per-harness session counts and the last session time ride on the row.
    expect(within(known).getByText("Claude Code · 12 sessions")).toBeDefined();
    expect(within(known).getByText("Codex · 5 sessions")).toBeDefined();
    expect(within(known).getAllByText(/last session .* ago/).length).toBeGreaterThan(0);

    // Amendment 2: a known repo the daemon does not suggest is unchecked, with the ancestor hint;
    // and one without `.git` cannot be ticked at all — `init` would refuse the whole batch.
    const projects = within(known).getByRole("checkbox", { name: "Projects" }) as HTMLInputElement;
    expect(projects.checked).toBe(false);
    expect(projects.disabled).toBe(true);
    expect(within(known).getByText("contains other repos")).toBeDefined();
    expect(within(known).getByText("not a git repo")).toBeDefined();

    for (const box of within(found).getAllByRole("checkbox")) expect((box as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText("2 repos selected · 1 repo already tracked")).toBeDefined();
  });

  it("only hints an unsuggested repo that is an ancestor of another candidate", () => {
    const parent: RepoCandidate = { ...FIXTURE_DISCOVER.known[3]!, suggested: false };
    expect(unsuggestedHint(parent, FIXTURE_DISCOVER.known)).toBe("contains other repos");
    const lone: RepoCandidate = { ...parent, path: "/tmp/scratch" };
    expect(unsuggestedHint(lone, FIXTURE_DISCOVER.known)).toBeNull();
  });

  it("keeps Continue disabled until something is selected and keeps the selection in the hash", async () => {
    const { source } = stubSource();
    renderWizard(source);
    await screen.findByRole("heading", { name: "Choose the repos to track" });

    const dashero = screen.getByRole("checkbox", { name: "dashero" });
    const kubera = screen.getByRole("checkbox", { name: "kubera" });
    const before = window.history.length;
    fireEvent.click(dashero);
    fireEvent.click(kubera);
    await waitFor(() => expect(state().repos).toEqual([]));
    // A selection change replaces the entry: Back must not walk through every checkbox.
    expect(window.history.length).toBe(before);
    expect((screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole("checkbox", { name: "mentat" }));
    await waitFor(() => expect(state().repos).toEqual([MENTAT]));
    expect((screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("adds an absolute folder to the roots and re-discovers; refuses a relative one", async () => {
    const { source, calls } = stubSource();
    renderWizard(source);
    await screen.findByRole("heading", { name: "Choose the repos to track" });

    const input = screen.getByLabelText("Add folder");
    fireEvent.change(input, { target: { value: "code" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByRole("alert").textContent).toMatch(/absolute path/);
    expect(calls).toEqual(["discover:[]"]);

    // The daemon's default root keeps being walked beside the added one.
    fireEvent.change(input, { target: { value: "/Users/me/code/" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(calls).toContain('discover:[["/Users/me/Projects","/Users/me/code"]]'));
    expect(state().roots).toEqual(["/Users/me/code"]);
    expect(
      await screen.findByRole("group", { name: "Other git repos under /Users/me/Projects, /Users/me/code" }),
    ).toBeDefined();
    expect(screen.getByRole("checkbox", { name: "mentat" })).toBeDefined();
    expect(within(screen.getByRole("list", { name: "Added folders" })).getByText("/Users/me/code")).toBeDefined();
  });

  it("reloaded with a root in the URL, learns the default root first and walks both", async () => {
    const { source, calls } = stubSource();
    renderWizard(source, `${ONBOARDING_HREF}?roots=${encodeURIComponent("/Users/me/code")}`);
    await screen.findByRole("group", { name: "Other git repos under /Users/me/Projects, /Users/me/code" });
    expect(calls).toEqual(["discover:[]", 'discover:[["/Users/me/Projects","/Users/me/code"]]']);
  });

  it("drops a non-git path a stale URL selects before it reaches init", async () => {
    const { source, calls } = stubSource();
    renderWizard(source, wizardHref({ ...INITIAL_STATE, repos: [FIXTURE_DISCOVER.roots[0]!, DASHERO] }));
    await screen.findByRole("heading", { name: "Choose the repos to track" });
    expect(screen.getByText("1 repo selected · 1 repo already tracked")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByRole("heading", { name: "Repos enabled" });
    expect(calls).toContain(`initRepos:[{"repos":${JSON.stringify([DASHERO])}}]`);
  });

  it("shows what discover refused", async () => {
    const { source } = stubSource({
      discover: () => Promise.reject(Object.assign(new Error("/nope does not exist"), { code: "invalid-root" })),
    });
    renderWizard(source, `${ONBOARDING_HREF}?roots=%2Fnope`);
    expect((await screen.findByRole("alert")).textContent).toContain("/nope does not exist");
  });

  it("Continue runs init for the selection and shows hook files, Codex steps and errors per repo", async () => {
    const { source, calls } = stubSource({
      initRepos: async (input) => ({
        results: [
          { path: DASHERO, ok: true, hooksWritten: [".claude/settings.json"], trustSteps: [] },
          { path: KUBERA, ok: true, hooksWritten: [".codex/hooks.json"], trustSteps: [FIXTURE_TRUST_STEP] },
          { path: MENTAT, ok: false, hooksWritten: [], trustSteps: [], error: "git identity is empty" },
        ].filter((result) => input.repos.includes(result.path)),
      }),
    });
    const announced = vi.fn();
    window.addEventListener(REPOS_CHANGED_EVENT, announced);
    renderWizard(source);
    await screen.findByRole("heading", { name: "Choose the repos to track" });
    fireEvent.click(screen.getByRole("checkbox", { name: "mentat" }));
    fireEvent.click(await screen.findByRole("button", { name: "Continue" }));

    await screen.findByRole("heading", { name: "Repos enabled" });
    expect(calls.at(-1)).toBe(`initRepos:[{"repos":${JSON.stringify([DASHERO, KUBERA, MENTAT])}}]`);
    // Home's list is told from inside the tab as well as by the daemon's `repos.changed` (#94).
    expect(announced).toHaveBeenCalledTimes(1);
    window.removeEventListener(REPOS_CHANGED_EVENT, announced);
    const results = screen.getByRole("list", { name: "Init results" });
    expect(within(results).getByText(".claude/settings.json")).toBeDefined();
    expect(within(results).getByText(FIXTURE_TRUST_STEP)).toBeDefined();
    expect(within(results).getByRole("alert").textContent).toBe("git identity is empty");
    expect(screen.getByText(/2 repos enabled; 1 repo could not be/)).toBeDefined();

    // Next carries only the repos that were enabled.
    fireEvent.click(screen.getByRole("button", { name: "Next: choose history" }));
    await waitFor(() => expect(state().step).toBe("history"));
    expect(state().repos).toEqual([DASHERO, KUBERA]);
  });
});

describe("workspaces on the projects step (amendment 8)", () => {
  const SHOPIFY = FIXTURE_WORKSPACE.repos[0]!;
  const label = `dome_workspace: install hooks here so sessions started from this folder are recorded in the repos they touch`;

  it("offers a start folder only once one of its repos is selected, pre-checked, and sends it to init", async () => {
    const { source, calls } = stubSource();
    renderWizard(source);
    await screen.findByRole("heading", { name: "Choose the repos to track" });
    expect(screen.queryByRole("group", { name: "Sessions were also started from these folders" })).toBeNull();

    fireEvent.click(screen.getByRole("checkbox", { name: "card-shopify_store" }));
    const group = await screen.findByRole("group", { name: "Sessions were also started from these folders" });
    const box = within(group).getByRole("checkbox", { name: label }) as HTMLInputElement;
    expect(box.checked).toBe(true);
    expect(within(group).getByText(FIXTURE_WORKSPACE.path)).toBeDefined();
    expect(within(group).getByText(/card-shopify_store, card-bart_schedules/)).toBeDefined();

    // Unticking it is remembered in the hash and leaves it out of the request.
    fireEvent.click(box);
    await waitFor(() => expect(state().workspaces).toEqual([]));
    expect((within(group).getByRole("checkbox", { name: label }) as HTMLInputElement).checked).toBe(false);
    fireEvent.click(within(group).getByRole("checkbox", { name: label }));
    await waitFor(() => expect(state().workspaces).toEqual([FIXTURE_WORKSPACE.path]));

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByRole("heading", { name: "Repos enabled" });
    expect(calls.at(-1)).toBe(`initRepos:[{"repos":${JSON.stringify([DASHERO, KUBERA, SHOPIFY])},"workspaces":${JSON.stringify([FIXTURE_WORKSPACE.path])}}]`);
    const results = screen.getByRole("list", { name: "Workspace results" });
    expect(within(results).getByText("dome_workspace")).toBeDefined();
    expect(within(results).getByText("hooks installed")).toBeDefined();
    expect(within(results).getByText(".claude/settings.json")).toBeDefined();
    // The workspace is not a repo: Next carries the repos only.
    fireEvent.click(screen.getByRole("button", { name: "Next: choose history" }));
    await waitFor(() => expect(state().step).toBe("history"));
    expect(state().repos).toEqual([DASHERO, KUBERA, SHOPIFY]);
  });

  it("shows a folder whose hooks are already installed ticked and locked, and sends nothing for it", async () => {
    const { source, calls } = stubSource({
      discover: async () => ({ ...FIXTURE_DISCOVER, workspaces: [{ ...FIXTURE_WORKSPACE, hooksInstalled: true }] }),
    });
    renderWizard(source);
    await screen.findByRole("heading", { name: "Choose the repos to track" });
    fireEvent.click(screen.getByRole("checkbox", { name: "card-shopify_store" }));
    const group = await screen.findByRole("group", { name: "Sessions were also started from these folders" });
    const box = within(group).getByRole("checkbox", { name: label }) as HTMLInputElement;
    expect(box.checked).toBe(true);
    expect(box.disabled).toBe(true);
    expect(within(group).getByText("hooks installed")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByRole("heading", { name: "Repos enabled" });
    expect(calls.at(-1)).toBe(`initRepos:[{"repos":${JSON.stringify([DASHERO, KUBERA, SHOPIFY])}}]`);
    expect(screen.queryByRole("list", { name: "Workspace results" })).toBeNull();
  });
});

describe("history step", () => {
  const AT_HISTORY = wizardHref({ ...INITIAL_STATE, step: "history", repos: [DASHERO, KUBERA] });

  it("resumes from the hash and shows five cards with counts and sizes", async () => {
    const { source, calls } = stubSource();
    renderWizard(source, AT_HISTORY);
    await screen.findByRole("heading", { name: "How much history to backfill" });
    expect(calls).toEqual([`history:[${JSON.stringify([DASHERO, KUBERA])}]`]);

    const group = screen.getByRole("group", { name: "Backfill window" });
    const cards = within(group).getAllByRole("button");
    expect(cards.map((card) => card.textContent)).toEqual([
      `Last 7 days${String(FIXTURE_HISTORY.windows["7d"].sessions)} sessions3.4 MB of transcripts`,
      `Last 30 days${String(FIXTURE_HISTORY.windows["30d"].sessions)} sessions11.8 MB of transcripts`,
      `Last 90 days${String(FIXTURE_HISTORY.windows["90d"].sessions)} sessions26.1 MB of transcripts`,
      `All history${String(FIXTURE_HISTORY.windows.all!.sessions)} sessions27.9 MB of transcripts`,
      "No backfillStart fresh — only sessions from now on are recorded.",
    ]);
  });

  it("All (amendment 9) sends since: all to plan and run; a daemon without it shows no All card", async () => {
    const { source, calls } = stubSource();
    renderWizard(source, AT_HISTORY);
    await screen.findByRole("heading", { name: "How much history to backfill" });
    fireEvent.click(screen.getByRole("button", { name: /All history/ }));
    await waitFor(() => expect(state().since).toBe("all"));
    await screen.findByRole("heading", { name: "How should past sessions be digested?" });
    fireEvent.click(screen.getByRole("button", { name: "Yes, replay my sessions" }));
    await screen.findByRole("heading", { name: "Resume in your harness" });
    expect(calls).toContain(`plan:[{"repos":${JSON.stringify([DASHERO, KUBERA])},"since":"all","method":"resume"}]`);
    fireEvent.click(screen.getByRole("button", { name: "Start backfill (27 sessions)" }));
    await waitFor(() =>
      expect(calls).toContain(`run:[{"repos":${JSON.stringify([DASHERO, KUBERA])},"since":"all","method":"resume","consent":true}]`),
    );
    cleanup();

    const older = stubSource({
      history: async () => ({ windows: { "7d": FIXTURE_HISTORY.windows["7d"], "30d": FIXTURE_HISTORY.windows["30d"], "90d": FIXTURE_HISTORY.windows["90d"] } } as never),
    });
    renderWizard(older.source, AT_HISTORY);
    await screen.findByRole("heading", { name: "How much history to backfill" });
    const group = screen.getByRole("group", { name: "Backfill window" });
    expect(within(group).getAllByRole("button")).toHaveLength(4);
    expect(within(group).queryByRole("button", { name: /All history/ })).toBeNull();
  });

  it("a window goes to the method step with a history entry; none goes straight to done", async () => {
    const { source } = stubSource();
    renderWizard(source, AT_HISTORY);
    await screen.findByRole("heading", { name: "How much history to backfill" });
    const before = window.history.length;
    fireEvent.click(screen.getByRole("button", { name: /Last 30 days/ }));
    await waitFor(() => expect(state().step).toBe("method"));
    expect(state().since).toBe("30d");
    expect(window.history.length).toBe(before + 1);
    await screen.findByRole("heading", { name: "How should past sessions be digested?" });

    // Back is the browser's: the history step is one entry behind.
    await act(async () => {
      window.history.back();
      await waitFor(() => expect(state().step).toBe("history"));
    });
    await screen.findByRole("heading", { name: "How much history to backfill" });

    fireEvent.click(screen.getByRole("button", { name: /No backfill/ }));
    await screen.findByRole("heading", { name: "Nothing was backfilled" });
    expect(screen.getByText("2 repos enabled; new sessions will be recorded from now on.")).toBeDefined();
    expect(readBackfillRun()).toBeNull();
  });
});

describe("method step", () => {
  const AT_METHOD = wizardHref({ ...INITIAL_STATE, step: "method", repos: [DASHERO, KUBERA], since: "30d" });

  it("asks the resume question first, and Yes plans a resume with sessions and time", async () => {
    const { source, calls } = stubSource({
      run: async () => ({ jobs: [job({ id: "j1" }), job({ id: "j2", repo_path: KUBERA })] }),
    });
    renderWizard(source, AT_METHOD);
    expect(await screen.findByText(RESUME_QUESTION)).toBeDefined();
    // The alternative is priced on the question itself.
    expect(
      await screen.findByText(
        "Otherwise workledger can summarize the transcripts with the Anthropic API: about 1,900,000 tokens, about $6.84, needs ANTHROPIC_API_KEY (not set on the daemon).",
      ),
    ).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Yes, replay my sessions" }));

    await screen.findByRole("heading", { name: "Resume in your harness" });
    expect(calls).toContain(`plan:[{"repos":${JSON.stringify([DASHERO, KUBERA])},"since":"30d","method":"resume"}]`);
    expect(screen.getByText("27")).toBeDefined();
    expect(screen.getByText("about 20m 15s")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Start backfill (27 sessions)" }));
    await waitFor(() => expect(state().step).toBe("running"));
    // The running step has already asked for status by now, so the run call is found, not last.
    expect(calls).toContain(
      `run:[{"repos":${JSON.stringify([DASHERO, KUBERA])},"since":"30d","method":"resume","consent":true}]`,
    );
    // The run is remembered for the progress split and the Home banner.
    expect(readBackfillRun()).toMatchObject({ repos: [DASHERO, KUBERA], jobIds: ["j1", "j2"], finished: null });
  });

  it("No shows the extraction estimate; without a key Run is disabled and explained, Skip backfills nothing", async () => {
    const { source, calls } = stubSource();
    renderWizard(source, AT_METHOD);
    fireEvent.click(await screen.findByRole("button", { name: "No, use the Anthropic API instead" }));

    await screen.findByRole("heading", { name: "Extract with an API key" });
    expect(calls.at(-1)).toBe(`plan:[{"repos":${JSON.stringify([DASHERO, KUBERA])},"since":"30d","method":"extract"}]`);
    expect(screen.getByText("1,900,000")).toBeDefined();
    expect(screen.getByText("$6.84")).toBeDefined();
    expect(screen.getByText("not set on the daemon")).toBeDefined();
    // Amendment 3: Codex sessions are priced out of extraction and said so.
    expect(screen.getByText("5 Codex sessions can only be backfilled by resume and will be skipped by extraction.")).toBeDefined();
    const run = screen.getByRole("button", { name: "Run extraction" }) as HTMLButtonElement;
    expect(run.disabled).toBe(true);
    expect(screen.getByText(/Run extraction is disabled because the daemon has no/)).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Skip backfill" }));
    await screen.findByRole("heading", { name: "Nothing was backfilled" });
    expect(state()).toMatchObject({ step: "done", method: "none" });
    expect(calls.some((call) => call.startsWith("run:"))).toBe(false);
  });

  it("with a key present Run extraction is enabled and consents", async () => {
    const { source, calls } = stubSource({
      plan: async () => ({ sessions: 4, estimate: { tokens: 120_000, usd: 0.42, needsApiKey: false } }),
      run: async () => ({ jobs: [job()] }),
    });
    renderWizard(source, wizardHref({ ...parseWizardHash(AT_METHOD), method: "extract" }));
    await screen.findByRole("heading", { name: "Extract with an API key" });
    expect(screen.getByText("set on the daemon")).toBeDefined();
    const run = screen.getByRole("button", { name: "Run extraction" }) as HTMLButtonElement;
    expect(run.disabled).toBe(false);
    fireEvent.click(run);
    await waitFor(() => expect(state().step).toBe("running"));
    expect(calls.find((call) => call.startsWith("run:"))).toContain('"method":"extract","consent":true');
  });

  it("a refused run stays on the step with the reason", async () => {
    const { source } = stubSource({
      plan: async () => ({ sessions: 4, estimate: { tokens: 1, usd: 0.01, needsApiKey: false } }),
      run: () => Promise.reject(Object.assign(new Error("no key"), { code: "api-key-required" })),
    });
    renderWizard(source, wizardHref({ ...parseWizardHash(AT_METHOD), method: "extract" }));
    fireEvent.click(await screen.findByRole("button", { name: "Run extraction" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      explainRunFailure(Object.assign(new Error("no key"), { code: "api-key-required" })),
    );
    expect(state().step).toBe("method");
  });

  it("nothing to backfill finishes without a run", async () => {
    const { source, calls } = stubSource({ plan: async () => ({ sessions: 0, estimate: { seconds: 0 } }) });
    renderWizard(source, wizardHref({ ...parseWizardHash(AT_METHOD), method: "resume" }));
    fireEvent.click(await screen.findByRole("button", { name: "Finish" }));
    await screen.findByRole("heading", { name: "Nothing was backfilled" });
    expect(calls.some((call) => call.startsWith("run:"))).toBe(false);
  });
});

describe("running step", () => {
  const AT_RUNNING = wizardHref({
    ...INITIAL_STATE,
    step: "running",
    repos: [DASHERO, KUBERA],
    since: "7d",
    method: "resume",
  });

  it("splits the run's jobs per repo, by id, with a fallback on repo and time", () => {
    const run = { repos: [DASHERO, KUBERA], jobIds: ["a", "b"], startedAt: "2026-09-09T09:00:00.000Z", finished: null };
    const jobs: JobAcrossRepos[] = [
      { ...job({ id: "a", status: "done" }), repo: FIXTURE_REPOS[0]! },
      { ...job({ id: "b", status: "failed", repo_path: KUBERA }), repo: FIXTURE_REPOS[1]! },
      { ...job({ id: "c", status: "done" }), repo: FIXTURE_REPOS[0]! },
    ];
    expect(progressByRepo(jobsOfRun(jobs, run), run)).toEqual([
      { path: DASHERO, done: 1, failed: 0, total: 1 },
      { path: KUBERA, done: 0, failed: 1, total: 1 },
    ]);
    const lost = { ...run, jobIds: [] };
    expect(jobsOfRun(jobs, lost).map((j) => j.id)).toEqual(["a", "b", "c"]);
    expect(jobsOfRun(jobs, { ...lost, startedAt: "2026-09-09T10:00:00.000Z" })).toEqual([]);
  });

  it("leads with the outcome in one line, shared with the banner", () => {
    expect(outcomeLine({ done: 3, failed: 0, total: 3 }, 2)).toBe("Backfilled 3 sessions across 2 repos");
    expect(outcomeLine({ done: 2, failed: 1, total: 3 }, 2)).toBe("Backfilled 2 of 3 sessions; 1 failed");
    expect(outcomeLine({ done: 0, failed: 2, total: 2 }, 2)).toBe("Nothing was backfilled");
    expect(outcomeLine({ done: 0, failed: 0, total: 0 }, 2)).toBe("Nothing was backfilled");
  });

  it("follows status on job.changed, shows progress per repo, and moves to done when complete", async () => {
    // Three repos in the run; mentat had no session in the window, so it queued nothing.
    startBackfillRun([DASHERO, KUBERA, MENTAT], [job({ id: "a" }), job({ id: "b", repo_path: KUBERA })]);
    let statuses: OnboardingStatus[] = [
      { total: 2, done: 0, failed: 0, running: 2, waiting: 0, retryAfter: null, complete: false },
      { total: 2, done: 1, failed: 1, running: 0, waiting: 0, retryAfter: null, complete: true },
    ];
    let jobs: JobAcrossRepos[] = [
      { ...job({ id: "a" }), repo: FIXTURE_REPOS[0]! },
      { ...job({ id: "b", repo_path: KUBERA }), repo: FIXTURE_REPOS[1]! },
    ];
    const { source, emit } = stubSource({
      status: async () => statuses.length > 1 ? statuses.shift()! : statuses[0]!,
      listAllJobs: async () => jobs,
    });
    renderWizard(source, AT_RUNNING);
    await screen.findByRole("heading", { name: "Backfilling" });
    expect((await screen.findByRole("status")).textContent).toBe("0 of 2 sessions finished · 2 still ahead");
    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("0");
    expect(bar.getAttribute("aria-valuemax")).toBe("2");
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    expect(rows.map((row) => row.textContent)).toEqual(["dashero001", "kubera001", "mentatno sessions in this window"]);
    // Leaving is a plain link, and there is no Continue: the step moves on by itself.
    expect(screen.getByRole("link", { name: "Go to home" }).getAttribute("href")).toBe("#/");
    expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();

    jobs = [
      { ...job({ id: "a", status: "done" }), repo: FIXTURE_REPOS[0]! },
      { ...job({ id: "b", status: "failed", repo_path: KUBERA }), repo: FIXTURE_REPOS[1]! },
    ];
    act(() => emit({ type: "job.changed", id: "a", status: "done", repo: "0123456789ab" }));

    await screen.findByRole("heading", { name: "Backfilled 1 of 2 sessions; 1 failed" });
    expect(state().step).toBe("done");
    expect(readBackfillRun()?.finished).toMatchObject({ done: 1, failed: 1, total: 2 });
    expect(screen.getByRole("alert").textContent).toContain("1 session could not be summarized.");
    expect(screen.getByRole("link", { name: "See the failed jobs" }).getAttribute("href")).toBe("#/jobs");
    expect(screen.getByRole("link", { name: "Go to home" }).getAttribute("href")).toBe("#/");
    statuses = [];
  });
});

describe("Home", () => {
  function machine(repos: Repo[]): AppSource {
    const { source } = stubSource({ listRepos: async () => repos });
    return source;
  }

  it("redirects to the wizard when the daemon serves no repo", async () => {
    window.location.hash = "#/";
    render(<App source={machine([])} />);
    await waitFor(() => expect(window.location.hash).toBe(ONBOARDING_HREF));
    await screen.findByRole("heading", { name: "Choose the repos to track" });
  });

  it("stays on Home when repos exist", async () => {
    window.location.hash = "#/";
    render(<App source={machine(FIXTURE_REPOS)} />);
    await screen.findByRole("list", { name: "Projects" });
    expect(window.location.hash).toBe("#/");
  });

  it("announces a finished backfill once and is dismissible", async () => {
    window.localStorage.setItem(
      BACKFILL_RUN_KEY,
      JSON.stringify({
        repos: [DASHERO, KUBERA],
        jobIds: ["a", "b", "c"],
        startedAt: "2026-09-09T09:00:00.000Z",
        finished: { done: 3, failed: 0, total: 3, at: "2026-09-09T09:05:00.000Z" },
      }),
    );
    window.location.hash = "#/";
    render(<App source={machine(FIXTURE_REPOS)} />);
    const banner = await screen.findByRole("status");
    expect(banner.textContent).toContain("Backfilled 3 sessions across 2 repos.");
    fireEvent.click(within(banner).getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(screen.queryByText(/Backfill finished/)).toBeNull());
    expect(window.localStorage.getItem(BACKFILL_RUN_KEY)).toBeNull();
  });

  it("watches a run left behind and announces it when the daemon says complete", async () => {
    startBackfillRun([DASHERO], [job({ id: "a" })]);
    const statuses: OnboardingStatus[] = [
      { total: 1, done: 0, failed: 0, running: 1, waiting: 0, retryAfter: null, complete: false },
      { total: 1, done: 1, failed: 0, running: 0, waiting: 0, retryAfter: null, complete: true },
    ];
    const { source } = stubSource({ status: async () => statuses.length > 1 ? statuses.shift()! : statuses[0]! });
    render(
      <MachineProvider source={source}>
        <BackfillBanner pollMs={10} />
      </MachineProvider>,
    );
    expect(screen.queryByRole("status")).toBeNull();
    expect((await screen.findByRole("status")).textContent).toContain("Backfilled 1 session across 1 repo.");
  });

  it("says what failed, in a warning tone, with the way to Jobs", async () => {
    window.localStorage.setItem(
      BACKFILL_RUN_KEY,
      JSON.stringify({
        repos: [DASHERO, KUBERA],
        jobIds: ["a", "b", "c"],
        startedAt: "2026-09-09T09:00:00.000Z",
        finished: { done: 2, failed: 1, total: 3, at: "2026-09-09T09:05:00.000Z" },
      }),
    );
    render(
      <MachineProvider source={stubSource().source}>
        <BackfillBanner />
      </MachineProvider>,
    );
    const banner = await screen.findByRole("status");
    expect(banner.textContent).toBe("Backfilled 2 of 3 sessions; 1 failed — see Jobs.Dismiss");
    expect(banner.className).toContain("bg-warning");
    expect(within(banner).getByRole("link", { name: "see Jobs" }).getAttribute("href")).toBe("#/jobs");
  });
});

describe("usage-window waits in the wizard (#100)", () => {
  const RESET = new Date(Date.now() + 60 * 60_000).toISOString();
  const SENTENCE = `Waiting for your Claude usage window to reset at ${formatLocalTime(RESET, Date.now())}`;

  it("the running step counts a held job as waiting, not failed, and names the reset", async () => {
    startBackfillRun([DASHERO], [job({ id: "a" }), job({ id: "b" })]);
    const { source } = stubSource({
      status: async () => ({ total: 2, done: 1, failed: 0, running: 0, waiting: 1, retryAfter: RESET, complete: false }),
      listAllJobs: async () => [
        { ...job({ id: "a", status: "done" }), repo: FIXTURE_REPOS[0]! },
        { ...job({ id: "b", error_code: "harness-usage-limit", retry_after: RESET }), repo: FIXTURE_REPOS[0]! },
      ],
    });
    renderWizard(
      source,
      wizardHref({ ...INITIAL_STATE, step: "running", repos: [DASHERO], since: "7d", method: "resume" }),
    );
    await screen.findByRole("heading", { name: "Backfilling" });
    expect((await screen.findByRole("status")).textContent).toBe("1 of 2 sessions finished · 1 waiting");
    expect(screen.getByText(SENTENCE, { exact: false })).toBeTruthy();
    // Not complete: the step stays.
    expect(screen.getByRole("heading", { name: "Backfilling" })).toBeTruthy();
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    expect(rows.map((row) => row.textContent)).toEqual(["dashero102"]);
  });

  it("the done step says the same and does not call the held job a failure", async () => {
    const { source } = stubSource({
      status: async () => ({ total: 2, done: 1, failed: 0, running: 0, waiting: 1, retryAfter: RESET, complete: false }),
    });
    renderWizard(
      source,
      wizardHref({ ...INITIAL_STATE, step: "done", repos: [DASHERO], since: "7d", method: "resume" }),
    );
    await screen.findByRole("heading", { name: "Backfilled 1 session across 1 repo" });
    expect(screen.getByRole("status").textContent).toBe(`1 session waiting. ${SENTENCE}; Home announces the finish.`);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("the method step says replay spends subscription usage and may pause", async () => {
    const { source } = stubSource();
    renderWizard(
      source,
      wizardHref({ ...INITIAL_STATE, step: "method", repos: [DASHERO], since: "7d", method: "resume" }),
    );
    await screen.findByRole("heading", { name: "Resume in your harness" });
    expect(
      screen.getByText("Replay uses your Claude/Codex subscription usage; a large backfill may pause until your usage window resets.", { exact: false }),
    ).toBeTruthy();
  });
});
