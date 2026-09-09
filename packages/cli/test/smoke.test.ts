import { describe, expect, it, vi } from "vitest";

import { SCHEMA_VERSION } from "@workledger/core";

import { createProgram, EXIT_OK, EXIT_USAGE, run, VERSION } from "../src/main.js";

describe("workledger cli", () => {
  it("names the program after the binary", () => {
    expect(createProgram().name()).toBe("workledger");
  });

  it("reports the version from packages/cli/package.json", () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
    expect(createProgram().version()).toBe(VERSION);
  });

  it("resolves @workledger/core from source", () => {
    expect(SCHEMA_VERSION).toBe(1);
  });

  it("returns 0 for --version without exiting the process", async () => {
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    try {
      await expect(run(["--version"])).resolves.toBe(EXIT_OK);
    } finally {
      stdout.mockRestore();
    }
  });

  it("returns 0 for --help without exiting the process", async () => {
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    try {
      await expect(run(["--help"])).resolves.toBe(EXIT_OK);
    } finally {
      stdout.mockRestore();
    }
  });

  it("returns 1 for an unknown option without exiting the process", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    try {
      await expect(run(["--bogus"])).resolves.toBe(EXIT_USAGE);
    } finally {
      stderr.mockRestore();
    }
  });
});
