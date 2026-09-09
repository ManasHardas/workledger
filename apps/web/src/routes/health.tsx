import { useCallback } from "react";

import { AsyncPanel } from "../components/async-panel.js";
import { Badge } from "../components/ui/badge.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card.js";
import { useSource } from "../lib/source-context.js";
import { useAsync } from "../lib/use-async.js";

/** Health — per harness, last hook seen, hooks present, CLI version, index size (design spec §8). */
export function HealthView() {
  const source = useSource();
  const health = useAsync(useCallback(() => source.health(), [source]));

  return (
    <section aria-labelledby="health-heading" className="flex flex-col gap-4">
      <h2 id="health-heading" className="text-xl font-semibold">
        Health
      </h2>
      <AsyncPanel result={health} empty="No health report available.">
        {(report) => (
          <div className="flex flex-col gap-3">
            <Card>
              <CardHeader>
                <CardTitle>{report.repo}</CardTitle>
                <CardDescription>
                  CLI {report.cli} · index {Math.round(report.index.bytes / 1024)} KB ·{" "}
                  {report.index.openSessions} open
                </CardDescription>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                Last hook seen {report.lastHookAt ?? "never"}
              </CardContent>
            </Card>
            <ul className="flex flex-col gap-3">
              {report.harnesses.map((entry) => (
                <li key={entry.harness}>
                  <Card>
                    <CardHeader>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={entry.hooksInstalled ? "default" : "warning"}>
                          {entry.hooksInstalled ? "hooks installed" : "hooks missing"}
                        </Badge>
                        <CardDescription>last seen {entry.lastSeenAt ?? "never"}</CardDescription>
                      </div>
                      <CardTitle>{entry.harness}</CardTitle>
                    </CardHeader>
                    {entry.problems.length > 0 ? (
                      <CardContent className="text-sm text-destructive">
                        {entry.problems.join("; ")}
                      </CardContent>
                    ) : null}
                  </Card>
                </li>
              ))}
            </ul>
          </div>
        )}
      </AsyncPanel>
    </section>
  );
}
