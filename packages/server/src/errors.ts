/**
 * The one error shape api.md gives: `{ "error": { "code": string, "message": string } }`, with
 * 400 for bad input, 404 for an unknown id, 409 for a state conflict and 500 for the rest.
 */
import { HTTPException } from "hono/http-exception";

import { isOpError, opErrorDetails } from "./ops.js";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/** The body every non-2xx response carries. */
export interface ErrorBody {
  error: { code: string; message: string };
}

/** An error with a contract status and a machine-readable code. */
export class ApiError extends HTTPException {
  readonly code: string;

  constructor(status: ContentfulStatusCode, code: string, message: string) {
    super(status, { message });
    this.code = code;
  }
}

/** 404 — an id that is not in the ledger. */
export function notFound(what: string, id: string): ApiError {
  return new ApiError(404, "not_found", `no ${what} ${id}`);
}

/** 400 — a query or body the contract does not allow. */
export function badRequest(message: string): ApiError {
  return new ApiError(400, "bad_request", message);
}

/** The body for any thrown value, so `onError` has exactly one path. */
export function errorBody(error: unknown): { status: ContentfulStatusCode; body: ErrorBody } {
  if (error instanceof ApiError) {
    return { status: error.status, body: { error: { code: error.code, message: error.message } } };
  }
  if (error instanceof HTTPException) {
    return {
      status: error.status,
      body: { error: { code: error.status === 404 ? "not_found" : "bad_request", message: error.message } },
    };
  }
  return {
    status: 500,
    body: {
      error: { code: "internal", message: error instanceof Error ? error.message : String(error) },
    },
  };
}

/**
 * Turn an injected op's refusal into the contract's status, for the two route files that call
 * into `packages/cli` (`./ops.ts`, `./jobs.ts`).
 *
 * `not-enabled` joins 404: `workledger serve` refuses a repo with no ledger with exit 4 before it
 * binds, so a running server sees this only when `.workledger/` was deleted underneath it, and
 * "the thing you named is not there" is the honest answer either way. Anything that is not an
 * `OpError` is returned untouched, so a real bug still reaches `onError` as a 500.
 */
export function toApiError(error: unknown): unknown {
  if (!isOpError(error)) return error;
  const details = opErrorDetails(error);
  const message = details.length === 0 ? error.message : `${error.message} (${details.join("; ")})`;
  switch (error.code) {
    case "not-found":
    case "not-enabled":
      return new ApiError(404, "not_found", message);
    case "conflict":
      return new ApiError(409, "conflict", message);
    default:
      return new ApiError(400, "bad_request", message);
  }
}
