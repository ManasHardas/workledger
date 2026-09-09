/**
 * The T-X command registry: every P1 command is registered in `src/main.ts` with its final
 * signature from docs/contracts/p1/cli.md, so slots 8–10 replace one file under `src/commands/`
 * each without editing `main.ts`. These tests pin the surface that guarantee rests on.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { BACKLOG_MESSAGE } from "../src/commands/backlog.js";
import { createProgram, EXIT_OK, EXIT_USAGE, run } from "../src/main.js";

/** The six commands `--help` must list, per docs/contracts/p1/cli.md. */
const COMMANDS = ["init", "hook", "checkpoint", "brief", "doctor", "backlog"];

/**
 * Commands whose bodies slots 9–10 still replace. `backlog` is final in P1, and `checkpoint` was
 * built by slot 8 (#11) — running it from here would read stdin and write the ledger of whatever
 * repo the suite runs in, so its registration is asserted by introspection instead.
 */
const STUBS = ["init", "hook", "brief", "doctor"];

/** Run the program with stdout and stderr captured. */
async function invoke(argv: string[]): Promise<{ code: number; out: string; err: string }> {
  let out = "";
  let err = "";
  const stdout = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    out += String(chunk);
    return true;
  });
  const stderr = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    err += String(chunk);
    return true;
  });
  try {
    return { code: await run(argv), out, err };
  } finally {
    stdout.mockRestore();
    stderr.mockRestore();
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("command registry", () => {
  it("registers exactly the six P1 commands", () => {
    expect(createProgram().commands.map((c) => c.name())).toEqual(COMMANDS);
  });

  it("lists all six commands in --help", async () => {
    const { code, out } = await invoke(["--help"]);

    expect(code).toBe(EXIT_OK);
    for (const name of COMMANDS) expect(out).toContain(name);
  });

  it.each(STUBS)("%s exits 1 with 'not implemented'", async (name) => {
    const argv = name === "hook" ? [name, "Stop"] : [name];
    const { code, err, out } = await invoke(argv);

    expect(code).toBe(EXIT_USAGE);
    expect(err).toContain("not implemented");
    expect(err).toContain(`workledger ${name}`);
    expect(out).toBe("");
  });

  it("backlog exits 1 with the P2 message, not 'not implemented'", async () => {
    const { code, err, out } = await invoke(["backlog", "accept", "WL-x"]);

    expect(code).toBe(EXIT_USAGE);
    expect(err).toContain(BACKLOG_MESSAGE);
    expect(err).not.toContain("not implemented");
    expect(out).toBe("");
  });

  it("carries the contracted options through to each command", async () => {
    // A signature error would surface as commander's "unknown option" exit 1 with no body run,
    // so reaching the stub's message is what proves the option is registered.
    for (const argv of [
      ["init", "--repo", "/tmp/x", "--yes", "--no-backfill"],
      ["brief", "--repo", "/tmp/x", "--max-tokens", "500"],
      ["doctor", "--json"],
    ]) {
      const { code, err } = await invoke(argv);
      expect(err, argv.join(" ")).toContain("not implemented");
      expect(code, argv.join(" ")).toBe(EXIT_USAGE);
    }

    const checkpoint = createProgram().commands.find((command) => command.name() === "checkpoint");
    expect(checkpoint?.options.map((option) => option.long)).toEqual(["--session", "--dry-run"]);
  });

  it("rejects a --max-tokens value that is not a positive integer", async () => {
    for (const value of ["0", "-5", "1.5", "lots"]) {
      const { code, err } = await invoke(["brief", "--max-tokens", value]);
      expect(code, value).toBe(EXIT_USAGE);
      expect(err, value).toContain("positive integer");
    }
  });

  it("accepts only the three hook events", async () => {
    for (const event of ["SessionStart", "Stop", "SessionEnd"]) {
      const { err } = await invoke(["hook", event]);
      expect(err, event).toContain("not implemented");
    }

    const { code, err } = await invoke(["hook", "PreToolUse"]);
    expect(code).toBe(EXIT_USAGE);
    expect(err).toContain("Allowed choices are");
  });

  it("accepts only the reserved backlog actions", async () => {
    const { code, err } = await invoke(["backlog", "frobnicate"]);

    expect(code).toBe(EXIT_USAGE);
    expect(err).toContain("Allowed choices are");
    expect(err).not.toContain(BACKLOG_MESSAGE);
  });

  it("awaits an async command body and returns the code it resolves to", async () => {
    // The T-X guarantee is that slots 8-10 change only their own file. A body that has to await
    // — init's confirmation prompt, a stdin read — must therefore work without touching main.ts.
    vi.resetModules();
    vi.doMock("../src/commands/doctor.js", () => ({
      doctorCommand: async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return 42;
      },
    }));
    try {
      const fresh = await import("../src/main.js");
      await expect(fresh.run(["doctor"])).resolves.toBe(42);
    } finally {
      vi.doUnmock("../src/commands/doctor.js");
      vi.resetModules();
    }
  });

  it("returns 1 for an unknown command", async () => {
    const { code } = await invoke(["nope"]);

    expect(code).toBe(EXIT_USAGE);
  });
});
