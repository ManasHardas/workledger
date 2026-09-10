import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

/** `packages/core/src/`, the directory every `@workledger/core` specifier resolves into. */
const CORE_SRC = fileURLToPath(new URL("../core/src/", import.meta.url));

/** `packages/server/src/`, so `@workledger/server` resolves to source and not to a stale dist. */
const SERVER_SRC = fileURLToPath(new URL("../server/src/", import.meta.url));

export default defineConfig({
  resolve: {
    // core's exports map points at dist/; under vitest we want the source, so a stale
    // (or absent) packages/core/dist can never turn into a mystifying red or false green.
    // The subpath rule comes first and both are anchored regexes: a plain string `find` is a
    // prefix replacement in vite, so a single `@workledger/core` entry would rewrite
    // `@workledger/core/ids` into `…/src/index.ts/ids`.
    alias: [
      { find: /^@workledger\/core\/(.+)$/, replacement: `${CORE_SRC}$1.ts` },
      { find: /^@workledger\/core$/, replacement: `${CORE_SRC}index.ts` },
      { find: /^@workledger\/server$/, replacement: `${SERVER_SRC}index.ts` },
    ],
  },
  test: {
    name: "cli",
    // Test *files* run one at a time. `packages/cli/test/hook-timing.test.ts` asserts a
    // wall-clock contract — the Stop hook's p95 < 100 ms including Node startup
    // (plans/feature-p1-data-flow.md §6) — and a budget measured while four other workers are
    // saturating the machine measures the machine, not the hook. The whole suite is a few
    // seconds either way.
    fileParallelism: false,
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
