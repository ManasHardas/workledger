/**
 * The one outbound network call workledger makes — the Anthropic Messages API, by `fetch`
 * (docs/contracts/p3/cli.md §`workledger repair` step 4).
 *
 * Raw HTTP rather than `@anthropic-ai/sdk`: this is a local-first CLI whose `hook Stop` path has a
 * 100 ms budget, and a dependency that exists for one optional fallback command would be carried
 * by every install and every bundle. One POST with three headers is the whole surface used.
 *
 * ## The key
 *
 * `ANTHROPIC_API_KEY` is read from the environment per request and put in a header. It is never
 * written to the index, the ledger, a job row, a log line, or an error message — everything that
 * leaves this module goes through {@link redactSecrets} first, and the request body is never
 * echoed. That is the property `packages/cli/test/extract.test.ts` asserts by searching every
 * artifact a run produces for the key it was given.
 */

/** The Messages endpoint. Overridable so a test can point at a local stub. */
export const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

/** The API version header every request must carry. */
export const ANTHROPIC_VERSION = "2023-06-01";

/** The environment variable the key is read from, and the only place it is read from. */
export const API_KEY_ENV = "ANTHROPIC_API_KEY";

/**
 * Output ceiling for one extraction call.
 *
 * A `CheckpointPayload` is capped at 16384 bytes by the P1 contract (`MAX_PAYLOAD_BYTES`), so a
 * response that needs more than this is already over the limit `checkpoint` would reject; 16384
 * output tokens is comfortably above the cap and is the figure the cost estimate prices in.
 */
export const MAX_OUTPUT_TOKENS = 16384;

/**
 * The system prompt. Fixed, and versioned in the same spirit as `src/instruction.ts`: it is the
 * interface between workledger and a model, so a change to the wording changes what lands in a
 * ledger and should be visible in the diff that caused it.
 */
export const EXTRACT_SYSTEM_PROMPT = [
  "You are reconstructing a workledger checkpoint digest from a coding session's transcript.",
  "",
  "Reply with a single JSON object and nothing else — no prose, no markdown fence. The object is",
  "a CheckpointPayload:",
  "",
  '{"goal": string, "done": [...], "remaining": [...], "notes": [...]}',
  "",
  "goal: what the human asked for, in the human's terms, at most 400 characters.",
  'done[]: {"text": past tense, one unit of work, <=300 chars,',
  '         "files": [repo-relative paths touched, at most 20],',
  '         "commit": optional 7-40 character lowercase git hash,',
  '         "verified": "tests-passed" | "tests-failed" | "not-verified"}.',
  "         Every done item needs evidence: a non-empty files list or a commit hash. Omit any",
  "         item you cannot evidence from the transcript rather than inventing a path.",
  'remaining[]: {"text": imperative next action <=300 chars, "why": <=300 chars, "new": true}.',
  '             Use "new": true for every item; do not invent backlog ids.',
  'notes[]: {"type": "discovery" | "decision" | "blocker" | "question", "text": <=500 chars}.',
  '         A "decision" note also needs "by": "human" | "agent" and "reason": <=300 chars.',
  "",
  "At most 20 items per section, and the whole object must be under 16384 bytes.",
  "Describe only what the transcript shows. Never include credentials, tokens, API keys or",
  "passwords in any field, even if they appear in the transcript.",
].join("\n");

/** What {@link callMessages} needs. */
export interface MessagesRequest {
  model: string;
  system: string;
  /** The user turn: a chunk of filtered transcript, with its instructions. */
  user: string;
  apiKey: string;
  maxTokens?: number;
  /** Injected so a test can drive the whole path without a network. */
  fetchImpl?: typeof globalThis.fetch;
  url?: string;
}

/** A call that did not produce usable text. Its message is safe to print. */
export class ExtractApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtractApiError";
  }
}

/** How much of an error body is quoted back. Enough to identify the failure, not to dump it. */
const MAX_ERROR_BODY = 400;

/**
 * Replace anything shaped like an Anthropic key with a marker.
 *
 * Defence in depth. Nothing this module composes contains the key by construction — it goes into
 * a header, and headers are not echoed — but error bodies come from a server this code does not
 * own and end up in a job's `error` column, which is on disk. A pattern match costs nothing and
 * makes "the key is never persisted" a property of the code rather than of a careful reading.
 */
export function redactSecrets(text: string): string {
  return text.replace(/sk-ant-[A-Za-z0-9_-]{8,}/g, "<redacted:anthropic-api-key>");
}

/** The text blocks of a Messages response, concatenated. */
function textOf(body: unknown): string {
  if (body === null || typeof body !== "object") return "";
  const content = (body as Record<string, unknown>)["content"];
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      if (block === null || typeof block !== "object") return "";
      const record = block as Record<string, unknown>;
      return record["type"] === "text" && typeof record["text"] === "string" ? record["text"] : "";
    })
    .join("");
}

/**
 * One `POST /v1/messages`.
 *
 * No retry loop, by contract ("a failure exits 5 with the errors, no retry loop"): extraction is
 * a paid operation an operator consented to once, and a CLI that silently spent the estimate
 * three times would have made that consent meaningless.
 *
 * @returns the assistant's text.
 * @throws {ExtractApiError} for a transport failure, a non-2xx status, or a response with no text.
 */
export async function callMessages(request: MessagesRequest): Promise<string> {
  const doFetch = request.fetchImpl ?? globalThis.fetch;
  if (typeof doFetch !== "function") {
    throw new ExtractApiError("this Node build has no global fetch; extraction needs Node 18+");
  }

  let response: Response;
  try {
    response = await doFetch(request.url ?? ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "anthropic-version": ANTHROPIC_VERSION,
        // The only place the key appears. Not logged, not stored, not echoed.
        "x-api-key": request.apiKey,
      },
      body: JSON.stringify({
        model: request.model,
        max_tokens: request.maxTokens ?? MAX_OUTPUT_TOKENS,
        system: request.system,
        messages: [{ role: "user", content: request.user }],
      }),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ExtractApiError(`the Anthropic API could not be reached (${redactSecrets(detail)})`);
  }

  const raw = await response.text().catch(() => "");
  if (!response.ok) {
    const body = redactSecrets(raw).slice(0, MAX_ERROR_BODY);
    throw new ExtractApiError(
      `the Anthropic API returned ${response.status}${body === "" ? "" : `: ${body}`}`,
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(raw) as unknown;
  } catch {
    throw new ExtractApiError("the Anthropic API returned a body that is not JSON");
  }

  const text = textOf(body);
  if (text.trim() === "") throw new ExtractApiError("the Anthropic API returned no text content");
  return text;
}

/**
 * The JSON object inside a model reply.
 *
 * The system prompt asks for a bare object, and a model that follows it needs none of this. The
 * fence-and-preamble strip is here because the alternative to tolerating them is exiting 5 on a
 * reply whose payload was perfectly good, and the validation that follows is what actually
 * decides whether the content is acceptable.
 */
export function extractJson(text: string): string {
  const trimmed = text.trim();
  const fenced = /```(?:json)?\s*\n([\s\S]*?)\n?```/.exec(trimmed);
  const candidate = (fenced?.[1] ?? trimmed).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return candidate;
  return candidate.slice(start, end + 1);
}
