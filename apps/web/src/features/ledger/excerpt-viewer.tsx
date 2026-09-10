import { useCallback, useId, useState } from "react";

import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import { codeOf, messageOf } from "../../lib/errors.js";
import { useSource } from "../../lib/source-context.js";
import { formatCount } from "./format.js";

import type { Excerpt } from "../../lib/ledger-source.js";

/** The 404 of p3/api.md that is a *state*, not a fault: the file is simply not here any more. */
export const TRANSCRIPT_MISSING = "transcript_missing";

/** What that state says, verbatim, so the string cannot drift between the view and its test. */
export const TRANSCRIPT_GONE = "Transcript no longer on this machine.";

/**
 * The provenance excerpt viewer: the transcript span one checkpoint was written from.
 *
 * Collapsed until asked. The span is `[offset(n-1), offset(n))` of a file that can be tens of
 * megabytes, it is read off disk on demand, and a session detail with eight checkpoints must not
 * open eight of them — so this is a disclosure control and the read happens on the first
 * expansion, not on mount.
 *
 * What comes back is already redacted by the server: `Turn = { role, text, tools }`, where tool
 * inputs and outputs are *counted* and never returned (p3/api.md). This component therefore has no
 * branch that could render a tool payload, which is the point — the transcript never enters the
 * repo and the parts of it that carry secrets never even reach the browser.
 */
export function ExcerptViewer({ ulid, cp }: { ulid: string; cp: number }) {
  const source = useSource();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<
    { state: "idle" } | { state: "loading" } | { state: "error"; error: unknown } | { state: "ready"; value: Excerpt }
  >({ state: "idle" });
  const panelId = useId();
  const supported = source.capabilities.provenance;

  const load = useCallback(() => {
    setResult({ state: "loading" });
    source.excerpt(ulid, cp).then(
      (value) => setResult({ state: "ready", value }),
      (error: unknown) => setResult({ state: "error", error }),
    );
  }, [source, ulid, cp]);

  const toggle = useCallback(() => {
    setOpen((wasOpen) => {
      const next = !wasOpen;
      // Re-read on every expansion rather than caching: the file is append-only, but a repair or
      // an extraction can add a checkpoint between two clicks and move this span's upper bound.
      if (next) load();
      return next;
    });
  }, [load]);

  if (!supported) {
    return (
      <p className="text-xs text-muted-foreground">
        This source cannot read transcripts, so there is no span to show.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="w-fit"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={toggle}
      >
        {open ? "Hide transcript span" : "Show transcript span"}
      </Button>
      <div id={panelId} hidden={!open}>
        {open ? <Body result={result} /> : null}
      </div>
    </div>
  );
}

function Body({
  result,
}: {
  result:
    | { state: "idle" }
    | { state: "loading" }
    | { state: "error"; error: unknown }
    | { state: "ready"; value: Excerpt };
}) {
  if (result.state === "idle" || result.state === "loading") {
    return (
      <p role="status" className="text-xs text-muted-foreground">
        Reading the transcript…
      </p>
    );
  }
  if (result.state === "error") {
    const code = codeOf(result.error);
    if (code === TRANSCRIPT_MISSING) {
      return (
        <p role="status" className="text-xs text-muted-foreground">
          {TRANSCRIPT_GONE} The ledger keeps the digest; the file it was written from has been
          deleted or the session ran on another machine.
        </p>
      );
    }
    return (
      <p role="alert" className="text-xs text-destructive">
        Could not read the transcript span: {messageOf(result.error)}
      </p>
    );
  }

  const [from, to] = result.value.offset;
  return (
    <div className="flex flex-col gap-2">
      <p className="font-mono text-xs text-muted-foreground">
        bytes {formatCount(from)}–{formatCount(to)} ({formatCount(to - from)} read)
      </p>
      {result.value.turns.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          The span holds no user or assistant turns — only tool traffic, which is counted and never
          returned.
        </p>
      ) : (
        <ol className="flex flex-col gap-2" aria-label={`Transcript span for checkpoint ${String(result.value.cp)}`}>
          {result.value.turns.map((turn, index) => (
            <li
              key={index}
              className="flex flex-col gap-1 rounded-md border border-border bg-muted/40 p-2"
            >
              <span className="flex flex-wrap items-center gap-2">
                <Badge variant={turn.role === "user" ? "accent" : "secondary"}>{turn.role}</Badge>
                {turn.tools > 0 ? (
                  <span className="text-xs text-muted-foreground">
                    {formatCount(turn.tools)} tool {turn.tools === 1 ? "call" : "calls"}
                  </span>
                ) : null}
              </span>
              <p className="whitespace-pre-wrap break-words text-xs">{turn.text}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
