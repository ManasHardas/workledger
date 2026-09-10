/**
 * `/api/onboarding/*` — docs/contracts/p8/daemon-and-api.md §Onboarding endpoints.
 *
 * Same division of labour as `./jobs.ts`: this file validates the query or body, calls the
 * injected op (`../onboarding.ts`) and maps its refusals onto the contract's statuses. It never
 * touches a harness store or a repo itself.
 *
 * Self-contained on purpose: one `app.route("/api", onboardingRoutes(…))` line is all `app.ts`
 * needs, so the machine-mode rewrite of that file lands beside this one with a one-line merge.
 * The routes are machine-wide by nature — the wizard runs before any repo is enabled — so none of
 * them takes the `repo` parameter the per-repo routes gain in machine mode.
 */
import { Hono } from "hono";

import { ApiError, badRequest, toApiError } from "../errors.js";
import {
  ONBOARDING_METHODS,
  ONBOARDING_WINDOWS,
  REFUSAL_STATUS,
  isOnboardingRefusal,
  repoPathProblem,
  rootPathProblem,
} from "../onboarding.js";
import { readBody, readBoolean, rejectUnknown } from "./body.js";
import type { MiddlewareHandler } from "hono";
import type { OnboardingMethod, OnboardingOps, OnboardingWindow, PlanInput, RunInput } from "../onboarding.js";

/** What the onboarding routes need from `createApp`. */
export interface OnboardingRouteDeps {
  ops: OnboardingOps;
  /**
   * Called with every repo `init` just enabled, so a running machine-mode server can start
   * serving it without a restart. Absent in a build whose server has no repo registry.
   */
  onEnabled?: ((path: string) => void) | undefined;
}

/** A `?key=a,b` list: split on commas, trimmed, empties dropped; `undefined` when absent. */
function readCsv(raw: string | undefined): string[] | undefined {
  if (raw === undefined) return undefined;
  const items = raw
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "");
  return items.length === 0 ? undefined : items;
}

/**
 * A non-empty array of repo paths, each one a real git repository.
 *
 * Checked at the route as well as in the op, because the two guard different callers: the op
 * protects `workledger onboard`, this protects the loopback listener from a body that names a
 * directory `init` would otherwise scaffold hook files into.
 *
 * `allowEmpty` is `init` with workspaces named (amendment 12): Home's "Install hooks" enables a
 * folder whose repos are already tracked, so there is no repo to list.
 */
function readRepos(body: Record<string, unknown>, allowEmpty = false): string[] {
  const value = body["repos"];
  if (!Array.isArray(value) || (value.length === 0 && !allowEmpty)) {
    throw badRequest("repos must be a non-empty array of paths");
  }
  for (const item of value) {
    if (typeof item !== "string" || item.trim() === "") {
      throw badRequest("repos must hold non-empty strings");
    }
    const problem = repoPathProblem(item);
    if (problem !== undefined) throw new ApiError(400, "invalid-repo", problem);
  }
  return value as string[];
}

/** `?roots=` entries, each an absolute existing directory. */
function readRoots(raw: string | undefined): string[] | undefined {
  const roots = readCsv(raw);
  for (const root of roots ?? []) {
    const problem = rootPathProblem(root);
    if (problem !== undefined) throw new ApiError(400, "invalid-root", problem);
  }
  return roots;
}

/** `Origin`'s host, or `undefined` for an absent or unparseable header. */
function originHost(origin: string | undefined): string | undefined {
  if (origin === undefined) return undefined;
  try {
    return new URL(origin).host;
  } catch {
    return "";
  }
}

/**
 * The write guard for `/api/onboarding/*`.
 *
 * The listener binds loopback, which keeps the network out but not the browser: any page the
 * operator has open can `fetch("http://127.0.0.1:7419/api/onboarding/init", { method: "POST" })`
 * and, without this, enable repos on their machine. Two checks close that. A request that
 * carries an `Origin` must carry the server's own — the host the request was addressed to — and
 * a body must declare itself JSON, which a cross-site HTML form cannot. No `Origin` at all is
 * `curl`, the CLI, or a same-origin navigation, and is allowed.
 */
export const onboardingWriteGuard: MiddlewareHandler = async (c, next) => {
  const origin = originHost(c.req.header("origin"));
  if (origin !== undefined && origin !== c.req.header("host")) {
    throw new ApiError(403, "forbidden-origin", "cross-origin requests to /api/onboarding are refused");
  }
  const type = c.req.header("content-type") ?? "";
  if (!/^application\/json(?:\s*;|$)/i.test(type.trim())) {
    throw new ApiError(415, "content-type-required", "POST /api/onboarding/* needs content-type: application/json");
  }
  await next();
};

/** An optional array of absolute workspace folders; the op refuses one that is a repo or holds none. */
function readWorkspaces(body: Record<string, unknown>): string[] | undefined {
  const value = body["workspaces"];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim() === "")) {
    throw badRequest("workspaces must be an array of paths");
  }
  for (const item of value as string[]) {
    const problem = rootPathProblem(item);
    if (problem !== undefined) throw new ApiError(400, "invalid-root", problem);
  }
  return value as string[];
}

/** An optional array of harness names. */
function readHarnesses(body: Record<string, unknown>): string[] | undefined {
  const value = body["harnesses"];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim() === "")) {
    throw badRequest("harnesses must be an array of harness names");
  }
  return value as string[];
}

/** One of a closed set of strings. */
function readChoice<T extends string>(
  body: Record<string, unknown>,
  field: string,
  allowed: readonly T[],
): T {
  const value = body[field];
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw badRequest(`${field} must be one of ${allowed.join(", ")}`);
  }
  return value as T;
}

/** The three fields `plan` and `run` share. */
function readPlan(body: Record<string, unknown>): PlanInput {
  return {
    repos: readRepos(body),
    since: readChoice<OnboardingWindow>(body, "since", ONBOARDING_WINDOWS),
    method: readChoice<OnboardingMethod>(body, "method", ONBOARDING_METHODS),
  };
}

/** Call an op, mapping its refusal onto the contract's status. */
async function call<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (isOnboardingRefusal(error)) throw new ApiError(REFUSAL_STATUS[error.code], error.code, error.message);
    throw toApiError(error);
  }
}

/** `/api/onboarding/{discover,history,init,plan,run,status}`. */
export function onboardingRoutes(deps: OnboardingRouteDeps): Hono {
  const api = new Hono();
  api.on("POST", "/onboarding/*", onboardingWriteGuard);

  api.get("/onboarding/discover", async (c) => {
    const roots = readRoots(c.req.query("roots"));
    return c.json(await call(() => deps.ops.discover(roots)));
  });

  api.get("/onboarding/history", async (c) => {
    const repos = readCsv(c.req.query("repos"));
    if (repos === undefined) throw badRequest("repos is required: a comma-separated list of paths");
    for (const repo of repos) {
      const problem = repoPathProblem(repo);
      if (problem !== undefined) throw new ApiError(400, "invalid-repo", problem);
    }
    return c.json(await call(() => deps.ops.history(repos)));
  });

  api.post("/onboarding/init", async (c) => {
    const body = await readBody(c);
    rejectUnknown(body, ["repos", "harnesses", "workspaces"]);
    const workspaces = readWorkspaces(body);
    const repos = readRepos(body, workspaces !== undefined && workspaces.length > 0);
    const harnesses = readHarnesses(body);
    const result = await call(() =>
      deps.ops.init({
        repos,
        ...(harnesses === undefined ? {} : { harnesses }),
        ...(workspaces === undefined ? {} : { workspaces }),
      }),
    );
    if (deps.onEnabled !== undefined) {
      for (const entry of result.results) if (entry.ok) deps.onEnabled(entry.path);
    }
    return c.json(result);
  });

  api.post("/onboarding/plan", async (c) => {
    const body = await readBody(c);
    rejectUnknown(body, ["repos", "since", "method"]);
    return c.json(await call(() => deps.ops.plan(readPlan(body))));
  });

  api.post("/onboarding/run", async (c) => {
    const body = await readBody(c);
    rejectUnknown(body, ["repos", "since", "method", "consent"]);
    const input: RunInput = { ...readPlan(body), consent: readBoolean(body, "consent", false) };
    // Refused here as well as in the op: the op's refusal is what protects a caller that is not
    // this server, and the route's is what keeps a body with `consent: false` from being sent
    // anywhere near a queue at all.
    if (!input.consent) {
      throw new ApiError(
        409,
        "consent-required",
        "the backfill spends the harness subscription or an API key; retry with consent: true",
      );
    }
    return c.json(await call(() => deps.ops.run(input)), 202);
  });

  api.get("/onboarding/status", async (c) => c.json(await call(() => deps.ops.status())));

  // Amendment 12: Home's "Folders with sessions". Machine-wide like the rest, and a read, so the
  // write guard above does not apply; loopback-only like every route.
  api.get("/workspaces", async (c) => c.json(await call(() => deps.ops.workspaces())));

  return api;
}
