import { describe, expect, it } from "vitest";

import { readRepoFile, renderContracts } from "../../../scripts/export-json-schema.js";

/**
 * `docs/contracts/p1/*.schema.json` is frozen. This test runs the exporter in memory (no writes)
 * and asserts each rendered artifact equals the committed file byte for byte — the guard that
 * makes `packages/core/src/schema.ts` the single source for the P1 contracts.
 *
 * The filesystem read lives in `scripts/`, not in `packages/core`, which stays Node-free.
 */
describe("JSON Schema regeneration is a no-op", () => {
  const rendered = renderContracts();

  it("renders exactly the three frozen artifacts", () => {
    expect(rendered.map((contract) => contract.path)).toEqual([
      "docs/contracts/p1/checkpoint-payload.schema.json",
      "docs/contracts/p1/session-frontmatter.schema.json",
      "docs/contracts/p1/backlog-item.schema.json",
    ]);
  });

  it.each(rendered)("$path is byte-identical", ({ path, contents }) => {
    expect(contents).toBe(readRepoFile(path));
  });

  it.each(rendered)("$path is valid JSON that round trips", ({ contents }) => {
    const parsed = JSON.parse(contents) as Record<string, unknown>;
    expect(parsed["$schema"]).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(typeof parsed["$id"]).toBe("string");
    expect(typeof parsed["title"]).toBe("string");
  });
});
