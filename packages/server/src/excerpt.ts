/**
 * `GET /api/sessions/:ulid/excerpt?cp=<n>` — plans/feature-p3-data-flow.md §Excerpts.
 *
 * "reads bytes `[offset(n-1), offset(n))` from the transcript (path from the index), parses
 * records, renders user/assistant turns, counts tool calls, and caches the rendering under
 * `~/.workledger/cache/<ulid>/cp-<n>.json`."
 *
 * Three rules make this the only transcript reader in the product that is allowed to exist:
 *
 * 1. **Only the span is read.** A `read()` of `to - from` bytes at `from`, never the whole file —
 *    a session's transcript is routinely tens of megabytes and the budget is 300 ms for a 2 MB
 *    span. The first and last lines of that window are usually torn; a record that does not parse
 *    is dropped rather than repaired, because a half record is by definition not a whole turn.
 * 2. **Tool traffic is counted, not returned** (api.md). A `tool_use` input can hold a file the
 *    user never meant to publish and a `tool_result` can hold its contents; the number of them is
 *    what a reader needs to understand the shape of a turn, and the number is all that leaves
 *    this function.
 * 3. **Nothing is written under the repo.** The cache lives beside the index in
 *    `~/.workledger/`, which CLAUDE.md already marks as disposable ("the ledger is files; the
 *    index is a cache … transcript excerpts never enter the repo").
 */
import { closeSync, mkdirSync, openSync, readSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { ExcerptSpan } from "./jobs.js";

/** One rendered turn — api.md: `{ role, text, tools }`. */
export interface Turn {
  role: "user" | "assistant";
  /** The turn's prose. Thinking blocks and tool payloads are not in it. */
  text: string;
  /** How many tool calls and tool results this turn carried. */
  tools: number;
}

/** The excerpt response body. */
export interface Excerpt {
  cp: number;
  /** `[offset(n-1), offset(n))` — the span that was read, so a stale cache is detectable. */
  offset: [number, number];
  turns: Turn[];
}

/** A transcript record, as much of one as this module cares about. */
interface Record_ {
  type?: unknown;
  message?: { role?: unknown; content?: unknown } | undefined;
}

/** The text and tool count of one record's content, whatever shape the harness wrote it in. */
function renderContent(content: unknown): { text: string; tools: number } {
  // Claude Code writes a bare string for a plain user prompt and a block list for everything
  // else; both shapes appear in the same file.
  if (typeof content === "string") return { text: content.trim(), tools: 0 };
  if (!Array.isArray(content)) return { text: "", tools: 0 };

  const parts: string[] = [];
  let tools = 0;
  for (const block of content) {
    if (block === null || typeof block !== "object") continue;
    const type = (block as { type?: unknown }).type;
    if (type === "text") {
      const text = (block as { text?: unknown }).text;
      if (typeof text === "string" && text.trim() !== "") parts.push(text.trim());
    } else if (type === "tool_use" || type === "tool_result") {
      // Rule 2: the payload is never read, only tallied.
      tools += 1;
    }
    // `thinking` and anything else is dropped: it is not what the turn said.
  }
  return { text: parts.join("\n\n"), tools };
}

/**
 * Render the `user` / `assistant` records of a JSONL span into turns.
 *
 * A record whose content is nothing but tool traffic is not a turn — it is the machinery of the
 * turn before it — so its count is folded into that turn rather than emitted as an empty one.
 * That is the "tool noise collapsed" of #55: an eight-tool edit loop reads as one assistant turn
 * saying what it did, with `tools: 8`, instead of nine blank rows. A span that opens on such a
 * record has no previous turn to fold into, so the count is carried to the first real one.
 *
 * @param chunk the raw bytes of the span, decoded as UTF-8.
 */
export function renderTurns(chunk: string): Turn[] {
  const turns: Turn[] = [];
  let carried = 0;

  for (const line of chunk.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    let record: Record_;
    try {
      record = JSON.parse(trimmed) as Record_;
    } catch {
      // A torn first or last line of the window, or a record this build does not understand.
      continue;
    }
    if (record.type !== "user" && record.type !== "assistant") continue;
    const message = record.message;
    if (message === null || typeof message !== "object") continue;

    const { text, tools } = renderContent(message.content);
    if (text === "") {
      const previous = turns[turns.length - 1];
      if (previous === undefined) carried += tools;
      else previous.tools += tools;
      continue;
    }
    turns.push({ role: record.type, text, tools: tools + carried });
    carried = 0;
  }

  return turns;
}

/** `~/.workledger/cache/<ulid>/cp-<n>.json` — the contract's path, verbatim. */
export function excerptCachePath(home: string, ulid: string, cp: number): string {
  return path.join(home, "cache", ulid, `cp-${String(cp)}.json`);
}

/**
 * A previously rendered excerpt, if one is on disk *for this exact span*.
 *
 * The span is part of what is compared because a checkpoint's offsets can move: an index rebuild
 * re-derives them, and a cache keyed only by `(ulid, cp)` would then answer with somebody else's
 * bytes. Any unreadable or unrecognisable file is a miss, never an error — this is a cache.
 */
export function readCachedExcerpt(file: string, span: ExcerptSpan, cp: number): Excerpt | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
  if (parsed === null || typeof parsed !== "object") return undefined;
  const candidate = parsed as Partial<Excerpt>;
  const offset = candidate.offset;
  if (candidate.cp !== cp || !Array.isArray(offset) || offset.length !== 2) return undefined;
  if (offset[0] !== span.from || offset[1] !== span.to) return undefined;
  if (!Array.isArray(candidate.turns)) return undefined;
  return { cp, offset: [span.from, span.to], turns: candidate.turns };
}

/** Write the rendering to the cache. A cache that cannot be written is not an error. */
export function writeCachedExcerpt(file: string, excerpt: Excerpt): void {
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(excerpt)}\n`, "utf8");
  } catch {
    // Read-only home, a full disk, a race with a concurrent render — the excerpt is already
    // computed and the response does not depend on it landing.
  }
}

/**
 * Read the span out of the transcript.
 *
 * @returns `undefined` when the file is gone — data-flow §Excerpts: "If the transcript is gone,
 * 404 and the UI shows 'transcript no longer on this machine'". A directory, an unreadable file
 * and a path that was never written are all the same answer, because they are the same fact.
 */
export function readSpan(span: ExcerptSpan): string | undefined {
  let size: number;
  try {
    const stat = statSync(span.transcriptPath);
    if (!stat.isFile()) return undefined;
    size = stat.size;
  } catch {
    return undefined;
  }

  // The file may have been truncated (or the offsets may predate a rebuild) since the checkpoint
  // was recorded, so the window is clamped rather than trusted.
  const from = Math.max(0, Math.min(span.from, size));
  const to = Math.max(from, Math.min(span.to, size));
  if (to === from) return "";

  const buffer = Buffer.allocUnsafe(to - from);
  let fd: number;
  try {
    fd = openSync(span.transcriptPath, "r");
  } catch {
    return undefined;
  }
  try {
    let read = 0;
    while (read < buffer.length) {
      const n = readSync(fd, buffer, read, buffer.length - read, from + read);
      if (n === 0) break;
      read += n;
    }
    return buffer.subarray(0, read).toString("utf8");
  } catch {
    return undefined;
  } finally {
    closeSync(fd);
  }
}

/**
 * The whole endpoint body: cache lookup, span read, render, cache write.
 *
 * @param home `~/.workledger` — the cache root, which is never inside the repo.
 * @returns `undefined` when the transcript is no longer on this machine.
 */
export function buildExcerpt(
  home: string,
  ulid: string,
  cp: number,
  span: ExcerptSpan,
): Excerpt | undefined {
  const file = excerptCachePath(home, ulid, cp);
  const cached = readCachedExcerpt(file, span, cp);
  // A cache hit is still gated on the transcript existing: the UI's "no longer on this machine"
  // is a fact about the machine now, not about the last time the excerpt was rendered.
  if (cached !== undefined) {
    return readSpan(span) === undefined ? undefined : cached;
  }

  const chunk = readSpan(span);
  if (chunk === undefined) return undefined;

  const excerpt: Excerpt = { cp, offset: [span.from, span.to], turns: renderTurns(chunk) };
  writeCachedExcerpt(file, excerpt);
  return excerpt;
}
