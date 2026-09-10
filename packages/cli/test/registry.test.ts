/**
 * The T-X command registry: every P1 command is registered in `src/main.ts` with its final
 * signature from docs/contracts/p1/cli.md, so slots 8–10 replace one file under `src/commands/`
 * each without editing `main.ts`. These tests pin the surface that guarantee rests on.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { createProgram, EXIT_OK, EXIT_USAGE, run } from "../src/main.js";

/**
 * The commands `--help` must list: `open`, `stop` and `onboard` from P8
 * (docs/contracts/p8/daemon-and-api.md §CLI — `open` is also what a bare `workledger` runs), the
 * six from docs/contracts/p1/cli.md, `serve` (docs/contracts/p2/api.md) and `note` alongside the
 * now-live `backlog` (docs/contracts/p2/backlog-cli.md), and `scan`, `repair`, `backfill` and
 * `jobs` from P3 (docs/contracts/p3/cli.md).
 */
const COMMANDS = [
  "open",
  "stop",
  "init",
  "hook",
  "checkpoint",
  "brief",
  "doctor",
  "serve",
  "scan",
  "repair",
  "backfill",
  "jobs",
  "onboard",
  "backlog",
  "note",
];

/**
 * Every P1 command now has a body, so none of them can be invoked from here: each would read the
 * ledger, the index or stdin of whatever repo the suite runs in. Registration is asserted by
 * introspection instead, and the bodies are driven against temp repos in their own test files.
 */
const OPTIONS: Record<string, string[]> = {
  // `--no-browser`, like `serve`'s `--no-open`, defines `browser` defaulted to true.
  open: ["--port", "--no-browser"],
  stop: [],
  // `--harness` on both: `init` writes that harness's hook file, `hook` reads that harness's
  // wire format (docs/contracts/p4/hooks-codex.md, hooks-cursor.md).
  init: ["--repo", "--yes", "--no-backfill", "--teammate", "--harness"],
  hook: ["--harness"],
  checkpoint: ["--session", "--dry-run"],
  brief: ["--repo", "--max-tokens"],
  doctor: ["--json"],
  // `--no-open` is one option in commander's model: it defines `open`, defaulted to true.
  serve: ["--repo", "--port", "--no-open"],
  scan: ["--repo", "--all", "--json"],
  repair: ["--extract", "--yes", "--timeout", "--force"],
  backfill: ["--repo", "--since", "--concurrency", "--dry-run", "--yes", "--extract-fallback"],
  jobs: ["--repo", "--json", "--cancel", "--retry"],
  onboard: ["--json", "--roots", "--select", "--since", "--method", "--yes"],
  // `backlog` and `note` parse their own sub-commands and flags in `src/commands/`, so nothing
  // is registered here beyond the pass-through argument.
  backlog: [],
  note: [],
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
  it("registers exactly the fifteen commands", () => {
    expect(createProgram().commands.map((c) => c.name())).toEqual(COMMANDS);
  });

  it("lists every command in --help", async () => {
    const { code, out } = await invoke(["--help"]);

    expect(code).toBe(EXIT_OK);
    for (const name of COMMANDS) expect(out).toContain(name);
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

  it("passes backlog and note flags through instead of parsing them", () => {
    // The T-X guarantee for P2: the sub-command tables live in `src/commands/`, so `main.ts`
    // must claim neither the operands nor the flags. `test/backlog-ops.test.ts` drives the
    // bodies against a temp ledger.
    for (const name of ["backlog", "note"]) {
      const command = createProgram().commands.find((entry) => entry.name() === name);
      expect(command?.registeredArguments.map((argument) => argument.name()), name)
        .toEqual(["args"]);
      expect(command?.registeredArguments[0]?.variadic, name).toBe(true);
    }
  });

  it("returns 1 for an unknown backlog action", async () => {
    const { code, err } = await invoke(["backlog", "frobnicate"]);

    expect(code).toBe(EXIT_USAGE);
    expect(err).toContain("unknown command");
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
