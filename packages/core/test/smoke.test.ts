import { describe, expect, it } from "vitest";

import { SCHEMA_VERSION, schemaVersionSchema } from "../src/index.js";

describe("@workledger/core", () => {
  it("exports the ledger schema version", () => {
    expect(SCHEMA_VERSION).toBe(1);
  });

  it("validates the schema version through zod", () => {
    expect(schemaVersionSchema.parse(SCHEMA_VERSION)).toBe(SCHEMA_VERSION);
    expect(schemaVersionSchema.safeParse(2).success).toBe(false);
  });
});
