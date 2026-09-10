/**
 * The two failures a caller has to tell apart: the server said no, and the source cannot do this
 * at all.
 */

/** api.md's one error body: `{ "error": { "code": string, "message": string } }`. */
export interface ErrorBody {
  error: { code: string; message: string };
}

/**
 * Everything this client rejects with, carrying the server's `code` verbatim so a view can switch
 * on `not_found` / `bad_request` / `conflict` without reading English.
 */
export class ApiClientError extends Error {
  readonly code: string;
  /** The HTTP status, absent when the failure happened before or instead of a response. */
  readonly status: number | undefined;

  constructor(code: string, message: string, status?: number) {
    super(message);
    this.name = "ApiClientError";
    this.code = code;
    this.status = status;
  }
}

/** The code every write carries on a source whose `capabilities.write` is false (ledger-source.md). */
export const READ_ONLY = "read-only";

/**
 * The rejection a read-only source gives.
 *
 * The contract says writes "reject with `{ code: "read-only" }`", and a caller that checks
 * `error.code === "read-only"` must keep working, so the code is the load-bearing part; it is an
 * `ApiClientError` rather than a bare object literal so that an unhandled rejection still prints
 * a stack and a message.
 */
export function readOnlyRejection(method: string): ApiClientError {
  return new ApiClientError(READ_ONLY, `${method} is not available on a read-only source`);
}
