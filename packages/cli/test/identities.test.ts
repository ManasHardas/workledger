/**
 * `.workledger/identities.yaml` — docs/contracts/p5/config-and-identities.md §`identities.yaml`.
 *
 * "Resolution: any `Actor` or `HumanStamp` whose `email` matches (case-insensitively) is
 * displayed with the mapped `name`; `dome_user` maps card edits back to an email in P6. Missing
 * file: emails display as before."
 *
 * So the assertions come in pairs: what the mapped name does to the output, and what the *same*
 * ledger prints with no file at all. The second half of each pair is the contract's promise that
 * this is a display layer — a repo whose teammates never wrote an identities file must be
 * unaffected by the feature existing.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createItem, createSessionText } from "@workledger/core";
import type { SessionFrontmatter } from "@workledger/core";

import { backlogCommand } from "../src/commands/backlog.js";
import { readBriefInput, runBrief } from "../src/commands/brief.js";
import { EXIT_OK } from "../src/exit-codes.js";
import {
  formatActor,
  identitiesFile,
  loadIdentities,
  NO_IDENTITIES,
  parseIdentities,
  resolveActor,
  resolveMaybe,
} from "../src/identities.js";
import type { CommandIo } from "../src/commands/backlog.js";

const ADA = { name: "ada", email: "Ada@Example.com" };
const ULID = "01JQ8ZK4T0000000000000000A";
const ITEM_ID = "WL-01JQ8ZK4T0000000000000000B";

const FLOW = [
  "schema_version: 1",
  "identities:",
  "  - { email: ada@example.com, name: Ada Lovelace, dome_user: null }",
  "  - { email: grace@example.com, name: Grace Hopper, dome_user: u_grace }",
  "",
].join("\n");

const BLOCK = [
  "schema_version: 1",
  "identities:",
  "  - email: ada@example.com",
  "    name: Ada Lovelace",
  "    dome_user: null",
  "  - email: grace@example.com",
  "    name: Grace Hopper",
  "",
].join("\n");

describe("parseIdentities", () => {
  it("reads the contract's flow-mapping shape", () => {
    const map = parseIdentities(FLOW);
    expect(map.size).toBe(2);
    expect(map.get("ada@example.com")).toEqual({
      email: "ada@example.com",
      name: "Ada Lovelace",
      dome_user: null,
    });
    expect(map.get("grace@example.com")?.dome_user).toBe("u_grace");
  });

  it("reads the block-mapping shape a person hand-edits into it", () => {
    const map = parseIdentities(BLOCK);
    expect([...map.keys()]).toEqual(["ada@example.com", "grace@example.com"]);
    expect(map.get("grace@example.com")?.name).toBe("Grace Hopper");
    expect(map.get("grace@example.com")?.dome_user).toBeNull();
  });

  it("keys case-insensitively, keeps quotes and comments out, and lets a later row win", () => {
    const map = parseIdentities(
      [
        "identities:",
        '  - { email: "ADA@Example.com", name: "Ada L" }   # the old spelling',
        "  - { email: ada@example.com, name: Ada Lovelace }",
        "",
      ].join("\n"),
    );
    expect(map.size).toBe(1);
    expect(map.get("ada@example.com")?.name).toBe("Ada Lovelace");
  });

  it("skips a row that is missing an email or a name, and never throws", () => {
    const map = parseIdentities(
      [
        "identities:",
        "  - { name: Nameless }",
        "  - { email: no-name@example.com }",
        "  - not-a-mapping",
        "  - { email: ok@example.com, name: Fine }",
        "other_key: 1",
        "  - { email: ignored@example.com, name: Ignored }",
        "",
      ].join("\n"),
    );
    expect([...map.keys()]).toEqual(["ok@example.com"]);
    expect(parseIdentities("")).toEqual(new Map());
    expect(parseIdentities("nonsense: [")).toEqual(new Map());
  });
});

describe("resolution", () => {
  const map = parseIdentities(FLOW);

  it("replaces the display name for a mapped email, whatever its case", () => {
    expect(resolveActor(ADA, map).name).toBe("Ada Lovelace");
    expect(resolveActor({ name: "g", email: "GRACE@EXAMPLE.COM" }, map).name).toBe("Grace Hopper");
  });

  it("leaves an unmapped actor exactly as the ledger recorded it", () => {
    const other = { name: "Someone Else", email: "else@example.com" };
    expect(resolveActor(other, map)).toBe(other);
    expect(resolveActor(ADA, NO_IDENTITIES)).toBe(ADA);
  });

  it("fills in dome_user from the map only when the ledger has none", () => {
    expect(resolveActor({ name: "g", email: "grace@example.com" }, map).dome_user).toBe("u_grace");
    expect(
      resolveActor({ name: "g", email: "grace@example.com", dome_user: "u_other" }, map).dome_user,
    ).toBe("u_other");
    expect(resolveActor(ADA, map).dome_user).toBeUndefined();
  });

  it("passes null and undefined through", () => {
    expect(resolveMaybe(null, map)).toBeNull();
    expect(resolveMaybe(undefined, map)).toBeUndefined();
    expect(resolveMaybe(ADA, map)?.name).toBe("Ada Lovelace");
  });

  it("formats an actor as `Name <email>`, or the bare email when there is no name", () => {
    expect(formatActor(ADA, map)).toBe("Ada Lovelace <Ada@Example.com>");
    expect(formatActor({ name: "", email: "nobody@example.com" }, map)).toBe("nobody@example.com");
  });
});

// ---------------------------------------------------------------------------
// Through the commands
// ---------------------------------------------------------------------------

const temps: string[] = [];
afterEach(() => {
  while (temps.length > 0) rmSync(temps.pop() as string, { recursive: true, force: true });
});

function frontmatter(): SessionFrontmatter {
  return {
    schema_version: 1,
    id: ULID,
    harness: "claude-code",
    harness_session_id: `hsess-${ULID}`,
    repo: "github.com/manashardas/workledger",
    branch: "main",
    author: { name: "ada", email: "Ada@Example.com", dome_user: null },
    started: "2026-09-09T12:00:00Z",
    ended: null,
    end_reason: null,
    status: "open",
    private: false,
    source: "live",
    model: null,
    needs_repair: false,
    checkpoint_failures: 0,
    checkpoints: [],
  };
}

interface Fixture {
  root: string;
  out: string[];
  err: string[];
  io: CommandIo;
}

/** An enabled repo holding one open backlog item owned by `ada@example.com`, plus one session. */
function setup(identities?: string): Fixture {
  const dir = mkdtempSync(path.join(os.tmpdir(), "workledger-identities-"));
  temps.push(dir);
  const root = path.join(dir, "repo");
  const ledger = path.join(root, ".workledger");
  mkdirSync(path.join(ledger, "sessions"), { recursive: true });
  mkdirSync(path.join(ledger, "backlog"), { recursive: true });
  writeFileSync(path.join(ledger, "config.yaml"), "schema_version: 1\n", "utf8");
  if (identities !== undefined) writeFileSync(path.join(ledger, "identities.yaml"), identities, "utf8");

  writeFileSync(path.join(ledger, "sessions", `${ULID}.md`), createSessionText(frontmatter()), "utf8");
  const item = createItem({
    id: ITEM_ID,
    title: "Ship identities",
    why: "Map emails to names.",
    provenance: {
      harness: "claude-code",
      session: ULID,
      checkpoint: 1,
      author: { name: "ada", email: "Ada@Example.com", dome_user: null },
    },
    now: "2026-09-09T12:00:00Z",
  });
  writeFileSync(path.join(ledger, "backlog", `${ITEM_ID}.md`), item, "utf8");

  const out: string[] = [];
  const err: string[] = [];
  return {
    root,
    out,
    err,
    io: {
      cwd: root,
      env: {},
      stdout: (line) => void out.push(line),
      stderr: (line) => void err.push(line),
    },
  };
}

/** Give the item an owner, which is the field both `brief` and `show` display. */
function assignOwner(root: string): void {
  const file = path.join(root, ".workledger", "backlog", `${ITEM_ID}.md`);
  const text = readFile(file);
  writeFileSync(
    file,
    text.replace("owner: null", "owner: { name: ada, email: Ada@Example.com, dome_user: null }"),
    "utf8",
  );
}

function readFile(file: string): string {
  return readFileSync(file, "utf8");
}

describe("identities in command output", () => {
  it("names the owner in `backlog show`, and the email when there is no file", async () => {
    const mapped = setup(FLOW);
    assignOwner(mapped.root);
    expect(await backlogCommand(["show", ITEM_ID], mapped.io)).toBe(EXIT_OK);
    expect(mapped.out.join("\n")).toContain("owner: Ada Lovelace <Ada@Example.com>");

    const bare = setup();
    assignOwner(bare.root);
    expect(await backlogCommand(["show", ITEM_ID], bare.io)).toBe(EXIT_OK);
    expect(bare.out.join("\n")).toContain("owner: ada <Ada@Example.com>");
    expect(bare.out.join("\n")).not.toContain("Ada Lovelace");
  });

  it("names the owner in `backlog list --json` and in `show --json`", async () => {
    const fixture = setup(FLOW);
    assignOwner(fixture.root);

    expect(await backlogCommand(["list", "--json"], fixture.io)).toBe(EXIT_OK);
    const rows = JSON.parse(fixture.out.join("\n")) as Array<{ item: { owner: { name: string } } }>;
    expect(rows[0]?.item.owner.name).toBe("Ada Lovelace");

    fixture.out.length = 0;
    expect(await backlogCommand(["show", ITEM_ID, "--json"], fixture.io)).toBe(EXIT_OK);
    const shown = JSON.parse(fixture.out.join("\n")) as { item: { owner: { name: string } } };
    expect(shown.item.owner.name).toBe("Ada Lovelace");
  });

  it("names the owner in the brief's backlog column", async () => {
    const mapped = setup(FLOW);
    assignOwner(mapped.root);
    expect(await runBrief({}, { ...mapped.io, stdout: mapped.io.stdout })).toBe(EXIT_OK);
    expect(mapped.out.join("\n")).toContain("Ada Lovelace");

    const bare = setup();
    assignOwner(bare.root);
    expect(await runBrief({}, { ...bare.io, stdout: bare.io.stdout })).toBe(EXIT_OK);
    expect(bare.out.join("\n")).not.toContain("Ada Lovelace");
  });

  it("resolves the session author in the brief input", async () => {
    const fixture = setup(FLOW);
    const input = await readBriefInput(fixture.root);
    expect(input.sessions[0]?.frontmatter.author.name).toBe("Ada Lovelace");
    // The file on disk is untouched: this is a view, not a rewrite.
    expect(readFile(path.join(fixture.root, ".workledger", "sessions", `${ULID}.md`))).toContain(
      "name: ada",
    );
  });

  it("honours config.identities_file and falls back for a missing one", () => {
    const fixture = setup();
    const custom = path.join(fixture.root, ".workledger", "team.yaml");
    writeFileSync(custom, FLOW, "utf8");

    expect(identitiesFile(fixture.root, { identities_file: "team.yaml" })).toBe(custom);
    expect(loadIdentities(fixture.root, { identities_file: "team.yaml" }).size).toBe(2);
    expect(loadIdentities(fixture.root, { identities_file: "  " }).size).toBe(0);
    expect(loadIdentities(fixture.root).size).toBe(0);
  });
});
