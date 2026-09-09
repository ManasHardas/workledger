/**
 * Public surface of `@workledger/core`. The package is pure TypeScript by contract
 * (CLAUDE.md): no Node built-ins, no filesystem, no SQLite — side effects live in
 * `packages/cli` and `packages/server`.
 */
export * from "./schema.js";
export * from "./ids.js";
export * from "./frontmatter.js";
export * from "./tokens.js";
export * from "./brief.js";
export * from "./secretscan-patterns.js";
export * from "./secretscan.js";
// `render/common.js` holds the parse internals (`readAttribute`, `splitList`, `validate`, …); only
// the error type belongs in the published surface, so it is re-exported by name rather than with
// `export *` — the `publish dry-run` job pins whatever ships here.
export { RenderError, type RenderErrorCode } from "./render/common.js";
export * from "./render/session.js";
export * from "./render/backlog.js";
