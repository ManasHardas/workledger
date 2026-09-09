import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // core's exports map points at dist/; under vitest we want the source, so a stale
      // (or absent) packages/core/dist can never turn into a mystifying red or false green.
      "@workledger/core": fileURLToPath(
        new URL("../core/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    name: "cli",
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
