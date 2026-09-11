import { useState } from "react";

import { AsyncPanel } from "../../components/async-panel.js";
import { RepairSheet } from "../jobs/repair-sheet.js";
import { useRepoId, useSource } from "../../lib/source-context.js";
import { Badge } from "../../components/ui/badge.js";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card.js";
import { Panel } from "../../components/ui/panel.js";
import { commitHref, editorHref, fileHref } from "../../lib/ledger-source.js";
import type {
  EditorScheme,
  Line as DoneLine,
  NoteLine,
  ParsedSession,
  RepoRemote,
  Verified,
} from "../../lib/ledger-source.js";
import { ledgerListHref } from "./detail-route.js";
import { cpMarker, formatInstant } from "./format.js";
import { useLiveSession } from "./live.js";
import { ProvenancePanel } from "./provenance-panel.js";

/**
 * One session in full: the four body sections the CLI writes — Goal, Done, Remaining, Notes — then
 * Memory when the session committed anything to a memory file, anything the parser could not
 * classify, and where each line came from.
 *
 * Every line carries its `[cp n]` marker, because the checkpoint is what makes a ledger line
 * checkable against the transcript; without it a line is just a claim.
 *
 * Amendment 11 (docs/contracts/p8/daemon-and-api.md): the page is for the human. Done shows the
 * gist of each item and nothing else; the specifics — detail, commit, files, verified — wait in a
 * side drawer until an item is opened. Discovery notes are written for the next agent, so they sit
 * behind a disclosure; blocker, question and decision are the ones a person acts on.
 */
export function SessionDetail({ ulid }: { ulid: string }) {
  const session = useLiveSession(ulid);
  const repo = useRepoId();

  return (
    <section
      aria-labelledby="ledger-heading"
      className="flex w-full max-w-[var(--wl-spacing-reading)] flex-col gap-4"
    >
      <div className="flex flex-col gap-2">
        <a
          href={ledgerListHref(repo)}
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

/** The last path segment: a session is about `card-shopify_store`, not about a whole absolute path. */
function repoName(root: string): string {
  return root.split("/").filter((part) => part !== "").at(-1) ?? root;
}

/** The note types a person reads by default; everything else is `For agents`. */
const HUMAN_NOTE_TYPES: ReadonlySet<NoteLine["type"]> = new Set(["blocker", "question", "decision"]);

function SessionBody({ session }: { session: ParsedSession }) {
  const { frontmatter } = session;
  const source = useSource();
  /** The Done item whose drawer is open, by position — two items may share a gist. */
  const [openDone, setOpenDone] = useState<number | null>(null);

  const humanNotes = session.notes.filter((line) => HUMAN_NOTE_TYPES.has(line.type));
  const agentNotes = session.notes.filter((line) => !HUMAN_NOTE_TYPES.has(line.type));
  const memory = session.memory ?? [];
  const opened = openDone === null ? null : (session.done[openDone] ?? null);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={frontmatter.status === "open" ? "default" : "outline"}>
          {frontmatter.status}
        </Badge>
        <Badge variant="secondary">{frontmatter.harness}</Badge>
        {/*
          `break-all` and a minimum of nothing: `started in` and `about` are absolute paths, which
          have no space to wrap at, and rule 5 says nothing in the middle pane scrolls sideways at
          375 px.
        */}
        <span className="min-w-0 break-all text-xs text-muted-foreground">
          {frontmatter.author.name} · started {formatInstant(frontmatter.started)}
          {/*
            Two facts the ledger keeps apart (P8 amendment 10): where the harness was launched,
            which only says where the transcript lives, and which repos the session is about,
            which is why it is in this ledger. Older sessions recorded neither.
          */}
          {session.startedIn !== null ? ` · started in ${session.startedIn}` : ""}
          {session.about.length > 0 ? ` · about ${session.about.map(repoName).join(", ")}` : ""}
        </span>
        {/*
          Repair is a write, so it is absent — not disabled — on a source that cannot write: a
          Dome card has no queue to put the job in, and a control that could only ever refuse is
          worse than no control (design spec §14.2).
        */}
        {source.capabilities.write ? (
          <span className="ml-auto">
            <RepairSheet session={frontmatter.id} />
          </span>
        ) : null}
      </div>

      {/*
        The goal carries no `[cp n]` marker: the wire's `goal` is the single current string
        (api.md §Read models), not the list of lines core parses, so there is no checkpoint to
        attribute it to.
      */}
      <Section title="Goal">
        {session.goal === null ? <Empty>No goal recorded.</Empty> : <p className="text-sm">{session.goal}</p>}
      </Section>

      <Section title="Done">
        {session.done.length === 0 ? (
          <Empty>Nothing recorded as done yet.</Empty>
        ) : (
          <Lines>
            {session.done.map((line, index) => (
              <Line key={`${line.cp}-${index}`} cp={line.cp}>
                {/*
                  A real button, so Enter and Space open it, it is in the tab order, and a screen
                  reader announces it as something that does something — none of which a `<li>`
                  with an onClick would give.
                */}
                <button
                  type="button"
                  onClick={() => setOpenDone(index)}
                  aria-haspopup="dialog"
                  className="w-full rounded-md text-left hover:text-foreground/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  {line.text}
                </button>
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
                <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  <Badge variant="outline" className="font-mono">{`→ ${line.ref} (${line.rel})`}</Badge>
                  {line.why ? <span className="min-w-0">{line.why}</span> : null}
                  {line.blocked_by?.length ? (
                    <span>blocked by {line.blocked_by.join(", ")}</span>
                  ) : null}
                </span>
              </Line>
            ))}
          </Lines>
        )}
      </Section>

      <Section title="Notes">
        {session.notes.length === 0 ? (
          <Empty>No notes on this session.</Empty>
        ) : (
          <div className="flex flex-col gap-3">
            {humanNotes.length === 0 ? (
              <Empty>Nothing here needs a person.</Empty>
            ) : (
              <Lines>
                {humanNotes.map((line, index) => (
                  <Note key={`${line.cp}-${index}`} line={line} />
                ))}
              </Lines>
            )}
            {agentNotes.length > 0 ? <ForAgents notes={agentNotes} /> : null}
          </div>
        )}
      </Section>

      {memory.length > 0 ? (
        <Section title="Memory">
          <p className="mb-2 text-xs text-muted-foreground">
            Facts this session committed to a memory file.
          </p>
          <ul className="flex flex-col gap-2">
            {memory.map((entry, index) => (
              <li key={index} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
                <span className="min-w-0">{entry.text}</span>
                {entry.file ? (
                  <Badge variant="outline" className="font-mono">
                    {entry.file}
                  </Badge>
                ) : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

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

      <DoneDrawer
        line={opened}
        checkpointAt={opened ? frontmatter.checkpoints.find((c) => c.n === opened.cp)?.at : undefined}
        remote={session.remote ?? null}
        editor={session.editor}
        repoPath={session.repoPath}
        onClose={() => setOpenDone(null)}
      />
    </div>
  );
}

/**
 * The floating right panel behind a Done item: everything the gist leaves out
 * (`docs/design/direction.md` §Shell, rule 3 — "evidence is never inline").
 *
 * `components/ui/panel.tsx` underneath, so Escape closes it, focus moves into it on open and back
 * to the item that opened it on close, and it is a non-modal 380 px floating panel on desktop and
 * a modal bottom sheet below 768 px. It is not a full-height drawer in either form.
 *
 * `line` is null when closed; the panel stays mounted so the trigger's focus has somewhere to
 * return to and so a second item *replaces* the contents rather than closing and reopening.
 *
 * The commit and every file link out to the repo's forge when one resolved (P8 amendment 13), and
 * each file also offers the editor. Rule 3 is why they live in here and never on the gist.
 */
function DoneDrawer({
  line,
  checkpointAt,
  remote,
  editor,
  repoPath,
  onClose,
}: {
  line: DoneLine | null;
  checkpointAt: string | undefined;
  /** The repo's web base (amendment 13), or `null` — no remote, or a host the daemon skipped. */
  remote: RepoRemote | null;
  /** `editor:` from the repo config; `undefined` on a daemon from before the amendment. */
  editor: EditorScheme | undefined;
  /** The repo root the editor link builds its absolute path from. */
  repoPath: string | undefined;
  onClose: () => void;
}) {
  return (
    <Panel
      open={line !== null}
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={line?.text ?? ""}
      description={
        line === null ? undefined : (
          <>
            <span className="font-mono">{cpMarker(line.cp)}</span>
            {checkpointAt ? <span className="tabular-nums">{formatInstant(checkpointAt)}</span> : null}
          </>
        )
      }
    >
      {line === null ? null : (
        <dl className="flex flex-col gap-3 text-sm">
          <Field label="Detail">
            {line.detail ? (
              <span>{line.detail}</span>
            ) : (
              <span className="text-muted-foreground">No detail recorded.</span>
            )}
          </Field>
          <Field label="Commit">
            {line.commit ? (
              <Identifier
                value={line.commit}
                href={remote === null ? null : commitHref(remote, line.commit)}
              />
            ) : (
              <span className="text-muted-foreground">None</span>
            )}
          </Field>
          <Field label="Files">
            {line.files?.length ? (
              <ul className="flex flex-col gap-1">
                {line.files.map((file) => (
                  <li key={file} className="flex flex-wrap items-baseline gap-x-2">
                    {/*
                      At the item's own commit when it recorded one, else at the default branch: a
                      path is only meaningful at a revision, and the ledger line is the revision it
                      was written about.
                    */}
                    <Identifier
                      value={file}
                      href={remote === null ? null : fileHref(remote, file, line.commit)}
                    />
                    <EditorLink file={file} editor={editor} repoPath={repoPath} />
                  </li>
                ))}
              </ul>
            ) : (
              <span className="text-muted-foreground">None</span>
            )}
          </Field>
          <Field label="Verified">
            {line.verified ? (
              <Badge variant={verifiedVariant(line.verified)}>{line.verified}</Badge>
            ) : (
              <span className="text-muted-foreground">Not stated</span>
            )}
          </Field>
        </dl>
      )}
    </Panel>
  );
}

/**
 * A commit id or a file path: a link out to the repo's host when `origin` resolved to one
 * (amendment 13), and otherwise the identifier itself with a copy control — never a guessed URL,
 * because a link that 404s is worse than a string a person can paste.
 *
 * `rel="noreferrer noopener"` on every one of them: the ledger's contents are the operator's,
 * and a forge has no business learning which local page they were read from.
 */
function Identifier({ value, href }: { value: string; href: string | null }) {
  if (href === null) {
    return (
      <span className="inline-flex flex-wrap items-baseline gap-x-1">
        <span className="break-all font-mono text-xs">{value}</span>
        <CopyButton value={value} />
      </span>
    );
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="break-all font-mono text-xs underline decoration-dotted underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {value}
    </a>
  );
}

/** Puts one identifier on the clipboard. Silent where the API is absent (an insecure origin). */
function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={`Copy ${value}`}
      onClick={() => {
        navigator.clipboard?.writeText(value).then(
          () => setCopied(true),
          () => setCopied(false),
        );
      }}
      className="rounded-md text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

/**
 * Opens the file in the operator's editor, from the absolute local path — independent of the
 * remote, since a repo with no `origin` is exactly the one where the local file is all there is.
 * Absent when the repo says `editor: none` or the daemon predates the field.
 */
function EditorLink({
  file,
  editor,
  repoPath,
}: {
  file: string;
  editor: EditorScheme | undefined;
  repoPath: string | undefined;
}) {
  // The builder vets the path itself, so a `files` entry that leaves the repo simply has no
  // control here — the same string the web link refuses.
  const href = editorHref(editor, repoPath, file);
  if (href === null) return null;
  return (
    <a
      href={href}
      aria-label={`Open ${file} in the editor`}
      className="rounded-md text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      Open
    </a>
  );
}

function verifiedVariant(verified: Verified): "accent" | "destructive" | "outline" {
  if (verified === "tests-passed") return "accent";
  if (verified === "tests-failed") return "destructive";
  return "outline";
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

function Note({ line }: { line: NoteLine }) {
  return (
    <Line cp={line.cp}>
      <span className="mr-2 inline-flex">
        <Badge variant={line.type === "blocker" ? "destructive" : "accent"}>{line.type}</Badge>
      </span>
      {line.text}
      {line.reason ? <span className="mt-1 block text-xs text-muted-foreground">{line.reason}</span> : null}
    </Line>
  );
}

/**
 * Discovery notes, folded by default. A button with `aria-expanded` rather than `<details>`, so
 * the folded content is genuinely absent (not merely unrendered by the browser) and the label
 * carries the count either way.
 */
function ForAgents({ notes }: { notes: NoteLine[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="w-fit rounded-md text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span aria-hidden="true">{open ? "▾" : "▸"}</span> For agents ({notes.length})
      </button>
      {open ? (
        <Lines>
          {notes.map((line, index) => (
            <Note key={`${line.cp}-${index}`} line={line} />
          ))}
        </Lines>
      ) : null}
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
