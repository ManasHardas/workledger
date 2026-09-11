import { useEffect, useRef, useState } from "react";

import { RepairSheet } from "../jobs/repair-sheet.js";
import { useRepoId, useSource } from "../../lib/source-context.js";
import type { ParsedSession } from "../../lib/ledger-source.js";
import { detailHref } from "./detail-route.js";
import { SessionCard } from "./session-card.js";

/**
 * A session the recovery queue has something to offer: its harness died before it checkpointed,
 * or a previous scan already flagged it. `repaired` is deliberately absent — that one is done.
 */
export function needsRepair(session: ParsedSession): boolean {
  return session.frontmatter.status === "crashed" || session.frontmatter.needs_repair;
}

/**
 * The open sessions first, then the rest, each newest first (amendment 11: no Open/All tabs —
 * "simply show the open ledgers at the top").
 *
 * A stable partition rather than a sort key, so the newest-first order `useLiveSessions` already
 * imposed survives inside each half, and so a session that ends while the page is open moves down
 * the list rather than out of it.
 */
export function openFirst(sessions: ParsedSession[]): ParsedSession[] {
  const open = sessions.filter((session) => session.frontmatter.status === "open");
  return open.length === 0 || open.length === sessions.length
    ? sessions
    : [...open, ...sessions.filter((session) => session.frontmatter.status !== "open")];
}

/** True when the keystroke belongs to whatever the user is typing in, not to the list. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/**
 * The card list, in the order it is handed ({@link openFirst} for the Ledger), with the `j`/`k`
 * navigation of design spec §8.
 *
 * `j` and `k` move a cursor down and up and focus that card; `Enter` opens it. Focus and the cursor
 * are kept in step in both directions — tabbing onto a card makes it the cursor — so the keyboard
 * and the pointer never disagree about which session is selected. Keystrokes are ignored while the
 * search box or a filter has focus, so typing a `j` into search stays a `j`.
 */
export function SessionList({ sessions }: { sessions: ParsedSession[] }) {
  const source = useSource();
  const repo = useRepoId();
  const [cursor, setCursor] = useState(-1);
  const cards = useRef<(HTMLAnchorElement | null)[]>([]);
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;

  useEffect(() => {
    cards.current.length = sessions.length;
  }, [sessions.length]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      if (sessions.length === 0) return;
      const at = cursorRef.current;

      if (event.key === "j" || event.key === "k") {
        const step = event.key === "j" ? 1 : -1;
        const next = at < 0 ? (step === 1 ? 0 : sessions.length - 1) : at + step;
        const clamped = Math.max(0, Math.min(sessions.length - 1, next));
        event.preventDefault();
        setCursor(clamped);
        cards.current[clamped]?.focus();
        return;
      }

      if (event.key === "Enter" && at >= 0) {
        const session = sessions[at];
        if (!session) return;
        event.preventDefault();
        window.location.hash = detailHref(repo, session.frontmatter.id);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [sessions, repo]);

  return (
    // A timeline: the posts run to both edges of the column, separated by hairlines.
    <ul
      className="-mx-4 flex flex-col divide-y divide-hairline border-y border-hairline"
      aria-label="Sessions, open first then newest first"
    >
      {sessions.map((session, index) => (
        <li key={session.frontmatter.id} className="flex flex-col">
          <SessionCard
            session={session}
            active={index === cursor}
            onFocus={() => setCursor(index)}
            ref={(node) => {
              cards.current[index] = node;
            }}
          />
          {/*
            The repair control sits beside the card and never inside it: the card is one anchor,
            and a button nested in a link is neither clickable nor reachable by keyboard in the way
            either element promises. It appears only where there is something to repair.
          */}
          {source.capabilities.write && needsRepair(session) ? (
            <div className="px-4 pb-3">
              <RepairSheet session={session.frontmatter.id} label="Repair session…" />
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
