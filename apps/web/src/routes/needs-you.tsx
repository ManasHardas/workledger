import { useCallback } from "react";

import { AsyncPanel } from "../components/async-panel.js";
import { Badge } from "../components/ui/badge.js";
import { Button } from "../components/ui/button.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card.js";
import { useSource } from "../lib/source-context.js";
import { useAsync } from "../lib/use-async.js";

/** Needs you — open `question` and `blocker` notes across sessions (design spec §8). */
export function NeedsYouView() {
  const source = useSource();
  const notes = useAsync(
    useCallback(() => source.listNotes({ type: ["question", "blocker"], open: true }), [source]),
  );

  return (
    <section aria-labelledby="needs-you-heading" className="flex flex-col gap-4">
      <h2 id="needs-you-heading" className="text-xl font-semibold">
        Needs you
      </h2>
      <AsyncPanel
        result={notes}
        isEmpty={(list) => list.length === 0}
        empty="Nothing is waiting on you. Open questions and blockers appear here."
      >
        {(list) => (
          <ul className="flex flex-col gap-3">
            {list.map((note) => (
              <li key={`${note.session}-${note.cp}-${note.text}`}>
                <Card>
                  <CardHeader>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={note.type === "blocker" ? "destructive" : "accent"}>
                        {note.type}
                      </Badge>
                      <CardDescription>
                        {note.session} · cp {note.cp}
                      </CardDescription>
                    </div>
                    <CardTitle>{note.text}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Button size="sm" variant="outline" disabled={!source.capabilities.write}>
                      Resolve
                    </Button>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </AsyncPanel>
    </section>
  );
}
