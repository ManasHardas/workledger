import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card.js";
import type { ParsedSession } from "../../lib/ledger-source.js";
import { cpMarker, formatCount, formatInstant } from "./format.js";

/**
 * The promise this panel makes about the transcript, verbatim in one place so it cannot drift
 * between the empty state and the populated one.
 */
export const TRANSCRIPT_NOTICE =
  "Transcript excerpt viewer arrives in P3; the transcript stays on this machine.";

/**
 * Where every line above came from: one row per checkpoint, carrying exactly the four fields the
 * frozen `Checkpoint` schema records — `at`, `turns`, `transcript_offset` and `trigger`.
 *
 * The span for checkpoint `n` is `[offset(n-1), offset(n))`, so the offsets are shown as the byte
 * range they delimit. Design spec §8 has this panel open the transcript itself; P2 ships the
 * metadata only, and says so rather than rendering a dead control.
 */
export function ProvenancePanel({ session }: { session: ParsedSession }) {
  const { checkpoints } = session.frontmatter;

  return (
    <Card className="border-dashed">
      <CardHeader>
        <CardTitle>Provenance</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {checkpoints.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No checkpoints recorded for this session yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {checkpoints.map((checkpoint, index) => {
              const from = checkpoints[index - 1]?.transcript_offset ?? 0;
              return (
                <li
                  key={checkpoint.n}
                  className="flex flex-col gap-1 border-l-2 border-border pl-3 text-sm"
                >
                  <span className="font-mono text-xs text-muted-foreground">
                    {cpMarker(checkpoint.n)}
                  </span>
                  <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
                    <Field label="at" value={formatInstant(checkpoint.at)} />
                    <Field label="turns" value={formatCount(checkpoint.turns)} />
                    <Field
                      label="transcript_offset"
                      value={`${formatCount(from)}–${formatCount(checkpoint.transcript_offset)} bytes`}
                    />
                    <Field label="trigger" value={checkpoint.trigger} />
                  </dl>
                </li>
              );
            })}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">{TRANSCRIPT_NOTICE}</p>
      </CardContent>
    </Card>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-mono text-foreground">{value}</dd>
    </div>
  );
}
