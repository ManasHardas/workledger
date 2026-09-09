import js from "@eslint/js";
import tseslint from "typescript-eslint";

/**
 * `packages/core` is pure TypeScript by contract (CLAUDE.md): no Node APIs, no filesystem,
 * no SQLite. This list is the enforcement of that rule at lint time.
 */
const nodeBuiltins = ["fs", "path", "os", "child_process", "crypto", "url", "node:test"];

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/coverage/**", ".worktrees/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["packages/core/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: nodeBuiltins.map((name) => ({
            name,
            message:
              "packages/core must stay pure TypeScript — move side effects into packages/cli.",
          })),
          patterns: [
            {
              group: ["node:*"],
              message:
                "packages/core must stay pure TypeScript — move side effects into packages/cli.",
            },
          ],
        },
      ],
    },
  },
);
