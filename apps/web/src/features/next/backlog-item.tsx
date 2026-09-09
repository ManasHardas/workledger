import { useEffect, useState } from "react";

import { actionLabel, actionsFor, isAgentProposed } from "./backlog-model.js";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card.js";
import { Input } from "../../components/ui/input.js";
import { SelectField } from "../../components/ui/select-field.js";
import { TextareaField } from "../../components/ui/textarea-field.js";
import { cn } from "../../lib/cn.js";

import type { BacklogActions } from "./backlog-actions.js";
import type { BacklogView } from "../../lib/ledger-source.js";

const PRIORITIES = ["none", "p1", "p2", "p3"] as const;

export interface BacklogItemProps {
  item: BacklogView;
  /** Everything else in the backlog, as merge targets. */
  others: BacklogView[];
  actions: BacklogActions;
  canWrite: boolean;
  selected: boolean;
  editing: boolean;
  busy: boolean;
  error?: string;
  onSelect: () => void;
  onEditingChange: (editing: boolean) => void;
}

/** `Name <email>` for a display line; the assign form keeps the two fields apart. */
function ownerLine(item: BacklogView): string {
  const owner = item.frontmatter.owner;
  return owner ? `${owner.name} <${owner.email}>` : "Unassigned";
}

/**
 * One backlog item: what it says, where it came from, and every edit the status machine allows.
 *
 * Provenance is on the card rather than behind a click because an item the human never typed is
 * the normal case here — the checkpoint that proposed it is the evidence for accepting it.
 */
export function BacklogItem({
  item,
  others,
  actions,
  canWrite,
  selected,
  editing,
  busy,
  error,
  onSelect,
  onEditingChange,
}: BacklogItemProps) {
  const { frontmatter: fm } = item;
  const [title, setTitle] = useState(fm.title);
  const [body, setBody] = useState(item.body);
  const [ownerName, setOwnerName] = useState(fm.owner?.name ?? "");
  const [ownerEmail, setOwnerEmail] = useState(fm.owner?.email ?? "");
  const [mergeInto, setMergeInto] = useState("");

  // A reconciled `backlog.changed` can rewrite an item under an open editor — the CLI or another
  // tab moved it. The draft follows the item when the editor is closed, and is left alone while it
  // is open so a keystroke is never eaten mid-sentence.
  useEffect(() => {
    if (!editing) {
      setTitle(fm.title);
      setBody(item.body);
    }
  }, [editing, fm.title, item.body]);

  const save = () => {
    const patch = {
      ...(title === fm.title ? {} : { title }),
      ...(body === item.body ? {} : { body }),
    };
    if (Object.keys(patch).length > 0) actions.edit(item, patch);
    onEditingChange(false);
  };

  const disabled = !canWrite || busy;

  return (
    <Card
      aria-current={selected ? "true" : undefined}
      onClick={onSelect}
      className={cn("transition-shadow", selected && "ring-2 ring-ring")}
    >
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          {fm.priority ? <Badge variant="accent">{fm.priority}</Badge> : null}
          {isAgentProposed(item) ? <Badge variant="warning">agent-proposed</Badge> : null}
          {fm.area.map((area) => (
            <Badge key={area} variant="outline">
              {area}
            </Badge>
          ))}
        </div>
        {editing ? (
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Title
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
        ) : (
          <CardTitle>{fm.title}</CardTitle>
        )}
        <p className="text-xs text-muted-foreground">
          {fm.id} · {fm.proposed_by.harness} · session {fm.proposed_by.session} · checkpoint{" "}
          {fm.proposed_by.checkpoint}
        </p>
        <p className="text-xs text-muted-foreground">{ownerLine(item)}</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {editing ? (
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Body
            <TextareaField value={body} onChange={(e) => setBody(e.target.value)} />
          </label>
        ) : (
          <p className="text-sm text-muted-foreground">{item.body}</p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {editing ? (
            <>
              <Button size="sm" onClick={save} disabled={disabled}>
                Save
              </Button>
              <Button size="sm" variant="ghost" onClick={() => onEditingChange(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onEditingChange(true)}
              disabled={disabled}
            >
              Edit
            </Button>
          )}
          {actionsFor(fm.status).map((action) => (
            <Button
              key={action}
              size="sm"
              variant={action === "discard" ? "destructive" : "outline"}
              onClick={() => actions.run(item, action)}
              disabled={disabled}
            >
              {actionLabel(action)}
            </Button>
          ))}
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Priority
            <SelectField
              value={fm.priority ?? "none"}
              disabled={disabled}
              onChange={(e) =>
                actions.edit(item, {
                  priority: e.target.value === "none" ? null : (e.target.value as "p1" | "p2" | "p3"),
                })
              }
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </SelectField>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Merge into
            <SelectField
              value={mergeInto}
              disabled={disabled || others.length === 0}
              onChange={(e) => setMergeInto(e.target.value)}
            >
              <option value="">Choose an item…</option>
              {others.map((other) => (
                <option key={other.frontmatter.id} value={other.frontmatter.id}>
                  {/* The id is part of the label so an option never reads as a bare duplicate of
                      the card title it points at. */}
                  {other.frontmatter.title} ({other.frontmatter.id})
                </option>
              ))}
            </SelectField>
          </label>
          <Button
            size="sm"
            variant="outline"
            disabled={disabled || mergeInto === ""}
            onClick={() => actions.merge(item, mergeInto)}
          >
            Merge
          </Button>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Owner name
            <Input
              className="h-8 text-xs"
              value={ownerName}
              disabled={disabled}
              onChange={(e) => setOwnerName(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Owner email
            <Input
              className="h-8 text-xs"
              value={ownerEmail}
              disabled={disabled}
              onChange={(e) => setOwnerEmail(e.target.value)}
            />
          </label>
          <Button
            size="sm"
            variant="outline"
            disabled={disabled || ownerName === "" || ownerEmail === ""}
            onClick={() => actions.assign(item, { name: ownerName, email: ownerEmail })}
          >
            Assign
          </Button>
          <Button
            size="sm"
            variant="ghost"
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

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
