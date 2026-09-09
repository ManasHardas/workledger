import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

import { buildDocuments, isBlock, type JsonValue } from "./json-schema-fragments.js";

/**
 * Regenerate the three frozen JSON Schema artifacts under `docs/contracts/p1/` from the zod
 * schemas in `packages/core/src/schema.ts`.
 *
 *   pnpm contracts                              # builds @workledger/core, then exports
 *   git diff --exit-code docs/contracts/p1/     # must be clean
 *
 * `pnpm contracts` rebuilds core first because this script resolves `@workledger/core` through
 * the package's `exports` map (i.e. `dist/`); the vitest `contracts` project aliases the same
 * specifier to `src/`, so the parity test always sees the working tree.
 *
 * The contract is frozen, so the export must reproduce each file byte for byte — including the
 * hand formatting, which mixes one-line leaf schemas with expanded structural objects. The
 * printer below reproduces that from the `block()` marks carried by the fragments; it is not a
 * general-purpose pretty-printer.
 */

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

const INDENT = "  ";

/** True when an inline array pads its brackets: `[ { … } ]` for objects, `[…]` for scalars. */
function padsBrackets(items: readonly JsonValue[]): boolean {
  return items.some((item) => typeof item === "object" && item !== null);
}

function renderInline(value: JsonValue): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const pad = padsBrackets(value) ? " " : "";
    return `[${pad}${value.map(renderInline).join(", ")}${pad}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length === 0) return "{}";
    return `{ ${entries.map(([k, v]) => `${JSON.stringify(k)}: ${renderInline(v)}`).join(", ")} }`;
  }
  return JSON.stringify(value);
}

function render(value: JsonValue, depth: number): string {
  if (value === null || typeof value !== "object" || !isBlock(value)) {
    return renderInline(value);
  }
  const inner = INDENT.repeat(depth + 1);
  const outer = INDENT.repeat(depth);
  if (Array.isArray(value)) {
    const items = value.map((item) => `${inner}${render(item, depth + 1)}`);
    return `[\n${items.join(",\n")}\n${outer}]`;
  }
  const entries = Object.entries(value).map(
    ([key, item]) => `${inner}${JSON.stringify(key)}: ${render(item, depth + 1)}`,
  );
  return `{\n${entries.join(",\n")}\n${outer}}`;
}

/** One rendered artifact: repo-relative path and the exact bytes it should contain. */
export interface RenderedContract {
  path: string;
  contents: string;
}

/** Render all three frozen artifacts in memory. Pure — no filesystem access. */
export function renderContracts(): RenderedContract[] {
  return buildDocuments().map(({ path, value }) => ({
    path,
    contents: `${render(value, 0)}\n`,
  }));
}

/** Read a repo-relative file as UTF-8. */
export function readRepoFile(path: string): string {
  return readFileSync(new URL(path, pathToFileURL(REPO_ROOT)), "utf8");
}

/** Write every rendered artifact to disk. Returns the paths whose contents changed. */
export function writeContracts(): string[] {
  const changed: string[] = [];
  for (const { path, contents } of renderContracts()) {
    const target = new URL(path, pathToFileURL(REPO_ROOT));
    let current: string | undefined;
    try {
      current = readFileSync(target, "utf8");
    } catch {
      current = undefined;
    }
    if (current === contents) continue;
    writeFileSync(target, contents, "utf8");
    changed.push(path);
  }
  return changed;
}

const entry = process.argv[1];
if (entry !== undefined && pathToFileURL(entry).href === import.meta.url) {
  const changed = writeContracts();
  if (changed.length === 0) {
    console.log("docs/contracts/p1: up to date (3 files)");
  } else {
    for (const path of changed) console.log(`rewrote ${path}`);
  }
}
