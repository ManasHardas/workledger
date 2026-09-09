/**
 * Token estimation for the brief's `max_tokens` cap.
 *
 * The estimate is deliberately a division, not a tokenizer. A real BPE tokenizer means a
 * multi-megabyte vocabulary file, a Node-flavoured package, and a per-model answer that changes
 * under the caller's feet when the model changes — all three are things `packages/core` cannot
 * take on (CLAUDE.md: no Node built-ins, no filesystem). The cap it guards is a soft budget on
 * how much context the brief is allowed to spend, not a hard protocol limit, so an approximation
 * with a known margin is the right instrument.
 *
 * This module is pure: no imports at all.
 */

/**
 * Characters per token. Four is the long-standing rule of thumb for English prose under
 * GPT/Claude-family BPE vocabularies, and it is what data-flow §5 freezes the brief's estimate at.
 */
export const CHARS_PER_TOKEN = 4;

/**
 * Approximate the token count of `text` as `ceil(chars / 4)`.
 *
 * **Margin.** Treat the result as accurate to roughly ±25%, and biased *low* on the brief's own
 * content. English prose runs close to 4 characters per token, but the brief is denser than
 * prose: `WL-01JZZ...` ids, ISO dates, `·` separators and file paths tokenize at closer to 2-3
 * characters per token, so a brief made mostly of backlog ids can be ~30-50% more tokens than
 * this returns. Conversely long natural-language titles and note bodies run slightly *above* 4
 * characters per token, so the two errors partly cancel on a realistic ledger.
 *
 * The consequence for callers: `config.brief.max_tokens` (default 2,000) should be read as a
 * budget with slack behind it, not as a limit that must never be crossed in real tokens. Nothing
 * downstream rejects a brief for being a few hundred tokens over — the cap exists to stop a
 * thousand-item backlog from eating the context window.
 *
 * Counted in UTF-16 code units, matching `String.prototype.length`. An astral character (an
 * emoji) is therefore counted as two characters; that over-counts by one character per emoji,
 * which is well inside the margin above and keeps the function a single pass with no allocation.
 *
 * @param text - The text to measure. The empty string is 0 tokens.
 * @returns A non-negative integer estimate.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}
