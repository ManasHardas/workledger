import js from "@eslint/js";
import tseslint from "typescript-eslint";

/**
 * `packages/core` is pure TypeScript by contract (CLAUDE.md): no Node APIs, no filesystem,
 * no SQLite. This list is the enforcement of that rule at lint time.
 */
const nodeBuiltins = ["fs", "path", "os", "child_process", "crypto", "url", "node:test"];

/** The `no-restricted-imports` options that keep one package free of Node built-ins. */
function pureFence(pkg, remedy) {
  const message = `${pkg} must stay pure TypeScript — ${remedy}.`;
  return {
    paths: nodeBuiltins.map((name) => ({ name, message })),
    patterns: [{ group: ["node:*"], message }],
  };
}

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
    // `packages/tokens/scripts/*.mjs` is plain Node ESM like `scripts/*.mjs` above, and gets the
    // same treatment: declare the globals it uses rather than switching `no-undef` off.
    files: ["packages/tokens/scripts/**/*.mjs"],
    languageOptions: {
      sourceType: "module",
      globals: { URL: "readonly", console: "readonly" },
    },
  },
  {
    // The service worker runs in ServiceWorkerGlobalScope, not in a window and not in Node.
    files: ["apps/web/public/sw.js"],
    languageOptions: {
      sourceType: "script",
      globals: {
        caches: "readonly",
        fetch: "readonly",
        self: "readonly",
        Promise: "readonly",
        Response: "readonly",
        URL: "readonly",
      },
    },
  },
  {
    files: ["packages/core/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", pureFence("packages/core", "move side effects into packages/cli")],
    },
  },
  {
    // `packages/api-client` is isomorphic by contract (docs/contracts/p2/ledger-source.md): it
    // runs in the browser, under Node and one day inside a Dome card, and reaches the platform
    // only through `fetch` and `EventSource`. Same fence as core, and for the same reason.
    // `test/` is excluded — the tests run a real `packages/server` over a temp ledger, which is
    // exactly the filesystem work the fence keeps out of `src/`.
    files: ["packages/api-client/src/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", pureFence("packages/api-client", "reach the platform through fetch and EventSource")],
    },
  },
);
