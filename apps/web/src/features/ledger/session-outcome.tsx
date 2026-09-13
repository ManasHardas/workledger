import { useState, type ReactNode } from "react";

import { Badge } from "../../components/ui/badge.js";
import { commitHref, editorHref, fileHref } from "../../lib/ledger-source.js";
import type { EditorScheme, Line as DoneLine, ParsedSession, RepoRemote, Verified } from "../../lib/ledger-source.js";

/**
 * One outcome's evidence — Detail, Files, Commit, Verified — as the Session frame's "Selected
 * outcome" block draws it (`plans/feature-p9-figma-screens.md` §Session). The same fields fill the
 * docked block in the Provenance module and the floating panel below 1280 px, so the two cannot
 * drift.
 *
 * The commit and every file link out to the repo's forge when one resolved (P8 amendment 13), and
 * each file also offers the editor. Rule 3 is why they live here and never on the gist.
 */
export interface OutcomeContext {
  /** The repo's web base (amendment 13), or `null` — no remote, or a host the daemon skipped. */
  remote: RepoRemote | null;
  /** `editor:` from the repo config; `undefined` on a daemon from before the amendment. */
  editor: EditorScheme | undefined;
  /** The repo root the editor link builds its absolute path from. */
  repoPath: string | undefined;
}

export function outcomeContext(session: ParsedSession): OutcomeContext {
  return { remote: session.remote ?? null, editor: session.editor, repoPath: session.repoPath };
}

export function OutcomeFields({ line, context }: { line: DoneLine; context: OutcomeContext }) {
  const { remote, editor, repoPath } = context;
  return (
    <dl className="flex min-w-0 flex-col gap-2.5">
      <Field label="Detail">
        {line.detail ? (
          <span className="text-base leading-body tracking-body text-foreground">{line.detail}</span>
        ) : (
          <span className="text-base leading-body tracking-body text-muted-foreground">No detail recorded.</span>
        )}
      </Field>
      <Field label="Files">
        {line.files?.length ? (
          <ul className="flex flex-col">
            {line.files.map((file) => (
              <li key={file} className="flex flex-wrap items-baseline gap-x-2">
                {/*
                  At the item's own commit when it recorded one, else at the default branch: a
                  path is only meaningful at a revision, and the ledger line is the revision it
                  was written about.
                */}
                <Identifier value={file} href={remote === null ? null : fileHref(remote, file, line.commit)} />
                <EditorLink file={file} editor={editor} repoPath={repoPath} />
              </li>
            ))}
          </ul>
        ) : (
          <Muted>None</Muted>
        )}
      </Field>
      <Field label="Commit">
        {line.commit ? (
          <Identifier value={line.commit} href={remote === null ? null : commitHref(remote, line.commit)} />
        ) : (
          <Muted>None</Muted>
        )}
      </Field>
      <div className="flex items-center gap-2">
        <dt className="text-xs font-medium leading-tight text-muted-foreground">Verified</dt>
        <dd className="min-w-0">
          {line.verified ? (
            <Badge variant={verifiedVariant(line.verified)}>{line.verified}</Badge>
          ) : (
            <Muted>Not stated</Muted>
          )}
        </dd>
      </div>
    </dl>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.75">
      <dt className="text-xs font-medium leading-tight text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

function Muted({ children }: { children: ReactNode }) {
  return <span className="text-xs leading-tight text-muted-foreground">{children}</span>;
}

/** tests-passed success, tests-failed destructive, anything else a neutral label. */
export function verifiedVariant(verified: Verified): "success" | "destructive" | "secondary" {
  if (verified === "tests-passed") return "success";
  if (verified === "tests-failed") return "destructive";
  return "secondary";
}

const IDENTIFIER = "break-all font-mono text-xs leading-tight text-foreground";

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
      <span className="inline-flex flex-wrap items-baseline gap-x-1.5">
        <span className={IDENTIFIER}>{value}</span>
        <CopyButton value={value} />
      </span>
    );
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className={`${IDENTIFIER} rounded-sm underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
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
      className="rounded-sm text-xs leading-tight text-subtle-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
      className="rounded-sm text-xs leading-tight text-subtle-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      Open
    </a>
  );
}
