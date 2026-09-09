import { useCallback } from "react";

import { AsyncPanel } from "../components/async-panel.js";
import { Badge } from "../components/ui/badge.js";
import { Button } from "../components/ui/button.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card.js";
import type { BacklogStatus, BacklogView } from "../lib/ledger-source.js";
import { useSource } from "../lib/source-context.js";
import { useAsync } from "../lib/use-async.js";

/** The status groups the list renders in, in the order design spec §8 lists them. */
const GROUPS: BacklogStatus[] = ["proposed", "accepted", "in_progress", "done"];

/** Next — the repo's backlog, grouped by status. Editing arrives with issue #38. */
export function NextView() {
  const source = useSource();
  const backlog = useAsync(useCallback(() => source.listBacklog(), [source]));
  const canWrite = source.capabilities.write;

  return (
    <section aria-labelledby="next-heading" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="next-heading" className="text-xl font-semibold">
          Next
        </h2>
        {canWrite ? null : <Badge variant="outline">read-only source</Badge>}
      </div>
      <AsyncPanel
        result={backlog}
        isEmpty={(items) => items.length === 0}
        empty="The backlog is empty. Agent-proposed items appear here as checkpoints land."
      >
        {(items) => (
          <div className="flex flex-col gap-6">
            {GROUPS.filter((status) => items.some((i) => i.frontmatter.status === status)).map(
              (status) => (
                <div key={status} className="flex flex-col gap-3">
                  <h3 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
                    {status.replace("_", " ")}
                  </h3>
                  <ul className="flex flex-col gap-3">
                    {items
                      .filter((item) => item.frontmatter.status === status)
                      .map((item) => (
                        <li key={item.frontmatter.id}>
                          <BacklogCard item={item} canWrite={canWrite} />
                        </li>
                      ))}
                  </ul>
                </div>
              ),
            )}
          </div>
        )}
      </AsyncPanel>
    </section>
  );
}

function BacklogCard({ item, canWrite }: { item: BacklogView; canWrite: boolean }) {
  const { frontmatter } = item;
  const unconfirmed = !frontmatter.confirmed_by;
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          {frontmatter.priority ? <Badge variant="accent">{frontmatter.priority}</Badge> : null}
          {unconfirmed ? <Badge variant="warning">agent-proposed</Badge> : null}
          {frontmatter.area.map((area) => (
            <Badge key={area} variant="outline">
              {area}
            </Badge>
          ))}
        </div>
        <CardTitle>{frontmatter.title}</CardTitle>
        <CardDescription>{frontmatter.id}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">{item.body}</p>
        <Button size="sm" variant="outline" disabled={!canWrite}>
          {unconfirmed ? "Accept" : "Done"}
        </Button>
      </CardContent>
    </Card>
  );
}
