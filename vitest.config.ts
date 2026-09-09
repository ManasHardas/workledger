import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

/** `packages/core/src/`, the directory every `@workledger/core` specifier resolves into. */
const CORE_SRC = fileURLToPath(new URL("./packages/core/src/", import.meta.url));

// Root vitest workspace: one project per package (each package owns a vitest.config.ts) so
// `pnpm test` runs everything from the root and `pnpm -r test` runs each package on its own.
export default defineConfig({
  resolve: {
    // Same aliasing as packages/cli/vitest.config.ts — tests read core's source, not dist/.
    // The subpath rule comes first and both are anchored regexes: a plain string `find` is a
    // prefix replacement in vite, so a single `@workledger/core` entry would rewrite
    // `@workledger/core/ids` into `…/src/index.ts/ids`.
    alias: [
      { find: /^@workledger\/core\/(.+)$/, replacement: `${CORE_SRC}$1.ts` },
      { find: /^@workledger\/core$/, replacement: `${CORE_SRC}index.ts` },
    ],
  },
  test: {
    projects: ["packages/*", "scripts"],
    // Test *files* run one at a time. `packages/cli/test/hook-timing.test.ts` asserts a
    // wall-clock contract — the Stop hook's p95 < 100 ms including Node startup
    // (plans/feature-p1-data-flow.md §6) — and a budget measured while four other workers are
    // saturating the machine measures the machine, not the hook. The whole suite is a few
    // seconds either way.
    fileParallelism: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      reportsDirectory: "coverage",
      // Every glob is spelled from the repo root: a project-relative glob does not resolve
      // against the root config's directory, so `src/**/*.ts` matched nothing and
      // packages/core/src was silently absent from lcov.info — which would have let
      // scripts/coverage-gate.mjs score every change to core as "no executable lines".
      // scripts/coverage-gate.mjs mirrors this list; the two must not drift.
      include: ["packages/*/src/**/*.ts", "scripts/*.ts"],
      all: true,
    },
  },
});
