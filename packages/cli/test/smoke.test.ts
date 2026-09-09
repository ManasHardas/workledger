import { describe, expect, it } from "vitest";

import { createProgram, VERSION } from "../src/main.js";

describe("workledger cli", () => {
  it("names the program after the binary", () => {
    expect(createProgram().name()).toBe("workledger");
  });

  it("reports the version from packages/cli/package.json", () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
    expect(createProgram().version()).toBe(VERSION);
  });
});
