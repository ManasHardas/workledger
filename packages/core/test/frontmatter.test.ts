import { describe, expect, it } from "vitest";

import {
  BacklogItem,
  FrontmatterError,
  SCHEMA_VERSION,
  SessionFrontmatter,
  assertSchemaVersion,
  parseFrontmatter,
  stringifyFrontmatter,
} from "../src/index.js";

/**
 * Fixtures are loaded through `import.meta.glob` rather than `node:fs`: `packages/core` is pure
 * TypeScript by contract, and the eslint fence covers `packages/core/**` — tests included.
 */
const documents = import.meta.glob<string>("./fixtures/frontmatter/*.md", {
  eager: true,
  query: "?raw",
  import: "default",
});

function fixture(name: string): string {
  const key = Object.keys(documents).find((path) => path.endsWith(`/${name}.md`));
  if (key === undefined) throw new Error(`fixture not found: ${name}.md`);
  return documents[key]!;
}

/** The error a call is expected to throw, so `line` can be asserted on. */
function frontmatterError(run: () => unknown): FrontmatterError {
  try {
    run();
  } catch (error) {
    if (error instanceof FrontmatterError) return error;
    throw error;
  }
  throw new Error("expected a FrontmatterError, but nothing was thrown");
}

describe("parseFrontmatter / stringifyFrontmatter round trip", () => {
  it("round trip preserves unknown keys and key order", () => {
    const text = fixture("session");
    const { data, body } = parseFrontmatter(text);

    // Both contracts are additionalProperties: true, so unknown keys are data, not noise.
    expect(data["x_unknown_scalar"]).toBe("kept by additionalProperties: true");
    expect(data["x_unknown_nested"]).toEqual({ keep: ["me", "too"], depth: 2 });
    expect(Object.keys(data).slice(0, 3)).toEqual(["schema_version", "id", "harness"]);
    expect(Object.keys(data).slice(-2)).toEqual(["x_unknown_scalar", "x_unknown_nested"]);

    expect(stringifyFrontmatter(data, body)).toBe(text);
  });

  it("round trip preserves a multiline body, including a `---` rule inside it", () => {
    const text = fixture("session");
    const { body } = parseFrontmatter(text);
    expect(body).toContain("\n---\n");
    expect(body.split("\n").length).toBeGreaterThan(5);
    expect(body.endsWith("A horizontal rule inside the body must survive.\n")).toBe(true);
  });

  it("round trips nested arrays of objects", () => {
    const { data, body } = parseFrontmatter(fixture("session"));
    expect(data["checkpoints"]).toEqual([
      { n: 1, at: "2026-09-09T12:14:03Z", turns: 6, transcript_offset: 48213, trigger: "bytes" },
      {
        n: 2,
        at: "2026-09-09T12:41:57Z",
        turns: 15,
        transcript_offset: 131904,
        trigger: "minutes",
      },
    ]);
    expect(parseFrontmatter(stringifyFrontmatter(data, body)).data).toEqual(data);
  });

  it("round trips a backlog item's history array of mixed actor shapes", () => {
    const text = fixture("backlog");
    const { data, body } = parseFrontmatter(text);
    const history = data["history"] as ReadonlyArray<Record<string, unknown>>;
    expect(history).toHaveLength(2);
    expect(history[0]!["by"]).toEqual({ session: "01JQ8ZK4T0000000000000000A", checkpoint: 1 });
    expect(history[1]!["diff"]).toBe("status: proposed → accepted");
    expect(stringifyFrontmatter(data, body)).toBe(text);
  });

  it("keeps a long scalar on one line rather than folding it", () => {
    const title = `Long title ${"x".repeat(400)}`;
    const rendered = stringifyFrontmatter({ schema_version: SCHEMA_VERSION, title }, "");
    expect(parseFrontmatter(rendered).data["title"]).toBe(title);
    expect(rendered.split("\n").some((line) => line.length > 400)).toBe(true);
  });

  it("round trips an empty body", () => {
    const text = stringifyFrontmatter({ schema_version: SCHEMA_VERSION, id: "x" });
    expect(text).toBe("---\nschema_version: 1\nid: x\n---\n");
    const { data, body } = parseFrontmatter(text);
    expect(body).toBe("");
    expect(stringifyFrontmatter(data, body)).toBe(text);
  });

  it("normalizes Windows line endings to \\n", () => {
    const unix = fixture("session");
    const windows = unix.replace(/\n/g, "\r\n");
    const fromWindows = parseFrontmatter(windows);
    expect(fromWindows).toEqual(parseFrontmatter(unix));
    expect(fromWindows.body).not.toContain("\r");
    // A file hand-edited on Windows re-serializes to the byte-identical Unix form.
    expect(stringifyFrontmatter(fromWindows.data, fromWindows.body)).toBe(unix);
  });

  it("normalizes a lone carriage return in a body handed to stringify", () => {
    const text = stringifyFrontmatter({ schema_version: SCHEMA_VERSION }, "one\rtwo\r\nthree");
    expect(text.endsWith("---\none\ntwo\nthree")).toBe(true);
  });

  it("strips a leading byte-order mark", () => {
    const text = fixture("backlog");
    expect(parseFrontmatter(`\uFEFF${text}`)).toEqual(parseFrontmatter(text));
  });
});

describe("parseFrontmatter errors", () => {
  it("rejects a document with no frontmatter block, pointing at line 1", () => {
    const error = frontmatterError(() => parseFrontmatter("# Just markdown\n\nNo fence here.\n"));
    expect(error).toBeInstanceOf(FrontmatterError);
    expect(error.name).toBe("FrontmatterError");
    expect(error.line).toBe(1);
    expect(error.message).toMatch(/open with a `---` frontmatter fence/);
  });

  it("rejects an unterminated block, pointing at the last line", () => {
    const error = frontmatterError(() => parseFrontmatter("---\nschema_version: 1\nid: x\n"));
    expect(error.line).toBe(4);
    expect(error.message).toMatch(/unterminated/);
  });

  it("rejects malformed YAML with the line it failed on", () => {
    const text = ["---", "schema_version: 1", "author:", "  name: ok", " bad_indent: nope", "---", ""].join("\n");
    const error = frontmatterError(() => parseFrontmatter(text));
    expect(error.message).toMatch(/invalid YAML/);
    // Line 5 of the document is the offending key; the fence on line 1 is accounted for.
    expect(error.line).toBe(5);
  });

  it("rejects a frontmatter block that is not a mapping", () => {
    for (const block of ["---\n- one\n- two\n---\n", "---\njust a scalar\n---\n", "---\n---\n"]) {
      const error = frontmatterError(() => parseFrontmatter(block));
      expect(error.line).toBe(2);
      expect(error.message).toMatch(/must be a YAML mapping/);
    }
  });

  it("treats a fence with trailing whitespace as a fence", () => {
    const { data, body } = parseFrontmatter("---  \nschema_version: 1\n---\t\nbody\n");
    expect(data).toEqual({ schema_version: 1 });
    expect(body).toBe("body\n");
  });
});

describe("stringifyFrontmatter errors", () => {
  it("rejects data that is not a plain object", () => {
    for (const bad of [null, [1, 2], "text"]) {
      expect(() => stringifyFrontmatter(bad as unknown as Record<string, unknown>)).toThrow(
        TypeError,
      );
    }
  });
});

describe("assertSchemaVersion", () => {
  it("accepts the version this build writes", () => {
    const { data } = parseFrontmatter(fixture("session"));
    expect(() => assertSchemaVersion(data)).not.toThrow();
    expect(() => assertSchemaVersion(data, SCHEMA_VERSION)).not.toThrow();
  });

  it("parse rejects a document with no schema_version", () => {
    const { data } = parseFrontmatter("---\nid: x\n---\n");
    const error = frontmatterError(() => assertSchemaVersion(data));
    expect(error.line).toBe(2);
    expect(error.message).toMatch(/missing the required `schema_version` key/);
  });

  it("rejects a future schema version", () => {
    const error = frontmatterError(() => assertSchemaVersion({ schema_version: 2 }));
    expect(error.message).toMatch(/unsupported schema_version 2/);
  });

  it("rejects a non-integer schema version", () => {
    for (const bad of ["1", 1.5, null, true]) {
      const error = frontmatterError(() => assertSchemaVersion({ schema_version: bad }));
      expect(error.message).toMatch(/must be an integer/);
    }
  });
});

describe("contract fixtures", () => {
  it("a session fixture parses, validates against the zod schema, and re-stringifies byte for byte", () => {
    const text = fixture("session");
    const { data, body } = parseFrontmatter(text);
    assertSchemaVersion(data);

    const validated = SessionFrontmatter.parse(data);
    expect(validated.id).toBe(data["id"]);
    expect(validated.checkpoints).toHaveLength(2);
    expect(validated.checkpoints[0]!.trigger).toBe("bytes");

    expect(stringifyFrontmatter(data, body)).toBe(text);
  });

  it("a backlog fixture parses, validates against the zod schema, and re-stringifies byte for byte", () => {
    const text = fixture("backlog");
    const { data, body } = parseFrontmatter(text);
    assertSchemaVersion(data);

    const validated = BacklogItem.parse(data);
    expect(validated.id).toBe(data["id"]);
    expect(validated.history).toHaveLength(2);

    expect(stringifyFrontmatter(data, body)).toBe(text);
  });
});
