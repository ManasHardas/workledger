import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// The contract-parity suite: it reads docs/contracts/p1/ from disk, so it lives here rather
// than in packages/core, which stays free of Node built-ins.
export default defineConfig({
  resolve: {
    alias: {
      "@workledger/core": fileURLToPath(
        new URL("../packages/core/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    name: "contracts",
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
