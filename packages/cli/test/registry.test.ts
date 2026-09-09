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
 * Every P1 command now has a body, so none of them can be invoked from here: each would read the
 * ledger, the index or stdin of whatever repo the suite runs in. Registration is asserted by
 * introspection instead, and the bodies are driven against temp repos in their own test files.
 */
const OPTIONS: Record<string, string[]> = {
  init: ["--repo", "--yes", "--no-backfill"],
  hook: [],
  checkpoint: ["--session", "--dry-run"],
  brief: ["--repo", "--max-tokens"],
  doctor: ["--json"],
  backlog: [],
};

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

  it("backlog exits 1 with the P2 message", async () => {
    const { code, err, out } = await invoke(["backlog", "accept", "WL-x"]);

    expect(code).toBe(EXIT_USAGE);
    expect(err).toContain(BACKLOG_MESSAGE);
    expect(out).toBe("");
  });

  it("carries the contracted options through to each command", () => {
    for (const command of createProgram().commands) {
      expect(command.options.map((option) => option.long), command.name())
        .toEqual(OPTIONS[command.name()]);
    }
  });

  it("rejects a --max-tokens value that is not a positive integer", async () => {
    for (const value of ["0", "-5", "1.5", "lots"]) {
      const { code, err } = await invoke(["brief", "--max-tokens", value]);
      expect(code, value).toBe(EXIT_USAGE);
      expect(err, value).toContain("positive integer");
    }
  });

  it("accepts only the three hook events", async () => {
    // By introspection: `hook` is implemented, so invoking it here would block on the worker's
    // stdin and touch the index. `packages/cli/test/hook.test.ts` drives the three events.
    const hook = createProgram().commands.find((command) => command.name() === "hook");
    expect(hook?.registeredArguments.map((argument) => argument.argChoices)).toEqual([
      ["SessionStart", "Stop", "SessionEnd"],
    ]);

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
