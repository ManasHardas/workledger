/**
 * `LedgerSource` — the app's only data dependency (`docs/contracts/p2/ledger-source.md`).
 *
 * The contract's home is `packages/api-client`, which is issue #35 and not merged yet. The
 * interface below is that contract transcribed verbatim so this scaffold can be built and reviewed
 * against it; when #35 lands, issues #37–#39 delete the local copy and re-export it:
 *
 * ```ts
 * export type { LedgerSource, LedgerEvent, SessionQuery, EditPatch } from "@workledger/api-client";
 * export { createSource } from "@workledger/api-client";
 * ```
 *
 * Nothing outside this module may widen the interface — a view that needs a new call needs a
 * contract amendment first, not a local method.
 */
import {
  FIXTURE_BACKLOG,
  FIXTURE_BRIEF,
  FIXTURE_HEALTH,
  FIXTURE_NOTES,
  FIXTURE_SESSIONS,
} from "./fixtures.js";

import type {
  Actor,
  BacklogItem,
  BacklogStatus,
  Harness,
  NoteLine,
  NoteType,
  ParsedSession,
} from "@workledger/core";

export type { ParsedSession, BacklogStatus, NoteType, Actor };

/** `parseItem`'s output: frozen frontmatter plus the markdown body (api.md §Read models). */
export interface BacklogView {
  frontmatter: BacklogItem;
  body: string;
}

/**
 * A `## Notes` line carrying the ulid of the session it was read from and, since the 2026-09-09
 * amendment to `docs/contracts/p2/api.md`, its `index` — the note's 0-based position among the
 * notes of **its own checkpoint**, in file order. That pair is what `resolveNote` names a note by
 * (`docs/contracts/p2/backlog-cli.md`), and no position in a filtered list reproduces it, so the
 * server sends it rather than leaving the UI to reconstruct it from the session.
 */
export type NoteRef = NoteLine & { session: string; index: number; resolved?: boolean };

/** One harness row of `workledger doctor`, as `/api/health` returns it. */
export interface DoctorEntry {
  harness: Harness;
  hooksInstalled: boolean;
  lastSeenAt: string | null;
  problems: string[];
}

export interface Health {
  cli: string;
  repo: string;
  harnesses: DoctorEntry[];
  index: { path: string; bytes: number; openSessions: number };
  config: { valid: boolean; problems: string[] };
  lastHookAt: string | null;
}

export type LedgerEvent =
  | { type: "session.changed"; ulid: string }
  | { type: "backlog.changed"; id: string }
  | { type: "notes.changed" }
  | { type: "health.changed" };

export type SessionQuery = {
  author?: string;
  harness?: string;
  status?: string;
  since?: string;
  q?: string;
  limit?: number;
};

export type EditPatch = {
  title?: string;
  body?: string;
  priority?: "p1" | "p2" | "p3" | null;
  area?: string[];
};

export interface LedgerSource {
  readonly capabilities: { write: boolean; live: boolean; provenance: boolean };
  listSessions(q?: SessionQuery): Promise<ParsedSession[]>;
  getSession(ulid: string): Promise<ParsedSession>;
  listBacklog(q?: { status?: BacklogStatus[] }): Promise<BacklogView[]>;
  getBacklogItem(id: string): Promise<BacklogView>;
  listNotes(q?: { type?: NoteType[]; open?: boolean }): Promise<NoteRef[]>;
  brief(maxTokens?: number): Promise<string>;
  health(): Promise<Health>;
  // writes: reject with { code: "read-only" } when capabilities.write is false
  accept(id: string): Promise<BacklogView>;
  discard(id: string): Promise<BacklogView>;
  done(id: string): Promise<BacklogView>;
  edit(id: string, patch: EditPatch): Promise<BacklogView>;
  assign(id: string, owner: Actor | null): Promise<BacklogView>;
  rank(id: string, rank: number): Promise<BacklogView>;
  merge(id: string, into: string): Promise<{ source: BacklogView; target: BacklogView }>;
  resolveNote(
    ref: { session: string; cp: number; index: number },
    decision: string,
  ): Promise<ParsedSession>;
  // live: no-op unsubscribe when capabilities.live is false
  subscribe(handler: (event: LedgerEvent) => void): () => void;
}

/** The rejection every write takes on a source whose `capabilities.write` is false. */
const readOnly = <T>(): Promise<T> => Promise.reject({ code: "read-only" });

/**
 * The only source this scaffold ships: the fixtures in `./fixtures.ts`, served from memory.
 *
 * It exists so the shell's four views can be built and tested before the server does — it is
 * read-only and not live, which exercises the same degraded paths a Dome card runs in
 * (design spec §14.2), so no view may assume writes or SSE are available.
 */
export function createSource(kind: "fixture"): LedgerSource {
  if (kind !== "fixture") throw new Error(`unknown LedgerSource kind: ${kind}`);
  return new FixtureSource();
}

class FixtureSource implements LedgerSource {
  readonly capabilities = { write: false, live: false, provenance: false };

  async listSessions(q?: SessionQuery): Promise<ParsedSession[]> {
    const needle = q?.q?.toLowerCase();
    const matches = FIXTURE_SESSIONS.filter((session) => {
      if (q?.status && session.frontmatter.status !== q.status) return false;
      if (q?.harness && session.frontmatter.harness !== q.harness) return false;
      if (!needle) return true;
      const haystack = [
        ...session.goal.map((line) => line.text),
        ...session.done.map((line) => line.text),
        ...session.remaining.map((line) => line.text),
        ...session.notes.map((line) => line.text),
      ];
      return haystack.some((text) => text.toLowerCase().includes(needle));
    });
    return matches.slice(0, q?.limit ?? 100);
  }

  async getSession(ulid: string): Promise<ParsedSession> {
    const found = (await this.listSessions()).find((s) => s.frontmatter.id === ulid);
    if (!found) throw Object.assign(new Error(`no session ${ulid}`), { code: "not-found" });
    return found;
  }

  async listBacklog(q?: { status?: BacklogStatus[] }): Promise<BacklogView[]> {
    const wanted = q?.status ?? (["proposed", "accepted", "in_progress", "done"] as BacklogStatus[]);
    return FIXTURE_BACKLOG.filter((item) => wanted.includes(item.frontmatter.status)).sort(
      (a, b) => a.frontmatter.rank - b.frontmatter.rank,
    );
  }

  async getBacklogItem(id: string): Promise<BacklogView> {
    const found = (await this.listBacklog()).find((item) => item.frontmatter.id === id);
    if (!found) throw Object.assign(new Error(`no backlog item ${id}`), { code: "not-found" });
    return found;
  }

  async listNotes(q?: { type?: NoteType[]; open?: boolean }): Promise<NoteRef[]> {
    return FIXTURE_NOTES.filter((note) => {
      if (q?.type && !q.type.includes(note.type)) return false;
      if (q?.open && note.resolved) return false;
      return true;
    });
  }

  async brief(): Promise<string> {
    return FIXTURE_BRIEF;
  }

  async health(): Promise<Health> {
    return FIXTURE_HEALTH;
  }

  accept = readOnly<BacklogView>;
  discard = readOnly<BacklogView>;
  done = readOnly<BacklogView>;
  edit = readOnly<BacklogView>;
  assign = readOnly<BacklogView>;
  rank = readOnly<BacklogView>;
  merge = readOnly<{ source: BacklogView; target: BacklogView }>;
  resolveNote = readOnly<ParsedSession>;

  subscribe(): () => void {
    return () => {};
  }
}
