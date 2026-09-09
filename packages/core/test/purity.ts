/**
 * The specifier matcher shared by every `packages/core` purity test.
 *
 * It matches a static `from "x"` **and** a dynamic `import("x")`: the CLI's Stop-hook budget
 * (plans/feature-p1-data-flow.md §6) pushed core behind lazy `await import()` boundaries, and a
 * `from`-only regex would have silently stopped enforcing the allowlist the day the first
 * dynamic import landed inside this package.
 */
export const PURITY_IMPORT_RE = /(?:\bfrom|\bimport)\s*\(?\s*"([^"]+)"/g;
