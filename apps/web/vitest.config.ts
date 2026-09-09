import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/** `packages/core/src/`, the directory every `@workledger/core` specifier resolves into. */
const CORE_SRC = fileURLToPath(new URL("../../packages/core/src/", import.meta.url));

export default defineConfig({
  // No Tailwind plugin here: the shell test asserts structure and data, never computed styles, so
  // compiling the stylesheet would only cost seconds. `src/index.css` is imported by main.tsx,
  // which the test does not load.
  plugins: [react()],
  resolve: {
    // Same aliasing as packages/cli/vitest.config.ts — tests read core's source, not dist/, so a
    // stale packages/core/dist can never turn into a mystifying red or a false green.
    alias: [
      { find: /^@workledger\/core\/(.+)$/, replacement: `${CORE_SRC}$1.ts` },
      { find: /^@workledger\/core$/, replacement: `${CORE_SRC}index.ts` },
    ],
  },
  test: {
    name: "web",
    include: ["test/**/*.test.tsx", "test/**/*.test.ts"],
    environment: "jsdom",
    globals: false,
  },
});
