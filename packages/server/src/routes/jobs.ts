/**
 * The P3 half of the write surface — docs/contracts/p3/api.md's six job routes and the excerpt
 * route.
 *
 * Same division of labour as `./write.ts`: this file validates the body, calls the injected op
 * (`../jobs.ts`), and maps the op's refusal onto the contract's status. It never opens the index
 * and never touches a transcript path it was not handed one for.
 *
 * ## Consent
 *
 * Two routes can spend money, and they refuse in opposite directions on purpose.
 *
 * `repair` with `extract: true` and no consent is a **409 `consent-required`**: the caller asked
 * for the extraction, so answering with a silent resume-only repair would do something other than
 * what was asked. The estimate rides along in the error body, which is what the UI needs to put a
 * number in front of the operator before it asks again with `consent: true`.
 *
 * `backfill` with `consent: false` is a **200 with an empty `jobs` list**: that is not a refusal
 * at all, it is `--dry-run` (cli.md §backfill step 3), and the estimate *is* the answer. The 202
 * is reserved for the call that actually queued work.
 */
import { Hono } from "hono";
import type { Context } from "hono";

import { ApiError, badRequest, notFound, toApiError } from "../errors.js";
import { buildExcerpt } from "../excerpt.js";
import { readBody, readBoolean, readInteger, readString, rejectUnknown } from "./body.js";
import type { BackfillInput, Job, JobOps } from "../jobs.js";
import type { RepoContext } from "../repos.js";

/** What the job routes need from `createApp`. */
export interface JobRouteDeps {
  ops: JobOps;
  /** The repo whose jobs and sessions are addressed (P8: `?repo=<id>`); every route is scoped to it. */
  repo: (c: Context) => RepoContext;
  /** `~/.workledger` — where the excerpt cache lives. Never inside the repo. */
  home: string;
}

/** The lifecycle states `?status=` may name (cli.md §Jobs). */
const STATUSES: readonly string[] = ["queued", "running", "done", "failed", "cancelled"];

/** `--since 7d|14d|30d|all` (cli.md §backfill). Any whole number of days is accepted. */
const SINCE = /^(?:all|[1-9]\d*d)$/;

/**
 * `?cp=<n>` — a 1-based checkpoint number.
 *
 * Parsed here rather than trusted, because it indexes into a byte range: `cp=0` would ask for the
 * span before the first checkpoint, which is not a checkpoint, and a non-integer would reach the
 * op as a `NaN` that no row can match.
 */
function readCp(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") throw badRequest("cp is required");
  const cp = Number(raw);
  if (!Number.isInteger(cp) || cp < 1) throw badRequest("cp must be an integer >= 1");
  return cp;
}

/** `POST /api/jobs/backfill`'s body. */
function readBackfill(body: Record<string, unknown>): BackfillInput {
  rejectUnknown(body, ["since", "concurrency", "extractFallback", "consent"]);
  const since = body["since"] === undefined ? "14d" : readString(body, "since");
  if (!SINCE.test(since)) throw badRequest("since must be `all` or a day count like `14d`");
  const input: BackfillInput = { since, consent: readBoolean(body, "consent", false) };
  if (body["concurrency"] !== undefined) input.concurrency = readInteger(body, "concurrency", 1);
  if (body["extractFallback"] !== undefined) {
    input.extractFallback = readBoolean(body, "extractFallback", false);
  }
  return input;
}

/** `POST /api/jobs/:id/{cancel,retry}` and the rest, with the op's refusal mapped to a status. */
async function call<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw toApiError(error);
  }
}

/**
 * 501 for a route whose op has not been injected.
 *
 * `backfill` (#56) and `estimateExtract` (#54) land beside this file rather than before it, and a
 * server that answered them with a 500 or an empty success would be lying about which of the two
 * happened. 501 says exactly the true thing: the route exists, this build cannot serve it.
 */
function notImplemented(what: string): ApiError {
  return new ApiError(501, "not_implemented", `${what} is not available in this build`);
}

/** `/api/jobs/*` and `/api/sessions/:ulid/excerpt`. */
export function jobRoutes(deps: JobRouteDeps): Hono {
  const api = new Hono();

  api.get("/jobs", async (c) => {
    const repoRoot = deps.repo(c).root;
    const status = c.req.query("status");
    if (status !== undefined && !STATUSES.includes(status)) {
      throw badRequest(`status must be one of ${STATUSES.join(", ")}`);
    }
    const jobs = await call(() =>
      status === undefined ? deps.ops.listJobs(repoRoot) : deps.ops.listJobs(repoRoot, status),
    );
    return c.json(jobs);
  });

  api.post("/jobs/scan", async (c) => {
    const repoRoot = deps.repo(c).root;
    return c.json(await call(() => deps.ops.scan(repoRoot)));
  });

  api.post("/jobs/repair", async (c) => {
    const repoRoot = deps.repo(c).root;
    const body = await readBody(c);
    rejectUnknown(body, ["session", "extract", "consent"]);
    const session = readString(body, "session");
    const extract = readBoolean(body, "extract", false);
    const consent = readBoolean(body, "consent", false);

    if (extract && !consent) {
      // The estimate is best-effort: the consent rule is not conditional on being able to price
      // it, so a build without `estimateExtract` still refuses — just without the number.
      const estimate =
        deps.ops.estimateExtract === undefined
          ? undefined
          : await call(() => (deps.ops.estimateExtract as NonNullable<JobOps["estimateExtract"]>)(repoRoot, session));
      return c.json(
        {
          error: {
            code: "consent-required",
            message: `extracting session ${session} spends tokens; retry with consent: true`,
          },
          ...(estimate === undefined ? {} : { estimate }),
        },
        409,
      );
    }

    const job = await call(() => deps.ops.repair(repoRoot, { session, extract, consent }));
    return c.json(job, 202);
  });

  api.post("/jobs/backfill", async (c) => {
    const repoRoot = deps.repo(c).root;
    const input = readBackfill(await readBody(c));
    const backfill = deps.ops.backfill;
    if (backfill === undefined) throw notImplemented("backfill");
    const result = await call(() => backfill(repoRoot, input));
    // 200 for the dry estimate, 202 for the call that queued something (api.md).
    return c.json(result, input.consent ? 202 : 200);
  });

  const ACTIONS: Record<string, (ops: JobOps, id: string, repoRoot: string) => Promise<Job>> = {
    cancel: (ops, id, repoRoot) => ops.cancelJob(repoRoot, id),
    retry: (ops, id, repoRoot) => ops.retryJob(repoRoot, id),
  };
  for (const [name, run] of Object.entries(ACTIONS)) {
    api.post(`/jobs/:id/${name}`, async (c) => {
      const repoRoot = deps.repo(c).root;
      const id = c.req.param("id");
      return c.json(await call(() => run(deps.ops, id, repoRoot)));
    });
  }

  api.get("/sessions/:ulid/excerpt", async (c) => {
    const repoRoot = deps.repo(c).root;
    const ulid = c.req.param("ulid");
    const cp = readCp(c.req.query("cp"));
    const span = await call(() => deps.ops.excerptSpan(repoRoot, ulid, cp));
    if (span === undefined) throw notFound("checkpoint", `${ulid}#${String(cp)}`);

    const excerpt = buildExcerpt(deps.home, ulid, cp, span);
    if (excerpt === undefined) {
      // data-flow §Excerpts: "If the transcript is gone, 404 and the UI shows 'transcript no
      // longer on this machine'". The path is not echoed back — it is a path on someone's
      // machine, and the UI's message does not need it.
      throw new ApiError(
        404,
        "transcript_missing",
        `the transcript for session ${ulid} is no longer on this machine`,
      );
    }
    return c.json(excerpt);
  });

  return api;
}
