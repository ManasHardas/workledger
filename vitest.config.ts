import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// Root vitest workspace: one project per package (each package owns a vitest.config.ts) so
// `pnpm test` runs everything from the root and `pnpm -r test` runs each package on its own.
export default defineConfig({
  resolve: {
    alias: {
      // Same aliasing as packages/cli/vitest.config.ts — tests read core's source, not dist/.
      "@workledger/core": fileURLToPath(
        new URL("./packages/core/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    projects: ["packages/*", "scripts"],
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
