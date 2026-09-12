import { useDetailUlid } from "../features/ledger/detail-route.js";
import { useLiveSessions } from "../features/ledger/live.js";
import { SessionDetail } from "../features/ledger/session-detail.js";
import { openFirst } from "../features/ledger/session-list.js";

/**
 * Session — one session's activities (P9, operator: "Session is the view of per session
 * activities").
 *
 * `#/r/<id>/session/<ulid>` names one; `#/r/<id>/session` names none, and the nav links here, so
 * the view has to answer "which session?" itself. It answers the way a person means it: the one
 * you are most likely to be asking about — the repo's most recent, open sessions first, which is
 * the same `openFirst` order the Ledger list shows.
 *
 * The empty query is deliberate: picking the latest session must not inherit whatever filters the
 * Ledger list happens to be holding, or the nav item would lead somewhere different depending on a
 * control on another screen.
 */
export function SessionView() {
  const ulid = useDetailUlid();
  if (ulid !== null) return <SessionDetail ulid={ulid} />;
  return <LatestSession />;
}

function LatestSession() {
  const sessions = useLiveSessions({});

  if (sessions.state === "loading") {
    return (
      <p role="status" className="p-4 text-sm text-muted-foreground">
        Loading…
      </p>
    );
  }
  if (sessions.state === "error") {
    return (
      <p role="alert" className="p-4 text-sm text-destructive">
        Could not read the sessions: {sessions.message}
      </p>
    );
  }

  const latest = openFirst(sessions.value)[0];
  if (latest === undefined) {
    return (
      <section aria-labelledby="session-heading" className="flex flex-col gap-4">
        <h2 id="session-heading" className="text-xl font-extrabold">
          Session
        </h2>
        <p className="p-4 text-sm text-muted-foreground">
          No sessions yet. Run an agent in this project and its first checkpoint lands here.
        </p>
      </section>
    );
  }
  return <SessionDetail ulid={latest.frontmatter.id} />;
}
