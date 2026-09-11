import { useEffect, useState } from "react";

import { actionLabel, actionsFor } from "./backlog-model.js";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import { Input } from "../../components/ui/input.js";
import { ConfirmAction } from "../../components/ui/list-row.js";
import { Panel } from "../../components/ui/panel.js";
import { SelectField } from "../../components/ui/select-field.js";
import { TextareaField } from "../../components/ui/textarea-field.js";
import { ActorName, isActor } from "../identity/actor-name.js";

import type { BacklogActions } from "./backlog-actions.js";
import type { BacklogView } from "../../lib/ledger-source.js";
import type { IdentityMap } from "../identity/live.js";

const PRIORITIES = ["none", "p1", "p2", "p3"] as const;

/**
 * Everything a backlog row leaves out, in the right panel (`docs/design/direction.md` rule 3).
 *
 * The body, where the item came from, who owns it, its audit trail, and the writes that need more
 * than a click — the body edit, the priority, the merge target, the owner — all live here, so the
 * list stays a list. The row keeps only what a person acts on at a glance.
 *
 * The panel stays mounted with `item === null` when nothing is open, so focus has somewhere to
 * return to and a second row *replaces* its contents rather than closing and reopening it.
 */
export function BacklogPanel({
  item,
  others,
  actions,
  canWrite,
  busy,
  error,
  identities,
  onClose,
}: {
  item: BacklogView | null;
  /** Everything else in the backlog, as merge targets. */
  others: BacklogView[];
  actions: BacklogActions;
  canWrite: boolean;
  busy: boolean;
  error?: string;
  /** `.workledger/identities.yaml`; empty when the repo has no file (P5 contract). */
  identities: IdentityMap;
  onClose: () => void;
}) {
  return (
    <Panel
      open={item !== null}
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={item?.frontmatter.title ?? ""}
      description={
        item === null ? undefined : (
          <>
            <span className="font-mono">{item.frontmatter.id}</span>
            <span>{item.frontmatter.status.replace("_", " ")}</span>
          </>
        )
      }
    >
      {item === null ? null : (
        <Body
          item={item}
          others={others}
          actions={actions}
          canWrite={canWrite}
          busy={busy}
          error={error}
          identities={identities}
        />
      )}
    </Panel>
  );
}

function Body({
  item,
  others,
  actions,
  canWrite,
  busy,
  error,
  identities,
}: {
  item: BacklogView;
  others: BacklogView[];
  actions: BacklogActions;
  canWrite: boolean;
  busy: boolean;
  error?: string;
  identities: IdentityMap;
}) {
  const { frontmatter: fm } = item;
  const [body, setBody] = useState(item.body);
  const [ownerName, setOwnerName] = useState(fm.owner?.name ?? "");
  const [ownerEmail, setOwnerEmail] = useState(fm.owner?.email ?? "");
  const [mergeInto, setMergeInto] = useState("");

  // The drafts follow whichever item the panel is showing; a second row replaces the contents
  // without unmounting, so without this the previous item's body would stay in the field.
  useEffect(() => {
    setBody(item.body);
    setOwnerName(fm.owner?.name ?? "");
    setOwnerEmail(fm.owner?.email ?? "");
    setMergeInto("");
  }, [fm.id, item.body, fm.owner?.name, fm.owner?.email]);

  const disabled = !canWrite || busy;
  const legal = actionsFor(fm.status);

  return (
    <div className="flex flex-col gap-4 text-sm">
      <div className="flex flex-wrap items-center gap-1">
        {legal
          .filter((action) => action !== "discard")
          .map((action) => (
            <Button
              key={action}
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={() => actions.run(item, action)}
            >
              {actionLabel(action)}
            </Button>
          ))}
        {legal.includes("discard") ? (
          <ConfirmAction
            label="Discard"
            confirmLabel="Confirm discard"
            size="sm"
            disabled={disabled}
            onConfirm={() => actions.run(item, "discard")}
          />
        ) : null}
      </div>

      {error === undefined ? null : (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <Field label="Body">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          <span className="sr-only">Body</span>
          <TextareaField
            value={body}
            disabled={disabled}
            onChange={(event) => setBody(event.target.value)}
          />
        </label>
        <Button
          variant="outline"
          size="sm"
          className="mt-2 w-fit"
          disabled={disabled || body === item.body}
          onClick={() => actions.edit(item, { body })}
        >
          Save body
        </Button>
      </Field>

      <Field label="Priority">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="sr-only">Priority</span>
          <SelectField
            value={fm.priority ?? "none"}
            disabled={disabled}
            onChange={(event) =>
              actions.edit(item, {
                priority:
                  event.target.value === "none" ? null : (event.target.value as "p1" | "p2" | "p3"),
              })
            }
          >
            {PRIORITIES.map((priority) => (
              <option key={priority} value={priority}>
                {priority}
              </option>
            ))}
          </SelectField>
        </label>
      </Field>

      {fm.area.length === 0 ? null : (
        <Field label="Areas">
          <span className="flex flex-wrap gap-1">
            {fm.area.map((area) => (
              <Badge key={area} variant="outline">
                {area}
              </Badge>
            ))}
          </span>
        </Field>
      )}

      <Field label="Proposed by">
        <p className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
          <ActorName actor={fm.proposed_by.author} identities={identities} />
          <span>{fm.proposed_by.harness}</span>
          <span className="font-mono">
            session {fm.proposed_by.session} · cp {fm.proposed_by.checkpoint}
          </span>
        </p>
      </Field>

      <Field label="Owner">
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">
            {fm.owner ? <ActorName actor={fm.owner} identities={identities} /> : "Unassigned"}
            {fm.confirmed_by ? (
              <>
                {" · confirmed by "}
                <ActorName actor={fm.confirmed_by} identities={identities} />
              </>
            ) : null}
          </p>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Owner name
            <Input
              className="h-8 text-xs"
              value={ownerName}
              disabled={disabled}
              onChange={(event) => setOwnerName(event.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Owner email
            <Input
              className="h-8 text-xs"
              value={ownerEmail}
              disabled={disabled}
              onChange={(event) => setOwnerEmail(event.target.value)}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={disabled || ownerName === "" || ownerEmail === ""}
              onClick={() => actions.assign(item, { name: ownerName, email: ownerEmail })}
            >
              Assign
            </Button>
            <Button
              variant="quiet"
              size="sm"
              disabled={disabled || !fm.owner}
              onClick={() => {
                setOwnerName("");
                setOwnerEmail("");
                actions.assign(item, null);
              }}
            >
              Unassign
            </Button>
          </div>
        </div>
      </Field>

      <Field label="Merge into">
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            <span className="sr-only">Merge into</span>
            <SelectField
              className="w-full"
              value={mergeInto}
              disabled={disabled || others.length === 0}
              onChange={(event) => setMergeInto(event.target.value)}
            >
              <option value="">Choose an item…</option>
              {others.map((other) => (
                <option key={other.frontmatter.id} value={other.frontmatter.id}>
                  {/* The id is part of the label so an option never reads as a bare duplicate of
                      the title it points at. */}
                  {other.frontmatter.title} ({other.frontmatter.id})
                </option>
              ))}
            </SelectField>
          </label>
          <Button
            variant="outline"
            size="sm"
            className="w-fit"
            disabled={disabled || mergeInto === ""}
            onClick={() => actions.merge(item, mergeInto)}
          >
            Merge
          </Button>
        </div>
      </Field>

      {/*
        The audit trail, newest last, as the file records it. A history `by` is a person for a UI
        or CLI edit and a `{ session, checkpoint }` for an agent-originated one — only the first
        has an email, so only the first is a name the identities map can replace.
      */}
      {fm.history.length === 0 ? null : (
        <Field label="History">
          <ul aria-label="History" className="flex flex-col gap-1 text-xs text-muted-foreground">
            {fm.history.map((entry, index) => (
              <li key={`${entry.at}-${String(index)}`}>
                {entry.at} · {entry.op}
                {" · "}
                {isActor(entry.by) ? (
                  <ActorName actor={entry.by} identities={identities} />
                ) : (
                  `session ${entry.by.session}`
                )}
                {entry.diff ? ` · ${entry.diff}` : ""}
              </li>
            ))}
          </ul>
        </Field>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs font-medium uppercase tracking-wide text-subtle-foreground">{label}</p>
      {children}
    </div>
  );
}
