import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

/** `packages/core/src/`, the directory every `@workledger/core` specifier resolves into. */
const CORE_SRC = fileURLToPath(new URL("../core/src/", import.meta.url));

export default defineConfig({
  resolve: {
    // Same aliasing as packages/server/vitest.config.ts — tests read core's source, not dist/, so
    // a stale (or absent) packages/core/dist can never turn into a mystifying red or false green.
    alias: [
      { find: /^@workledger\/core\/(.+)$/, replacement: `${CORE_SRC}$1.ts` },
      { find: /^@workledger\/core$/, replacement: `${CORE_SRC}index.ts` },
    ],
  },
  test: {
    name: "api-client",
    // The SSE test asserts a wall-clock contract (an event arrives within seconds of a file
    // change); a budget measured while other workers saturate the machine measures the machine.
    fileParallelism: false,
    include: ["test/**/*.test.ts"],
    environment: "node",
    testTimeout: 20000,
  },
});
