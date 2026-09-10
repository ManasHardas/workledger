/**
 * Reading a `LedgerSource` rejection without knowing which source threw it.
 *
 * `LocalServerSource` rejects with `ApiClientError` — the server's `code` verbatim, plus whatever
 * rode beside `error` in the body (`detail`). The fixture source rejects with a bare
 * `{ code: "read-only" }`. A view has to branch on the code (`consent-required` opens a consent
 * dialog, `transcript_missing` is a state and not a failure) without caring which of the two it
 * got, so the three readers below are structural and never `instanceof`.
 */

/** The human-readable half of any rejection. */
export function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "code" in error) {
    return String((error as { code: unknown }).code);
  }
  return String(error);
}

/** The contract's `error.code`, or `undefined` for a rejection that carries none. */
export function codeOf(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

/** Whatever the error body carried beside `error` — P3's `consent-required` puts `estimate` here. */
export function detailOf(error: unknown): Record<string, unknown> | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const detail = (error as { detail?: unknown }).detail;
  if (typeof detail !== "object" || detail === null) return undefined;
  return detail as Record<string, unknown>;
}
