import { useEffect, useRef, useState } from "react";

import { Aside, useAsideDocked } from "../../components/aside.js";
import { RepairSheet } from "../jobs/repair-sheet.js";
import { useRepoId, useSource } from "../../lib/source-context.js";
import type { ParsedSession } from "../../lib/ledger-source.js";
import { detailHref } from "./detail-route.js";
import { dayHeading } from "./format.js";
import { LedgerAside, needsRepair } from "./ledger-aside.js";
import { SessionCard } from "./session-card.js";

export { needsRepair };

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

/** True when the keystroke landed on a focusable control that is not one of the list's cards. */
function isOtherControl(target: EventTarget | null, cards: readonly (HTMLElement | null)[]): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (cards.includes(target)) return false;
  return target.closest("a[href], button, [role='button'], summary, [tabindex]") !== null;
}

/**
 * The card list, in the order it is handed ({@link openFirst} for the Ledger), grouped by day,
 * with the `j`/`k` navigation of design spec §8 and the frame's selection model (`7:2`).
 *
 * With the right column docked there is a selection: it starts on the first card, a click or
 * focus moves it, `j`/`k` move it and focus that card, and the "Selected session" module beside
 * the list follows it. `Enter` or a double-click opens the selected session. Without the column
 * the module has nowhere to sit, so a card is simply a link again: `j`/`k` move a cursor that
 * starts nowhere and `Enter` opens it.
 *
 * Focus and the cursor are kept in step in both directions — tabbing onto a card makes it the
 * cursor — so the keyboard and the pointer never disagree about which session is selected.
 * Keystrokes are ignored while the search box or a filter has focus, so typing a `j` into search
 * stays a `j`.
 */
export function SessionList({ sessions }: { sessions: ParsedSession[] }) {
  const source = useSource();
  const repo = useRepoId();
  const docked = useAsideDocked();
  const [selected, setSelected] = useState<string | null>(null);
  const cards = useRef<(HTMLAnchorElement | null)[]>([]);

  // The selection is held by id, so a live re-read that reorders the list keeps it on the same
  // session; an id that has left the list falls back to the first card (docked) or to nothing.
  const found = selected === null ? -1 : sessions.findIndex((session) => session.frontmatter.id === selected);
  const cursor = found >= 0 ? found : docked && sessions.length > 0 ? 0 : -1;
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
        setSelected(sessions[clamped]!.frontmatter.id);
        cards.current[clamped]?.focus();
        return;
      }

      // Enter on some other control — a nav link, the module's own link, a Repair button — is
      // that control's, not a request to open the selected card.
      if (event.key === "Enter" && at >= 0 && !isOtherControl(event.target, cards.current)) {
        const session = sessions[at];
        if (!session) return;
        event.preventDefault();
        window.location.hash = detailHref(repo, session.frontmatter.id);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [sessions, repo]);

  // Grouping is presentational only: `j`/`k` still walk the flat order, so a burst of sessions
  // reads as a day without the keyboard skipping or restarting at each heading.
  const groups = groupByDay(sessions);
  const current = cursor >= 0 ? sessions[cursor] : undefined;
  let flat = -1;

  return (
    <>
      <div className="flex min-w-0 flex-col gap-6">
        {groups.map((group, g) => (
          <section key={`${String(g)}-${group.label}`} aria-labelledby={`ledger-day-${String(g)}`} className="flex min-w-0 flex-col gap-2.5">
            <h2 id={`ledger-day-${String(g)}`} className="text-xs font-medium leading-tight text-subtle-foreground">
              {group.label}
            </h2>
            <ul
              className="flex min-w-0 flex-col gap-2.5"
              aria-label={g === 0 ? "Sessions, open first then newest first" : `Sessions on ${group.label}`}
            >
              {group.sessions.map((session) => {
                flat += 1;
                const index = flat;
                const id = session.frontmatter.id;
                const open = () => {
                  window.location.hash = detailHref(repo, id);
                };
                return (
                  <li key={id} className="flex min-w-0 flex-col gap-2">
                    <SessionCard
                      session={session}
                      active={index === cursor}
                      onFocus={() => setSelected(id)}
                      onSelect={docked ? () => setSelected(id) : undefined}
                      onOpen={docked ? open : undefined}
                      ref={(node) => {
                        cards.current[index] = node;
                      }}
                    />
                    {/*
                      Undocked, the repair control sits beside the card and never inside it: the
                      card is one anchor, and a button nested in a link is neither clickable nor
                      reachable by keyboard in the way either element promises. Docked, it is in
                      the selected session's module instead.
                    */}
                    {!docked && source.capabilities.write && needsRepair(session) ? (
                      <RepairSheet session={id} label="Repair session…" />
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
      {current === undefined ? null : (
        <Aside narrow="none">
          <LedgerAside session={current} />
        </Aside>
      )}
    </>
  );
}

interface DayGroup {
  label: string;
  sessions: ParsedSession[];
}

/**
 * Split the list into day groups by {@link dayHeading} — `Today · 11 September`, `10 September`,
 * UTC calendar days — keeping the order it was handed. Open sessions sort first overall
 * ({@link openFirst}), so the first group is whatever day the newest work belongs to, and a day
 * can appear twice when an open session is older than an ended one.
 */
export function groupByDay(sessions: ParsedSession[], now: number = Date.now()): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const session of sessions) {
    const label = dayHeading(session.frontmatter.started, now);
    const last = groups[groups.length - 1];
    if (last !== undefined && last.label === label) last.sessions.push(session);
    else groups.push({ label, sessions: [session] });
  }
  return groups;
}
