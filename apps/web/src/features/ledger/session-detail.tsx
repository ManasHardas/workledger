import { AsyncPanel } from "../../components/async-panel.js";
import { Badge } from "../../components/ui/badge.js";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card.js";
import type { ParsedSession } from "../../lib/ledger-source.js";
import { LEDGER_LIST_HREF } from "./detail-route.js";
import { cpMarker, formatInstant } from "./format.js";
import { useLiveSession } from "./live.js";
import { ProvenancePanel } from "./provenance-panel.js";

/**
 * One session in full: the four body sections the CLI writes — Goal, Done, Remaining, Notes — then
 * anything the parser could not classify, then where each line came from.
 *
 * Every line carries its `[cp n]` marker, because the checkpoint is what makes a ledger line
 * checkable against the transcript; without it a line is just a claim.
 */
export function SessionDetail({ ulid }: { ulid: string }) {
  const session = useLiveSession(ulid);

  return (
    <section aria-labelledby="ledger-heading" className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <a
          href={LEDGER_LIST_HREF}
          className="w-fit rounded-md text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          ← All sessions
        </a>
        <h2 id="ledger-heading" className="text-xl font-semibold">
          Session
        </h2>
      </div>
      <AsyncPanel result={session} empty="This session is no longer in the ledger.">
        {(value) => <SessionBody session={value} />}
      </AsyncPanel>
    </section>
  );
}

function SessionBody({ session }: { session: ParsedSession }) {
  const { frontmatter } = session;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={frontmatter.status === "open" ? "default" : "outline"}>
          {frontmatter.status}
        </Badge>
        <Badge variant="secondary">{frontmatter.harness}</Badge>
        <span className="text-xs text-muted-foreground">
          {frontmatter.author.name} · started {formatInstant(frontmatter.started)}
        </span>
      </div>

      <Section title="Goal">
        {session.goal.length === 0 ? (
          <Empty>No goal recorded.</Empty>
        ) : (
          <Lines>
            {session.goal.map((line, index) => (
              <Line key={`${line.cp}-${index}`} cp={line.cp}>
                {line.text}
              </Line>
            ))}
          </Lines>
        )}
      </Section>

      <Section title="Done">
        {session.done.length === 0 ? (
          <Empty>Nothing recorded as done yet.</Empty>
        ) : (
          <Lines>
            {session.done.map((line, index) => (
              <Line key={`${line.cp}-${index}`} cp={line.cp}>
                {line.text}
                {line.commit || line.files?.length || line.verified ? (
                  <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    {line.commit ? <span className="font-mono">{line.commit}</span> : null}
                    {line.files?.map((file) => (
                      <span key={file} className="font-mono">
                        {file}
                      </span>
                    ))}
                    {line.verified ? <span>{line.verified}</span> : null}
                  </span>
                ) : null}
              </Line>
            ))}
          </Lines>
        )}
      </Section>

      <Section title="Remaining">
        {session.remaining.length === 0 ? (
          <Empty>Nothing left open.</Empty>
        ) : (
          <Lines>
            {session.remaining.map((line, index) => (
              <Line key={`${line.cp}-${index}`} cp={line.cp}>
                {line.text}
                <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-mono">{`→ ${line.ref} (${line.rel})`}</span>
                  {line.blockedBy?.length ? (
                    <span>blocked by {line.blockedBy.join(", ")}</span>
                  ) : null}
                </span>
                {line.why ? (
                  <span className="mt-1 block text-xs text-muted-foreground">{line.why}</span>
                ) : null}
              </Line>
            ))}
          </Lines>
        )}
      </Section>

      <Section title="Notes">
        {session.notes.length === 0 ? (
          <Empty>No notes on this session.</Empty>
        ) : (
          <Lines>
            {session.notes.map((line, index) => (
              <Line key={`${line.cp}-${index}`} cp={line.cp}>
                <span className="mr-2 inline-flex">
                  <Badge variant={line.type === "blocker" ? "destructive" : "accent"}>
                    {line.type}
                  </Badge>
                </span>
                {line.text}
                {line.reason ? (
                  <span className="mt-1 block text-xs text-muted-foreground">{line.reason}</span>
                ) : null}
              </Line>
            ))}
          </Lines>
        )}
      </Section>

      {session.unparsed.length > 0 ? (
        <Section title="Unparsed">
          <p className="mb-2 text-xs text-muted-foreground">
            Lines the parser did not recognise. They are kept verbatim and re-emitted on the next
            write, so a hand edit is never deleted.
          </p>
          <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs text-muted-foreground">
            {session.unparsed.map((line) => `${line.section}: ${line.line}`).join("\n")}
          </pre>
        </Section>
      ) : null}

      <ProvenancePanel session={session} />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function Lines({ children }: { children: React.ReactNode }) {
  return <ul className="flex flex-col gap-3">{children}</ul>;
}

function Line({ cp, children }: { cp: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-2 text-sm">
      <span className="shrink-0 font-mono text-xs leading-5 text-muted-foreground">
        {cpMarker(cp)}
      </span>
      <span className="min-w-0 flex-1">{children}</span>
    </li>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}
