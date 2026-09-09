import { describe, expect, it } from "vitest";

import { CHARS_PER_TOKEN, estimateTokens } from "../src/index.js";

describe("estimateTokens", () => {
  it("is ceil(chars / 4), the estimate data-flow §5 freezes", () => {
    expect(CHARS_PER_TOKEN).toBe(4);
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("a")).toBe(1);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
    expect(estimateTokens("abcdefgh")).toBe(2);
    expect(estimateTokens("x".repeat(8000))).toBe(2000);
  });

  it("rounds every partial token up, never down", () => {
    for (let length = 0; length <= 64; length += 1) {
      const estimate = estimateTokens("x".repeat(length));
      expect(estimate).toBe(Math.ceil(length / CHARS_PER_TOKEN));
      expect(estimate * CHARS_PER_TOKEN).toBeGreaterThanOrEqual(length);
    }
  });

  it("counts UTF-16 code units, so an astral character counts as two", () => {
    // Documented behaviour, not an accident: it over-counts by one character per emoji, which
    // keeps the function allocation-free and stays well inside the documented margin.
    expect("🙂").toHaveLength(2);
    expect(estimateTokens("🙂🙂")).toBe(1);
    expect(estimateTokens("🙂".repeat(4))).toBe(2);
  });

  it("is monotonic in length", () => {
    let previous = 0;
    for (let length = 0; length <= 200; length += 1) {
      const estimate = estimateTokens("y".repeat(length));
      expect(estimate).toBeGreaterThanOrEqual(previous);
      previous = estimate;
    }
  });
});
