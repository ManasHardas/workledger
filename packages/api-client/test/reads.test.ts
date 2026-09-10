/**
 * Every GET method of `LedgerSource` against a real `packages/server` over a temp copy of this
 * repo's `.workledger/` — the issue's acceptance criterion ("every method round-trips").
 */
import { rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { ApiClientError, createSource, normalizeBaseUrl, queryString } from "../src/index.js";
import { startHarness } from "./helpers.js";
import type { Harness } from "./helpers.js";
import type { LedgerSource } from "../src/index.js";

let harness: Harness;
let source: LedgerSource;

beforeAll(async () => {
  harness = await startHarness();
  // A trailing slash on the base URL is the mistake a hand-typed `--port` invitation invites;
  // passing one here means every request in this file also proves it is normalized away.
  source = createSource("local", { baseUrl: `${harness.baseUrl}/` });
});

afterAll(async () => {
  await harness.stop();
});

/** The harness's ledger directory. Read through a function because `harness` is set in `beforeAll`. */
function harnessLedger(): string {
  return harness.ledger;
}

describe("capabilities", () => {
  it("is the local server's triple from ledger-source.md", () => {
    // `provenance` became true in P3: `GET /api/sessions/:ulid/excerpt` is the affordance the
    // flag gates, and a local server can reach the machine the transcript is on.
    expect(source.capabilities).toEqual({ write: true, live: true, provenance: true });
  });
});

describe("sessions", () => {
  it("lists the dogfood ledger newest first", async () => {
    const sessions = await source.listSessions();
    expect(sessions.length).toBeGreaterThan(0);
    const started = sessions.map((s) => s.frontmatter.started);
    expect([...started].sort().reverse()).toEqual(started);
    // api.md's ParsedSession, not core's: a single `goal` string and no `raw` on any line.
    const first = sessions[0]!;
    expect(typeof first.goal === "string" || first.goal === null).toBe(true);
    expect(Array.isArray(first.done)).toBe(true);
    expect(Array.isArray(first.unparsed)).toBe(true);
    for (const line of first.done) expect(line).not.toHaveProperty("raw");
  });

  it("passes every query parameter through", async () => {
    const all = await source.listSessions();
    const limited = await source.listSessions({ limit: 1 });
    expect(limited).toHaveLength(1);

    const harnessName = all[0]!.frontmatter.harness;
    const byHarness = await source.listSessions({ harness: harnessName });
    expect(byHarness.every((s) => s.frontmatter.harness === harnessName)).toBe(true);

    const status = all[0]!.frontmatter.status;
    const byStatus = await source.listSessions({ status });
    expect(byStatus.every((s) => s.frontmatter.status === status)).toBe(true);

    // The server matches `author` against the actor's name *or* email, not the whole object.
    const author = all[0]!.frontmatter.author.name;
    const byAuthor = await source.listSessions({ author });
    expect(byAuthor.length).toBeGreaterThan(0);

    const since = await source.listSessions({ since: "2099-01-01T00:00:00Z" });
    expect(since).toEqual([]);

    const noMatch = await source.listSessions({ q: "zzz-no-such-substring-zzz" });
    expect(noMatch).toEqual([]);
  });

  it("gets one session by ulid", async () => {
    const [first] = await source.listSessions({ limit: 1 });
    const one = await source.getSession(first!.frontmatter.id);
    expect(one.frontmatter.id).toBe(first!.frontmatter.id);
  });

  it("rejects an unknown ulid with the contract's 404 code", async () => {
    await expect(source.getSession("01NOPE")).rejects.toMatchObject({
      code: "not_found",
      status: 404,
    });
    await expect(source.getSession("01NOPE")).rejects.toBeInstanceOf(ApiClientError);
  });
});

describe("backlog", () => {
  it("lists by rank and hides discarded by default", async () => {
    const items = await source.listBacklog();
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.frontmatter.status !== "discarded")).toBe(true);
    const ranks = items.map((i) => i.frontmatter.rank);
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
    expect(typeof items[0]!.body).toBe("string");
  });

  it("sends `status` as the contract's comma list", async () => {
    const proposed = await source.listBacklog({ status: ["proposed"] });
    expect(proposed.every((i) => i.frontmatter.status === "proposed")).toBe(true);

    const two = await source.listBacklog({ status: ["proposed", "accepted"] });
    expect(two.every((i) => ["proposed", "accepted"].includes(i.frontmatter.status))).toBe(true);
    expect(two.length).toBeGreaterThanOrEqual(proposed.length);

    // An empty list means "no filter", not "match nothing" — sending `status=` would be a 400.
    expect(await source.listBacklog({ status: [] })).toEqual(await source.listBacklog());
  });

  it("gets one item and 404s on an unknown id", async () => {
    const [first] = await source.listBacklog();
    const one = await source.getBacklogItem(first!.frontmatter.id);
    expect(one.frontmatter.id).toBe(first!.frontmatter.id);
    await expect(source.getBacklogItem("bl-nope")).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("notes", () => {
  it("lists notes with their session ulid", async () => {
    const notes = await source.listNotes();
    expect(notes.length).toBeGreaterThan(0);
    for (const note of notes) {
      expect(typeof note.session).toBe("string");
      // api.md amendment: a note carries its position within its checkpoint.
      expect(Number.isInteger(note.index)).toBe(true);
    }
  });

  it("filters by type and by open", async () => {
    const decisions = await source.listNotes({ type: ["decision"] });
    expect(decisions.every((n) => n.type === "decision")).toBe(true);

    const two = await source.listNotes({ type: ["decision", "blocker"] });
    expect(two.every((n) => ["decision", "blocker"].includes(n.type))).toBe(true);

    const open = await source.listNotes({ open: true });
    expect(open.every((n) => n.resolved !== true)).toBe(true);

    // `open: false` must send no parameter at all; the server reads the key by presence.
    expect(await source.listNotes({ open: false })).toEqual(await source.listNotes());
  });
});

describe("brief and health", () => {
  it("returns the brief as text", async () => {
    const brief = await source.brief();
    expect(typeof brief).toBe("string");
    expect(brief.length).toBeGreaterThan(0);
  });

  it("honours max_tokens", async () => {
    const small = await source.brief(400);
    const large = await source.brief(4000);
    expect(small.length).toBeLessThanOrEqual(large.length);
  });

  it("maps a rejected budget onto the contract's 400", async () => {
    await expect(source.brief(1)).rejects.toMatchObject({ code: "bad_request", status: 400 });
  });

  it("returns the Health read model", async () => {
    const health = await source.health();
    expect(health.repo).toBe(harness.root);
    expect(typeof health.cli).toBe("string");
    expect(Array.isArray(health.harnesses)).toBe(true);
    expect(typeof health.index.bytes).toBe("number");
    expect(typeof health.config.valid).toBe("boolean");
  });
});

/**
 * `GET /api/identities` (docs/contracts/p5/config-and-identities.md), round-tripped through the
 * real server the way every other read in this file is: the file is written into the harness's
 * ledger, read back through the client, and removed again.
 */
describe("identities", () => {
  /** A function, not a constant: `harness` is only set once `beforeAll` has run. */
  const file = (): string => path.join(harnessLedger(), "identities.yaml");

  afterEach(() => {
    rmSync(file(), { force: true });
  });

  it("is empty for a repo with no identities file", async () => {
    expect(await source.listIdentities()).toEqual([]);
  });

  it("round-trips every row of the file, by email", async () => {
    writeFileSync(
      file(),
      [
        "schema_version: 1",
        "identities:",
        "  - { email: Grace@Example.com, name: Grace Hopper, dome_user: u_grace }",
        "  - { email: ada@example.com, name: Ada Lovelace, dome_user: null }",
        "",
      ].join("\n"),
      "utf8",
    );
    expect(await source.listIdentities()).toEqual([
      { email: "ada@example.com", name: "Ada Lovelace", dome_user: null },
      { email: "Grace@Example.com", name: "Grace Hopper", dome_user: "u_grace" },
    ]);
  });
});

describe("url plumbing", () => {
  it("normalizes a base url and refuses an empty one", () => {
    expect(normalizeBaseUrl("http://x/")).toBe("http://x");
    expect(normalizeBaseUrl("  http://x//  ")).toBe("http://x");
    expect(() => normalizeBaseUrl("   ")).toThrow(ApiClientError);
  });

  it("builds a query string, dropping undefined and escaping values", () => {
    expect(queryString({})).toBe("");
    expect(queryString({ a: undefined })).toBe("");
    expect(queryString({ q: "a b&c", limit: 2 })).toBe("?q=a%20b%26c&limit=2");
  });

  it("escapes an id into the path rather than letting it forge one", async () => {
    // `../health` would otherwise resolve to /api/health and return a 200 for a missing item.
    await expect(source.getBacklogItem("../health")).rejects.toMatchObject({ code: "not_found" });
  });

  it("reports a non-contract error body as http-<status>", async () => {
    const notJson = createSource("local", {
      baseUrl: harness.baseUrl,
      fetch: async () => ({
        ok: false,
        status: 502,
        json: () => Promise.reject(new Error("not json")),
        text: () => Promise.resolve("<html>bad gateway"),
      }),
    });
    await expect(notJson.health()).rejects.toMatchObject({ code: "http-502", status: 502 });
  });

  it("refuses an unknown source kind", () => {
    // `apps/web` reads the kind from config, so a typo has to fail loudly rather than return
    // a source whose every method rejects.
    expect(() => createSource("fixture" as "local", { baseUrl: harness.baseUrl })).toThrow(
      /unknown LedgerSource kind/,
    );
  });
});
