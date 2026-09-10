/**
 * `LedgerSource` — the app's only data dependency (`docs/contracts/p2/ledger-source.md`).
 *
 * The contract's home is `packages/api-client`. This module is the thin seam the scaffold
 * promised: it re-exports the contract verbatim and adds nothing to it, so a view that needs a
 * new call needs a contract amendment first, not a local method.
 *
 * It also owns the choice of *which* source the app runs on. `createSource("local", …)` is the
 * api-client's `LocalServerSource` talking to `workledger serve`; `createSource("fixture")` is the
 * in-memory ledger of `./fixtures.ts`, kept because it is read-only and not live, which exercises
 * the same degraded paths a Dome card runs in (design spec §14.2) — no view may assume writes or
 * SSE are available.
 */
import { createSource as createApiSource } from "@workledger/api-client";

import {
  FIXTURE_BACKLOG,
  FIXTURE_BRIEF,
  FIXTURE_HEALTH,
  FIXTURE_NOTES,
  FIXTURE_SESSIONS,
} from "./fixtures.js";

import type {
  BacklogStatus,
  BacklogView,
  Health,
  LedgerSource,
  NoteRef,
  NoteType,
  ParsedSession,
  SessionQuery,
} from "@workledger/api-client";

export type {
  Actor,
  BacklogStatus,
  BacklogView,
  DoctorEntry,
  EditPatch,
  Health,
  LedgerEvent,
  LedgerSource,
  NoteRef,
  NoteType,
  ParsedSession,
  SessionQuery,
} from "@workledger/api-client";

/** The rejection every write takes on a source whose `capabilities.write` is false. */
const readOnly = <T>(): Promise<T> => Promise.reject({ code: "read-only" });

/** The in-memory fixture ledger: read-only, not live. */
export function createSource(kind: "fixture"): LedgerSource;
/** `workledger serve` over HTTP + SSE. `baseUrl` is `""` when the server hosts the app. */
export function createSource(kind: "local", opts: { baseUrl: string }): LedgerSource;
export function createSource(kind: "fixture" | "local", opts?: { baseUrl: string }): LedgerSource {
  if (kind === "fixture") return new FixtureSource();
  return createApiSource("local", { baseUrl: opts?.baseUrl ?? "" });
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
        session.goal ?? "",
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
  start = readOnly<BacklogView>;
  restore = readOnly<BacklogView>;
  edit = readOnly<BacklogView>;
  assign = readOnly<BacklogView>;
  rank = readOnly<BacklogView>;
  merge = readOnly<{ source: BacklogView; target: BacklogView }>;
  resolveNote = readOnly<ParsedSession>;

  subscribe(): () => void {
    return () => {};
  }
}
