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

/** True when the keystroke belongs to whatever the user is typing in, not to the list. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/**
 * The card list, newest first, with the `j`/`k` navigation of design spec §8.
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
    <ul className="flex flex-col gap-3" aria-label="Sessions, newest first">
      {sessions.map((session, index) => (
        <li key={session.frontmatter.id} className="flex flex-col gap-2">
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
            <RepairSheet session={session.frontmatter.id} label="Repair session…" />
          ) : null}
        </li>
      ))}
    </ul>
  );
}
