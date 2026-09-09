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
    // Repo tooling under scripts/ is plain Node ESM, not TypeScript, so `no-undef` is live for it
    // (typescript-eslint switches that rule off for .ts). Declaring the handful of Node globals
    // these scripts actually use keeps the rule useful instead of turning it off wholesale.
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      sourceType: "module",
      globals: {
        Buffer: "readonly",
        URL: "readonly",
        console: "readonly",
        process: "readonly",
      },
    },
  },
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
