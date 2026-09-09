import { defineConfig } from "vitest/config";

// Root vitest workspace: one project per package (each package owns a vitest.config.ts) so
// `pnpm test` runs everything from the root and `pnpm -r test` runs each package on its own.
export default defineConfig({
  test: {
    projects: ["packages/*"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      reportsDirectory: "coverage",
      include: ["src/**/*.ts"],
      all: true,
    },
  },
});
