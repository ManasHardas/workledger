import { useEffect, useState } from "react";

import { Badge } from "../../components/ui/badge.js";
import { codeOf, messageOf } from "../../lib/errors.js";
import { useSource } from "../../lib/source-context.js";
import { formatCount } from "./format.js";

import type { Excerpt } from "../../lib/ledger-source.js";

/** The 404 of p3/api.md that is a *state*, not a fault: the file is simply not here any more. */
export const TRANSCRIPT_MISSING = "transcript_missing";

/** What that state says, verbatim, so the string cannot drift between the view and its test. */
export const TRANSCRIPT_GONE = "Transcript no longer on this machine.";

/** What an excerpt read has come to. */
type ExcerptResult =
  | { state: "loading" }
  | { state: "error"; error: unknown }
  | { state: "ready"; value: Excerpt };

/**
 * The provenance excerpt: the transcript span one checkpoint was written from.
 *
 * Mounted only while its checkpoint row in the Provenance module is expanded, and it reads on
 * mount. The span is `[offset(n-1), offset(n))` of a file that can be tens of megabytes, it is read
 * off disk on demand, and a session with eight checkpoints must not open eight of them — so the row
 * is a disclosure control and the read happens on expansion, not when the page loads. Collapsing
 * unmounts it, so the next expansion re-reads rather than replaying a cache: the file is
 * append-only, but a repair or an extraction can add a checkpoint between two clicks and move this
 * span's upper bound.
 *
 * What comes back is already redacted by the server: `Turn = { role, text, tools }`, where tool
 * inputs and outputs are *counted* and never returned (p3/api.md). This component therefore has no
 * branch that could render a tool payload, which is the point — the transcript never enters the
 * repo and the parts of it that carry secrets never even reach the browser.
 */
export function ExcerptSpan({ ulid, cp }: { ulid: string; cp: number }) {
  const source = useSource();
  const [result, setResult] = useState<ExcerptResult>({ state: "loading" });

  useEffect(() => {
    let live = true;
    source.excerpt(ulid, cp).then(
      (value) => {
        if (live) setResult({ state: "ready", value });
      },
      (error: unknown) => {
        if (live) setResult({ state: "error", error });
      },
    );
    return () => {
      live = false;
    };
  }, [source, ulid, cp]);

  return <Body result={result} />;
}

function Body({ result }: { result: ExcerptResult }) {
  if (result.state === "loading") {
    return (
      <p role="status" className="text-xs leading-tight text-muted-foreground">
        Reading the transcript…
      </p>
    );
  }
  if (result.state === "error") {
    const code = codeOf(result.error);
    if (code === TRANSCRIPT_MISSING) {
      return (
        <p role="status" className="text-xs leading-tight text-muted-foreground">
          {TRANSCRIPT_GONE} The ledger keeps the digest; the file it was written from has been
          deleted or the session ran on another machine.
        </p>
      );
    }
    return (
      <p role="alert" className="text-xs leading-tight text-destructive">
        Could not read the transcript span: {messageOf(result.error)}
      </p>
    );
  }

  const [from, to] = result.value.offset;
  return (
    <div className="flex flex-col gap-2">
      <p className="font-mono text-xs leading-tight text-subtle-foreground">
        bytes {formatCount(from)}–{formatCount(to)} ({formatCount(to - from)} read)
      </p>
      {result.value.turns.length === 0 ? (
        <p className="text-xs leading-tight text-muted-foreground">
          The span holds no user or assistant turns — only tool traffic, which is counted and never
          returned.
        </p>
      ) : (
        <ol className="flex flex-col gap-2" aria-label={`Transcript span for checkpoint ${String(result.value.cp)}`}>
          {result.value.turns.map((turn, index) => (
            <li
              key={index}
              className="flex flex-col gap-1.5 rounded-lg border border-hairline bg-background p-2.5"
            >
              <span className="flex flex-wrap items-center gap-2">
                <Badge variant={turn.role === "user" ? "accent" : "secondary"}>{turn.role}</Badge>
                {turn.tools > 0 ? (
                  <span className="text-xs leading-tight text-muted-foreground">
                    {formatCount(turn.tools)} tool {turn.tools === 1 ? "call" : "calls"}
                  </span>
                ) : null}
              </span>
              <p className="whitespace-pre-wrap break-words text-xs leading-tight text-foreground">{turn.text}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
