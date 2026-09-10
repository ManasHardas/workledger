/**
 * Request-body reading shared by the POST route files.
 *
 * Validation lives at the route rather than in the injected op because the two callers of an op
 * disagree about what a bad argument *is*: commander rejects `--rank foo` before the op ever sees
 * it, so the op takes a `number` and an HTTP caller can hand it a string. Everything rejected
 * here is therefore api.md's 400 — a body of the wrong shape — while everything the op rejects
 * carries its own class (404 for an unknown id, 409 for an illegal transition).
 */
import { badRequest } from "../errors.js";
import type { Context } from "hono";

/** A JSON object body, or `{}` when the request carried no body at all. */
export async function readBody(c: Context): Promise<Record<string, unknown>> {
  let raw: string;
  try {
    raw = await c.req.text();
  } catch (error) {
    throw badRequest(`unreadable request body: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (raw.trim() === "") return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw badRequest(`body is not JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw badRequest("body must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

/** An integer field of the body, rejecting the string form an HTML form would send. */
export function readInteger(body: Record<string, unknown>, field: string, min?: number): number {
  const value = body[field];
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw badRequest(`${field} must be an integer`);
  }
  if (min !== undefined && value < min) throw badRequest(`${field} must be >= ${min}`);
  return value;
}

/** A non-empty string field of the body. */
export function readString(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw badRequest(`${field} must be a non-empty string`);
  }
  return value;
}

/**
 * A boolean field of the body, defaulting when it is absent.
 *
 * Only a real `true` or `false` is accepted: `consent` decides whether money is spent, and a
 * truthy `"false"` string is the exact class of mistake that must not read as agreement.
 */
export function readBoolean(body: Record<string, unknown>, field: string, fallback: boolean): boolean {
  const value = body[field];
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw badRequest(`${field} must be true or false`);
  return value;
}

/** Reject any field the route does not know, so a typo is a 400 rather than a silent no-op. */
export function rejectUnknown(body: Record<string, unknown>, known: readonly string[]): void {
  const extra = Object.keys(body).filter((key) => !known.includes(key));
  if (extra.length > 0) {
    throw badRequest(`unknown field(s) ${extra.join(", ")}: expected ${known.join(", ")}`);
  }
}
