/**
 * The hook's timing budget — docs/contracts/p1/hooks-claude-code.md §Timing budget and
 * plans/feature-p1-data-flow.md §6.
 *
 * Measured on the **built binary**, end to end, including Node startup: that is the number the
 * budget is written against, and it is the only number a Claude Code session actually
 * experiences. `hook.test.ts` drives the state machine in-process; this file never does.
 *
 * Node startup dominates — ~40 ms of the 100 ms allow budget on the reference machine — so the
 * budget is really a budget on *what the bundle evaluates before the command runs*. That is why
 * the allow path is asserted as a **ratio to a bare Node start measured in the same interleaved
 * loop** rather than as an absolute millisecond ceiling (`ALLOW_RATIO_MAX`, #135). The last two
 * tests assert that directly against `dist/main.js`, because a p95 that drifts from 70 ms to
 * 95 ms on a faster CI runner would still pass while having lost the property that keeps it
 * there: `@workledger/core` (~30 ms of zod plus `yaml`) and `better-sqlite3` (a native addon)
 * must both sit behind lazy boundaries, reached only by the paths that need them.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const BIN = path.join(REPO_ROOT, "packages", "cli", "bin", "workledger");
const BUNDLE = path.join(REPO_ROOT, "packages", "cli", "dist", "main.js");

/**
 * The allow-path budget. CI runners are shared and noisier than a laptop, so the contract's
 * 100 ms is asserted locally and a 150 ms ceiling in CI, with the measurement always reported
 * (the third budget comment on #12). These are *reported*, not asserted, on the allow path —
 * see `ALLOW_RATIO_MAX`.
 */
const ALLOW_BUDGET_MS = process.env["CI"] ? 150 : 100;
const START_BUDGET_MS = process.env["CI"] ? 450 : 300;
const END_BUDGET_MS = process.env["CI"] ? 300 : 200;

/**
 * What the allow path is actually promised to be: **cheap relative to starting Node at all**.
 *
 * An absolute millisecond ceiling cannot say that. It says "this machine was fast enough", and a
 * loaded GitHub runner is not — #135: three CI runs went red on `271.4 < 200` while the allow
 * path itself had not moved (p50 76.9 ms, p95 291 ms, max 522 ms — a tail spike, not a
 * regression). So the assertion is the ratio `allow p95 / bare-node-start p95`, and two things
 * make it hold under load where the absolute number does not:
 *
 * - **The two are interleaved in one loop** — one `node -e 0`, one hook, alternating — so a
 *   slow window inflates the numerator and the denominator together. The old code sampled the
 *   baseline in a second loop *after* the hook loop, which is why a spike during the hook loop
 *   showed up as pure overhead.
 * - **Three rounds, and the median ratio decides.** One round that catches a scheduler stall is
 *   outvoted rather than fatal.
 *
 * Measured (3 rounds × 40 interleaved pairs, median round):
 *
 * | where                                    | baseline p95 | allow p95 | ratio     |
 * | ---------------------------------------- | ------------ | --------- | --------- |
 * | laptop, idle                             | 24–42 ms     | 49–83 ms  | 1.96–2.09 |
 * | laptop, 16 parallel CPU-busy loops       | 40–44 ms     | 78–90 ms  | 1.96–2.09 |
 * | GitHub runner, healthy (3 green CI runs) | 21–24 ms     | 79–96 ms  | 3.7–4.2   |
 * | GitHub runner, the #135 red run          | 19.6 ms      | 291 ms    | 14.8      |
 * | laptop, allow path slowed by 50 ms       | 41 ms        | 130 ms    | 3.16      |
 *
 * The ratio barely moves across a 2× swing in absolute time — the load row is the same 1.96 as
 * the idle row — which is the property the absolute ceiling did not have. The runner sits
 * higher than the laptop because its IO is slower relative to its CPU, so the ceiling keeps the
 * CI/local split this file already used: **5 in CI** clears a healthy runner (4.2) by ~20% and
 * still fails a 50 ms regression there (~5.9, since the runner's baseline is ~22 ms), and
 * **3 locally** clears an idle or loaded laptop (2.09) by ~45% and fails the same 50 ms
 * regression at 3.16. Both directions were run, not reasoned about — see the PR for #135.
 */
const ALLOW_RATIO_MAX = process.env["CI"] ? 5 : 3;

/** Rounds, and interleaved `node -e 0`/hook pairs per round. The median round's ratio decides. */
const ALLOW_ROUNDS = 3;
const ALLOW_RUNS_PER_ROUND = 40;

/**
 * A loose sanity bound, not a budget: an allow path that takes two seconds is broken in a way no
 * ratio should be asked to describe (a lock, a network call, a full transcript read). It is
 * deliberately far above anything load can produce — the worst allow p95 ever seen on a runner
 * is 291 ms.
 */
const ALLOW_SANITY_MS = 2_000;

/** One interleaved round: alternating `node -e 0` and Stop-allow samples, p95 of each. */
interface Round {
  baselineP95: number;
  allowP50: number;
  allowP95: number;
  allowMax: number;
  ratio: number;
}

function allowRound(runs: number): Round {
  const baseline: number[] = [];
  const allow: number[] = [];
  for (let i = 0; i < runs; i += 1) {
    // Interleaved on purpose: both samples see the same machine.
    const t0 = process.hrtime.bigint();
    execFileSync(process.execPath, ["-e", "0"], { stdio: "ignore" });
    baseline.push(Number(process.hrtime.bigint() - t0) / 1e6);
    allow.push(runHook("Stop", { stop_hook_active: false }));
  }
  const base = stats(baseline);
  const hook = stats(allow);
  return {
    baselineP95: base.p95,
    allowP50: hook.p50,
    allowP95: hook.p95,
    allowMax: hook.max,
    ratio: Number((hook.p95 / base.p95).toFixed(2)),
  };
}

/** A temp repo whose thresholds are far out of reach, so every Stop takes the allow path. */
interface Bench {
  root: string;
  home: string;
  transcript: string;
}

let bench: Bench;

beforeAll(() => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "workledger-timing-"));
  const root = path.join(dir, "repo");
  const home = path.join(dir, "home");
  mkdirSync(path.join(root, ".workledger", "sessions"), { recursive: true });
  mkdirSync(path.join(root, ".workledger", "backlog"), { recursive: true });
  mkdirSync(home, { recursive: true });
  writeFileSync(
    path.join(root, ".workledger", "config.yaml"),
    [
      "schema_version: 1",
      "harnesses: [claude-code]",
      // Out of reach on purpose: this measures the allow path, and a block would both change
      // the work done and make `execFileSync` throw on exit 2.
      "thresholds: { bytes: 1000000000, minutes: 1000000, turns: 1000000 }",
      "brief: { inject: true, max_tokens: 2000 }",
      "stale_turns: 5",
      "private_paths: []",
      "",
    ].join("\n"),
    "utf8",
  );
  const transcript = path.join(dir, "transcript.jsonl");
  writeFileSync(transcript, "x".repeat(4096), "utf8");
  bench = { root, home, transcript };

  // One session for the Stop and SessionEnd runs to count against.
  runHook("SessionStart", { session_id: "bench-session", source: "startup" });
});

/** One end-to-end invocation of the built binary. Returns its wall time in milliseconds. */
function runHook(event: string, extra: Record<string, unknown>): number {
  const payload = JSON.stringify({
    session_id: "bench-session",
    transcript_path: bench.transcript,
    cwd: bench.root,
    hook_event_name: event,
    ...extra,
  });
  const started = process.hrtime.bigint();
  execFileSync(process.execPath, [BIN, "hook", event], {
    input: payload,
    cwd: bench.root,
    env: { ...process.env, WORKLEDGER_HOME: bench.home },
    stdio: ["pipe", "pipe", "pipe"],
  });
  return Number(process.hrtime.bigint() - started) / 1e6;
}

/** The p95 of a sample, and the median, both rounded to a tenth of a millisecond. */
function stats(samples: number[]): { p50: number; p95: number; max: number } {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q: number): number =>
    Number((sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)] as number).toFixed(1));
  return { p50: at(0.5), p95: at(0.95), max: Number((sorted.at(-1) as number).toFixed(1)) };
}

describe("hook timing budget", () => {
  it(
    `Stop allow p95 stays under ${ALLOW_RATIO_MAX}x a bare Node start over ${ALLOW_ROUNDS} rounds of ${ALLOW_RUNS_PER_ROUND}`,
    () => {
      const rounds: Round[] = [];
      for (let i = 0; i < ALLOW_ROUNDS; i += 1) rounds.push(allowRound(ALLOW_RUNS_PER_ROUND));
      // The median *round*, chosen by ratio: one stalled round is outvoted, and the numbers
      // reported are the ones the assertion used rather than an average of unlike things.
      const median = [...rounds].sort((a, b) => a.ratio - b.ratio)[Math.floor(ALLOW_ROUNDS / 2)] as Round;

      // Reported unconditionally: the PR quotes this line, and a run that passes at 148 ms in CI
      // is information a reviewer needs even though it is green.
      const detail = rounds
        .map((r) => `baseline p95 ${r.baselineP95} ms / allow p95 ${r.allowP95} ms = ${r.ratio}x`)
        .join("; ");
      const summary =
        `hook Stop allow: baseline p95 ${median.baselineP95} ms, allow p50 ${median.allowP50} ms, ` +
        `p95 ${median.allowP95} ms, max ${median.allowMax} ms; ratio ${median.ratio}x ` +
        `(ceiling ${ALLOW_RATIO_MAX}x; reported budget ${ALLOW_BUDGET_MS} ms) — rounds: ${detail}`;
      console.log(summary);

      expect(median.ratio, summary).toBeLessThan(ALLOW_RATIO_MAX);
      expect(median.allowP95, summary).toBeLessThan(ALLOW_SANITY_MS);
      if (median.allowP95 >= ALLOW_BUDGET_MS) {
        console.warn(
          `hook Stop allow p95 ${median.allowP95} ms is over the ${ALLOW_BUDGET_MS} ms budget on this machine (load?); ratio ${median.ratio}x is inside ${ALLOW_RATIO_MAX}x`,
        );
      }
    },
    180_000,
  );

  it(
    "SessionStart is inside the budget over 20 runs",
    () => {
      const samples: number[] = [];
      for (let i = 0; i < 20; i += 1) {
        // A fresh harness id each time: minting the ulid, writing the frontmatter and building
        // the brief is the expensive path, and reusing a row would not measure it.
        samples.push(runHook("SessionStart", { session_id: `bench-start-${i}`, source: "startup" }));
      }
      const { p50, p95, max } = stats(samples);
      console.log(`hook SessionStart: p50 ${p50} ms, p95 ${p95} ms, max ${max} ms (budget ${START_BUDGET_MS} ms)`);
      expect(max).toBeLessThan(START_BUDGET_MS);
    },
    120_000,
  );

  it(
    "SessionEnd is inside the budget over 20 runs",
    () => {
      const samples: number[] = [];
      for (let i = 0; i < 20; i += 1) {
        samples.push(runHook("SessionEnd", { reason: "prompt_input_exit" }));
      }
      const { p50, p95, max } = stats(samples);
      console.log(`hook SessionEnd: p50 ${p50} ms, p95 ${p95} ms, max ${max} ms (budget ${END_BUDGET_MS} ms)`);
      expect(max).toBeLessThan(END_BUDGET_MS);
    },
    120_000,
  );
});

// ---------------------------------------------------------------------------
// The property that keeps the budget met
// ---------------------------------------------------------------------------

/**
 * esbuild wraps every module that is only reached by an `await import()` in a lazily-called
 * `var init_<name> = __esm({ … })` and emits the module's source path above it as a comment. A
 * module whose `init_` is *never* called at the top level of the bundle therefore never runs
 * until something awaits it.
 */
function bundle(): string {
  return readFileSync(BUNDLE, "utf8");
}

/**
 * The `init_` names esbuild gave the modules whose source path starts with `prefix`.
 *
 * The bundle is split on the `// <source path>` comments esbuild writes above each module; a
 * module that is only reached lazily opens with `var init_<name> = __esm(` somewhere in its
 * section (after its `_exports` object, when it has one).
 */
function lazyInitNames(source: string, prefix: string): string[] {
  const names: string[] = [];
  const sections = source.split(/^\/\/ (?=[a-z])/m);
  for (const section of sections) {
    const header = section.slice(0, section.indexOf("\n"));
    if (!header.startsWith(prefix)) continue;
    const init = /^var (init_[A-Za-z0-9_$]+) = __esm\(/m.exec(section);
    if (init) names.push(init[1] as string);
  }
  return names;
}

describe("the bundle's lazy boundaries", () => {
  it("no @workledger/core module is initialized at the top level of the bundle", () => {
    const source = bundle();
    const coreInits = lazyInitNames(source, "packages/core/src/");
    // If this is empty the regex has stopped matching esbuild's output and the test below would
    // pass vacuously.
    expect(coreInits.length).toBeGreaterThanOrEqual(5);

    // A top-level call is at column 0; every lazy call site is indented inside an `__esm` body
    // or inside the `Promise.resolve().then(() => (init_x(), x_exports))` an `import()` compiles
    // to.
    const topLevel = [...source.matchAll(/^(init_[A-Za-z0-9_$]+)\(\);$/gm)].map((m) => m[1]);
    expect(topLevel.filter((name) => coreInits.includes(name as string))).toEqual([]);
  });

  it("better-sqlite3 is required only behind a lazy boundary", () => {
    const source = bundle();
    // `better-sqlite3` is `external`, so it stays a bare specifier in the output. Every one of
    // its occurrences must be inside a wrapped module body, never at column 0.
    const references = [...source.matchAll(/^[^\s].*better-sqlite3.*$/gm)].map((m) => m[0]);
    expect(references).toEqual([]);
    expect(source).toContain("better-sqlite3");
  });

  it("the hook command itself is reached lazily from the program", () => {
    const source = bundle();
    const hookInits = lazyInitNames(source, "packages/cli/src/commands/hook.ts");
    expect(hookInits).toHaveLength(1);
    expect(source).toContain(`${hookInits[0] as string}(), hook_exports`);
  });
});
