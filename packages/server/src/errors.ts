/**
 * The one error shape api.md gives: `{ "error": { "code": string, "message": string } }`, with
 * 400 for bad input, 404 for an unknown id, 409 for a state conflict and 500 for the rest.
 */
import { HTTPException } from "hono/http-exception";
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
