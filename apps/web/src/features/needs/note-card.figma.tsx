/**
 * Code Connect mapping for the "Needs you" note row — **skeleton**; see
 * `apps/web/CODE_CONNECT.md`.
 *
 * The example-only form — `figma.connect(url, …)` with no component — because what the node stands
 * for is the *composition* of the shared row primitive, not `NoteCard`'s own props: the row is a
 * `ListRow` with a state chip, the note's prose, and the checkpoint it came from. The decision
 * form is not here; it is in the right panel (docs/design/direction.md rule 3).
 */
import { Badge } from "../../components/ui/badge.js";
import { ListRow, RowList, RowTitle } from "../../components/ui/list-row.js";
import figma from "../../lib/code-connect.js";

figma.connect("https://www.figma.com/design/FIGMA_FILE_KEY?node-id=NODE_ID_NOTE_CARD", {
  props: {
    type: figma.enum("Type", { Question: "question", Blocker: "blocker" } as const),
    text: figma.string("Text"),
    cp: figma.string("Checkpoint"),
    selected: figma.boolean("Selected"),
  },
  example: (props) => (
    <RowList>
      <ListRow selected={props.selected}>
        <Badge variant={props.type === "blocker" ? "destructive" : "accent"} className="shrink-0">
          {props.type}
        </Badge>
        <RowTitle aria-haspopup="dialog">{props.text}</RowTitle>
        <span className="shrink-0 font-mono text-xs text-subtle-foreground">{props.cp}</span>
      </ListRow>
    </RowList>
  ),
});
