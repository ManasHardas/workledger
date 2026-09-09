import { describe, expect, it } from "vitest";
import { z } from "zod";

import { DoneItemObject, Verified } from "@workledger/core";

import { readRepoFile, renderContracts, writeContracts } from "../export-json-schema.js";
import { additionalPropertiesOf, pick, requiredOf } from "../json-schema-fragments.js";

/**
 * `docs/contracts/p1/*.schema.json` is frozen. This suite runs the exporter in memory (no
 * writes) and asserts each rendered artifact equals the committed file byte for byte — the
 * guard that makes `packages/core/src/schema.ts` the single source for the P1 contracts.
 *
 * It lives under `scripts/` rather than `packages/core/test/` because reading the frozen files
 * needs `node:fs`, and `packages/core` stays free of Node built-ins.
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

  it("writeContracts rewrites nothing while the frozen files are current", () => {
    expect(writeContracts()).toEqual([]);
  });

  it.each(rendered)("$path is valid JSON that round trips", ({ contents }) => {
    const parsed = JSON.parse(contents) as Record<string, unknown>;
    expect(parsed["$schema"]).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(typeof parsed["$id"]).toBe("string");
    expect(typeof parsed["title"]).toBe("string");
  });
});

/**
 * The composition helpers are what make the frozen files unreproducible when zod disagrees.
 * Each case builds a *drifted* schema in memory — `packages/core/src/schema.ts` is never
 * edited — and asserts the exporter refuses it rather than emitting a contract that lies.
 */
describe("the exporter rejects a drifted schema", () => {
  it("requiredOf throws when a required property becomes optional", () => {
    const drifted = DoneItemObject.extend({ verified: Verified.optional() });
    expect(() => requiredOf(drifted, ["text", "verified"], "DoneItem")).toThrow(
      /required mismatch — zod requires \[text\], fragment expects \[text, verified\]/,
    );
    // Control: the real schema still agrees.
    expect(requiredOf(DoneItemObject, ["text", "verified"], "DoneItem")).toEqual([
      "text",
      "verified",
    ]);
  });

  it("requiredOf throws when the order of required properties changes", () => {
    const drifted = z.object({ b: z.string(), a: z.string() }).strict();
    expect(() => requiredOf(drifted, ["a", "b"], "Drifted")).toThrow(/required mismatch/);
  });

  it("additionalPropertiesOf throws when a strict object is loosened", () => {
    const drifted = z.object({ text: z.string() }).loose();
    expect(() => additionalPropertiesOf(drifted, false, "DoneItem")).toThrow(
      /additionalProperties mismatch — zod says true, fragment expects false/,
    );
    expect(additionalPropertiesOf(DoneItemObject, false, "DoneItem")).toBe(false);
  });

  it("additionalPropertiesOf throws when a loose object is tightened", () => {
    const drifted = z.object({ text: z.string() }).strict();
    expect(() => additionalPropertiesOf(drifted, true, "SessionFrontmatter")).toThrow(
      /additionalProperties mismatch/,
    );
  });

  it("pick throws when zod stops emitting a keyword", () => {
    expect(() => pick({ type: "string" }, ["type", "maxLength"], "goal")).toThrow(
      /key mismatch — zod produced \[type\], fragment expects \[maxLength, type\]/,
    );
  });
});
