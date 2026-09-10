/**
 * The transcript slice the extraction fallback sends to the model —
 * plans/feature-p3-data-flow.md §Extraction fallback.
 *
 * This is the place in workledger that reads transcript *content* at length — the only other
 * reader is `memoryFilesInSpan` in `src/commands/hook.ts`, which takes `file_path` strings off
 * Write/Edit tool uses on the Stop block path and keeps nothing else. Everything else in the
 * product measures transcripts (mtime, size, byte offsets) and never opens them, because a
 * digest written by the session's own agent needs no parser and an excerpt renderer only needs
 * bytes. Extraction is the exception the contract carves out for a session no harness can resume,
 * and it is fenced accordingly: the slice starts at the last checkpoint's offset, only three
 * record kinds survive the filter, tool results are truncated, and the resulting text goes to the
 * API request and nowhere else — never to disk, never to the index, never to a log
 * (CLAUDE.md: "Transcript excerpts never enter the repo").
 */
import { closeSync, openSync, readSync } from "node:fs";

/** Tool results are the bulk of a transcript and the least of its meaning; 2 KB each is the cap. */
export const MAX_TOOL_RESULT_BYTES = 2048;

/** Chunk ceiling from the contract: "chunk at 100k tokens". */
export const MAX_CHUNK_TOKENS = 100_000;

/**
 * Characters per token, for estimates only.
 *
 * Four is the long-standing English rule of thumb. Nothing here needs to be exact: it feeds the
 * chunk boundary (where being wrong costs one extra chunk) and the USD estimate shown before the
 * consent prompt (where the number is a forecast an operator says yes or no to, and an honest
 * approximation beats a tokenizer dependency the CLI would then ship for one command).
 */
export const CHARS_PER_TOKEN = 4;

/** One kept record, already rendered to the line the model sees. */
export interface KeptRecord {
  kind: "user" | "assistant" | "tool-result";
  text: string;
}

/** Estimated tokens for a piece of text. See {@link CHARS_PER_TOKEN}. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Read `[from, to)` of a file as UTF-8.
 *
 * A positioned read rather than `readFileSync` plus `slice`: the span to extract is what has been
 * written since the last checkpoint, and a session that has run for hours can have hundreds of
 * megabytes before it. Reading only the span keeps the memory cost proportional to the work being
 * described rather than to the session's whole history.
 *
 * The `from` offset is a byte count, so it can land mid-codepoint after a truncated write; the
 * decoder replaces the partial sequence and {@link keptRecords} drops the partial first line with
 * it, which costs at most one record at the boundary.
 */
export function readSlice(file: string, from: number, to: number): string {
  const length = Math.max(0, to - from);
  if (length === 0) return "";
  const fd = openSync(file, "r");
  try {
    const buffer = Buffer.allocUnsafe(length);
    let read = 0;
    while (read < length) {
      const n = readSync(fd, buffer, read, length - read, from + read);
      if (n === 0) break;
      read += n;
    }
    return buffer.subarray(0, read).toString("utf8");
  } finally {
    closeSync(fd);
  }
}

/** Truncate to a byte budget, on a character boundary, with a marker when anything was cut. */
function truncate(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;
  const buffer = Buffer.from(text, "utf8").subarray(0, maxBytes);
  // `toString` replaces a partial sequence at the end; trimming the replacement character keeps
  // the marker meaning "cut here" rather than "cut here, and here is a broken glyph".
  return `${buffer.toString("utf8").replace(/�$/, "")}… (truncated)`;
}

/** The text of one content block, or `undefined` when the block carries none. */
function blockText(block: unknown): string | undefined {
  if (typeof block === "string") return block;
  if (block === null || typeof block !== "object") return undefined;
  const value = (block as Record<string, unknown>)["text"];
  return typeof value === "string" ? value : undefined;
}

/** The text of a `tool_result` block's `content`, which is a string or a list of text blocks. */
function toolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => blockText(block) ?? "")
    .filter((text) => text !== "")
    .join("\n");
}

/**
 * The records one JSONL record contributes, per the contract's filter: "keep user, assistant, and
 * tool-result records".
 *
 * A Claude Code transcript carries tool results inside `user` records, so one line can yield both
 * a user turn and several tool results. Everything else a transcript holds — `tool_use` inputs,
 * thinking blocks, system records, summaries, meta records — is dropped: none of it is work the
 * digest describes, and all of it is the part most likely to hold a pasted credential.
 */
export function recordsFrom(parsed: unknown): KeptRecord[] {
  if (parsed === null || typeof parsed !== "object") return [];
  const record = parsed as Record<string, unknown>;
  const type = record["type"];
  if (type !== "user" && type !== "assistant") return [];

  const message = record["message"];
  const content =
    message !== null && typeof message === "object"
      ? (message as Record<string, unknown>)["content"]
      : undefined;

  if (typeof content === "string") {
    return content.trim() === "" ? [] : [{ kind: type, text: content }];
  }
  if (!Array.isArray(content)) return [];

  const out: KeptRecord[] = [];
  const texts: string[] = [];
  for (const block of content) {
    const blockType =
      block !== null && typeof block === "object"
        ? (block as Record<string, unknown>)["type"]
        : undefined;
    if (blockType === "text") {
      const text = blockText(block);
      if (text !== undefined && text.trim() !== "") texts.push(text);
      continue;
    }
    if (blockType === "tool_result") {
      const text = toolResultText((block as Record<string, unknown>)["content"]);
      if (text.trim() !== "") {
        out.push({ kind: "tool-result", text: truncate(text, MAX_TOOL_RESULT_BYTES) });
      }
    }
    // `tool_use`, `thinking`, `image` and anything a future harness adds: dropped.
  }
  if (texts.length > 0) out.unshift({ kind: type, text: texts.join("\n") });
  return out;
}

/**
 * Parse a JSONL slice into the records the model is shown.
 *
 * A line that does not parse is skipped rather than thrown on: the slice starts at a byte offset,
 * so its first line is routinely a partial record, and a transcript format that grows a record
 * kind this build has never seen must not make extraction fail.
 */
export function keptRecords(slice: string): KeptRecord[] {
  const out: KeptRecord[] = [];
  for (const line of slice.split("\n")) {
    if (line.trim() === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch {
      continue;
    }
    out.push(...recordsFrom(parsed));
  }
  return out;
}

/** The line one kept record becomes in the prompt. */
export function renderRecord(record: KeptRecord): string {
  return `<${record.kind}>\n${record.text}\n</${record.kind}>`;
}

/**
 * Group rendered records into chunks of at most `maxTokens`.
 *
 * A single record larger than the budget is emitted as its own oversized chunk rather than split:
 * splitting a tool result mid-JSON produces a chunk that reads as corruption, and the cap that
 * matters — {@link MAX_TOOL_RESULT_BYTES} — has already run by the time anything gets here, so
 * the only records that can exceed it are genuinely one long turn.
 */
export function chunkRecords(
  records: readonly KeptRecord[],
  maxTokens: number = MAX_CHUNK_TOKENS,
): string[] {
  const chunks: string[] = [];
  let current: string[] = [];
  let tokens = 0;

  for (const record of records) {
    const rendered = renderRecord(record);
    const cost = estimateTokens(rendered);
    if (current.length > 0 && tokens + cost > maxTokens) {
      chunks.push(current.join("\n"));
      current = [];
      tokens = 0;
    }
    current.push(rendered);
    tokens += cost;
  }
  if (current.length > 0) chunks.push(current.join("\n"));
  return chunks;
}
