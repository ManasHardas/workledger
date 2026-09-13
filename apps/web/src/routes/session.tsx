import { PageBody } from "../components/ui/page.js";
import { useDetailUlid } from "../features/ledger/detail-route.js";
import { useLiveSessions } from "../features/ledger/live.js";
import { SessionDetail, SessionHeader } from "../features/ledger/session-detail.js";
import { openFirst } from "../features/ledger/session-list.js";
import { useRepoId } from "../lib/source-context.js";

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
  const repo = useRepoId();

  if (sessions.state === "ready") {
    const latest = openFirst(sessions.value)[0];
    if (latest !== undefined) return <SessionDetail ulid={latest.frontmatter.id} />;
  }

  return (
    <>
      <SessionHeader repo={repo} name={null} />
      <PageBody rhythm="session">
        {sessions.state === "loading" ? (
          <p role="status" className="text-base leading-body tracking-body text-muted-foreground">
            Loading…
          </p>
        ) : sessions.state === "error" ? (
          <p role="alert" className="text-base leading-body tracking-body text-destructive">
            Could not read the sessions: {sessions.message}
          </p>
        ) : (
          <div className="flex flex-col gap-2.5">
            <h1 className="text-xl font-semibold leading-title tracking-title text-foreground">Session</h1>
            <p className="text-base leading-body tracking-body text-muted-foreground">
              No sessions yet. Run an agent in this project and its first checkpoint lands here.
            </p>
          </div>
        )}
      </PageBody>
    </>
  );
}
