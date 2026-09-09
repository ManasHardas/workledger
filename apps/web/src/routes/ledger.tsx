import { useCallback, useState } from "react";

import { AsyncPanel } from "../components/async-panel.js";
import { Badge } from "../components/ui/badge.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card.js";
import { Input } from "../components/ui/input.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs.js";
import type { ParsedSession } from "../lib/ledger-source.js";
import { useSource } from "../lib/source-context.js";
import { useAsync } from "../lib/use-async.js";

const SCOPES = [
  { id: "open", label: "Open", status: "open" as const },
  { id: "all", label: "All", status: undefined },
];

/** Ledger — session cards over time, with the full-text search of design spec §8. */
export function LedgerView() {
  const source = useSource();
  const [scope, setScope] = useState(SCOPES[0]!.id);
  const [q, setQ] = useState("");
  const status = SCOPES.find((s) => s.id === scope)?.status;
  const sessions = useAsync(
    useCallback(() => source.listSessions({ status, q: q || undefined }), [source, status, q]),
  );

  return (
    <section aria-labelledby="ledger-heading" className="flex flex-col gap-4">
      <h2 id="ledger-heading" className="text-xl font-semibold">
        Ledger
      </h2>
      <Tabs value={scope} onValueChange={setScope} className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <TabsList aria-label="Session scope">
            {SCOPES.map((s) => (
              <TabsTrigger key={s.id} value={s.id}>
                {s.label}
              </TabsTrigger>
            ))}
          </TabsList>
          <Input
            type="search"
            aria-label="Search sessions"
            placeholder="Search goals, items and notes"
            value={q}
            onChange={(event) => setQ(event.target.value)}
            className="sm:max-w-xs"
          />
        </div>
        {SCOPES.map((s) => (
          <TabsContent key={s.id} value={s.id} className="flex flex-col gap-3">
            <AsyncPanel
              result={sessions}
              isEmpty={(list) => list.length === 0}
              empty="No sessions match. Run an agent in an enabled repo and checkpoints land here."
            >
              {(list) => (
                <ul className="flex flex-col gap-3">
                  {list.map((session) => (
                    <li key={session.frontmatter.id}>
                      <SessionCard session={session} />
                    </li>
                  ))}
                </ul>
              )}
            </AsyncPanel>
          </TabsContent>
        ))}
      </Tabs>
    </section>
  );
}

function SessionCard({ session }: { session: ParsedSession }) {
  const { frontmatter } = session;
  const latestDone = session.done.at(-1);
  const latestRemaining = session.remaining.at(-1);
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={frontmatter.status === "open" ? "default" : "outline"}>
            {frontmatter.status}
          </Badge>
          <Badge variant="secondary">{frontmatter.harness}</Badge>
          <CardDescription>
            {frontmatter.checkpoints.length} checkpoints · {frontmatter.author.name}
          </CardDescription>
        </div>
        <CardTitle>{session.goal[0]?.text ?? "No goal recorded"}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        {latestDone ? (
          <p>
            <span className="text-muted-foreground">Done · </span>
            {latestDone.text}
          </p>
        ) : null}
        {latestRemaining ? (
          <p>
            <span className="text-muted-foreground">Remaining · </span>
            {latestRemaining.text}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
