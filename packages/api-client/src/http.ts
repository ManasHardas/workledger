/**
 * The isomorphic HTTP layer: enough of `fetch` to talk to `docs/contracts/p2/api.md`, and nothing
 * else.
 *
 * This package runs in a browser (`apps/web`), under Node (its own tests, and any script that
 * wants the client), and one day inside a Dome card. So it imports no Node built-in — the lint
 * fence in `eslint.config.js` enforces that the same way it does for `packages/core` — and it
 * reaches the platform only through the two globals every one of those runtimes has.
 *
 * The structural `FetchLike` / `HttpResponse` types below exist because this package compiles with
 * `"types": []` and `lib: ES2022`: neither `@types/node` nor `lib.dom` is in scope, so `fetch` is
 * not declared. Declaring the shape the client actually uses is better than pulling in either one,
 * which would also mean silently permitting `document` or `process`. It is also what lets a test
 * inject a stub without constructing a real `Response`.
 */
import type { ErrorBody } from "./errors.js";

import { ApiClientError } from "./errors.js";

/** The subset of `Response` this client reads. A real `Response` satisfies it. */
export interface HttpResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

/** The request shape this client sends. A real `RequestInit` accepts it. */
export interface HttpRequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

/** The subset of `fetch` this client calls. The platform `fetch` satisfies it. */
export type FetchLike = (url: string, init?: HttpRequestInit) => Promise<HttpResponse>;

/** `globalThis.fetch`, or a throw naming the fix rather than `undefined is not a function`. */
export function globalFetch(): FetchLike {
  const found = (globalThis as { fetch?: FetchLike }).fetch;
  if (typeof found !== "function") {
    throw new ApiClientError(
      "no-fetch",
      "no global fetch in this runtime — pass one to createSource({ fetch })",
    );
  }
  // Unbound `fetch` throws "Illegal invocation" in a browser, so it is bound to its global here
  // rather than at every call site.
  return (url, init) => found.call(globalThis, url, init);
}

/** `?a=1&b=2`, or `""` when nothing is set. `undefined` and `null` values are dropped. */
export function queryString(params: Record<string, string | number | undefined>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  return parts.length === 0 ? "" : `?${parts.join("&")}`;
}

/** `http://host:port` with any trailing slash removed, so `${base}/api/x` is never `//api/x`. */
export function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  if (trimmed === "") throw new ApiClientError("bad-base-url", "baseUrl must not be empty");
  return trimmed.replace(/\/+$/, "");
}

/** `{ error: { code, message } }` if that is what the body is, else `undefined`. */
function readErrorBody(body: unknown): ErrorBody["error"] | undefined {
  if (body === null || typeof body !== "object") return undefined;
  const error = (body as { error?: unknown }).error;
  if (error === null || typeof error !== "object") return undefined;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (typeof code !== "string" || typeof message !== "string") return undefined;
  return { code, message };
}

/**
 * Turn a non-2xx response into the contract's error. api.md gives exactly one error body, so a
 * response that does not carry it is a proxy or a crash rather than the server, and gets a
 * synthetic `http-<status>` code instead of being reported as a parse failure.
 */
export async function toApiError(url: string, response: HttpResponse): Promise<ApiClientError> {
  let parsed: ErrorBody["error"] | undefined;
  try {
    parsed = readErrorBody(await response.json());
  } catch {
    parsed = undefined;
  }
  if (parsed !== undefined) {
    return new ApiClientError(parsed.code, parsed.message, response.status);
  }
  return new ApiClientError(
    `http-${response.status}`,
    `${url} responded ${response.status}`,
    response.status,
  );
}
