/**
 * YAML frontmatter round-tripping for ledger files.
 *
 * Both P1 file contracts are `additionalProperties: true`, so a human or a later schema version
 * may leave keys this build does not know about. Parsing and re-stringifying must therefore be
 * lossless: unknown keys survive, and so does key insertion order. The `---` delimiting is done
 * here rather than by `gray-matter`, which `require`s `fs` at module load and would break the
 * `packages/core` purity fence; the `yaml` package underneath has zero dependencies and no Node
 * imports in its browser build.
 *
 * Line endings are normalized to `\n` on the way in. The ledger is written by the CLI with `\n`
 * and compared byte for byte, so a file hand-edited on Windows must not round trip into a diff.
 */
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { SCHEMA_VERSION } from "./schema.js";

/** The fence that opens and closes a frontmatter block. */
const DELIMITER = "---";
/** File line of the first key in the block: line 1 is the opening fence. */
const FIRST_DATA_LINE = 2;

/** A frontmatter block that is missing, unterminated, not a mapping, or not valid YAML. */
export class FrontmatterError extends Error {
  /** 1-based line in the source document that the reader should look at. */
  readonly line: number;

  constructor(message: string, line: number) {
    super(message);
    this.name = "FrontmatterError";
    this.line = line;
  }
}

/** A document split into its frontmatter mapping and the markdown body that follows it. */
export interface ParsedFrontmatter {
  /** The frontmatter mapping, with unknown keys and key order preserved. */
  data: Record<string, unknown>;
  /** Everything after the closing fence, verbatim apart from line-ending normalization. */
  body: string;
}

/** Normalize CRLF and lone CR to LF, and drop a leading byte-order mark. */
function normalize(text: string): string {
  const withoutBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  return withoutBom.replace(/\r\n?/g, "\n");
}

function isFence(line: string | undefined): boolean {
  return line !== undefined && line.trimEnd() === DELIMITER;
}

/**
 * The 1-based line inside the YAML block that a `yaml` parse error points at, or `1` when the
 * error carries no position. `yaml` reports `linePos` relative to the string it was handed.
 */
function yamlErrorLine(error: unknown): number {
  const linePos = (error as { linePos?: ReadonlyArray<{ line?: number }> }).linePos;
  const line = linePos?.[0]?.line;
  return typeof line === "number" && line >= 1 ? line : 1;
}

/**
 * Split a ledger file into frontmatter and body.
 *
 * @throws {FrontmatterError} when the document does not open with `---`, has no closing `---`,
 * carries invalid YAML, or whose frontmatter is not a mapping. The error's `line` points into
 * the document as given.
 */
export function parseFrontmatter(text: string): ParsedFrontmatter {
  const source = normalize(text);
  const lines = source.split("\n");

  if (!isFence(lines[0])) {
    throw new FrontmatterError("expected the document to open with a `---` frontmatter fence", 1);
  }

  let close = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (isFence(lines[i])) {
      close = i;
      break;
    }
  }
  if (close === -1) {
    throw new FrontmatterError(
      "unterminated frontmatter block: no closing `---` fence",
      lines.length,
    );
  }

  const block = lines.slice(1, close).join("\n");
  // Index of the newline that ends the closing fence; the body starts one character later.
  const consumed = lines.slice(0, close + 1).join("\n").length;
  const body = consumed < source.length ? source.slice(consumed + 1) : "";

  let parsed: unknown;
  try {
    parsed = parseYaml(block);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new FrontmatterError(
      `invalid YAML in the frontmatter block: ${detail}`,
      yamlErrorLine(error) + 1,
    );
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new FrontmatterError("frontmatter block must be a YAML mapping", FIRST_DATA_LINE);
  }

  return { data: parsed as Record<string, unknown>, body };
}

/**
 * Render a frontmatter mapping and a body back into a ledger file.
 *
 * `lineWidth: 0` disables line folding: a long `title` or `diff` must come back out of
 * {@link parseFrontmatter} as the same single-line scalar it went in as.
 */
export function stringifyFrontmatter(data: Record<string, unknown>, body = ""): string {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new TypeError("frontmatter data must be a plain object");
  }
  const rendered = stringifyYaml(data, { lineWidth: 0 });
  const block = rendered.endsWith("\n") ? rendered : `${rendered}\n`;
  return `${DELIMITER}\n${block}${DELIMITER}\n${normalize(body)}`;
}

/**
 * Reject a ledger file this build cannot read. Every P1 artifact carries `schema_version`, and
 * a mismatch means the file was written by a different version of the contracts — refusing is
 * the only safe move, since an unknown version may have re-used a key with new meaning.
 */
export function assertSchemaVersion(
  data: Record<string, unknown>,
  expected: number = SCHEMA_VERSION,
): void {
  const actual = data["schema_version"];
  if (actual === undefined) {
    throw new FrontmatterError("frontmatter is missing the required `schema_version` key", FIRST_DATA_LINE);
  }
  if (typeof actual !== "number" || !Number.isInteger(actual)) {
    throw new FrontmatterError(
      `\`schema_version\` must be an integer, got ${JSON.stringify(actual)}`,
      FIRST_DATA_LINE,
    );
  }
  if (actual !== expected) {
    throw new FrontmatterError(
      `unsupported schema_version ${actual}: this build reads version ${expected}`,
      FIRST_DATA_LINE,
    );
  }
}
