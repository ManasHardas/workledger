/**
 * Code Connect mapping for Review's answer card (`NoteCard`, frame `10:35`) — **skeleton**; see
 * `apps/web/CODE_CONNECT.md`.
 *
 * The note comes from the ledger, not from Figma; what the canvas varies is its type, its text, the
 * checkpoint it was raised at, and whether the card is the selected one. The answer form is not
 * here: it is the right column's "Selected" module (`NoteModule`).
 */
import figma from "../../lib/code-connect.js";
import { RowList } from "../../components/ui/list-row.js";
import { FIXTURE_NOTES } from "../../lib/fixtures.js";
import { NoteCard } from "./note-card.js";

const NOTE = FIXTURE_NOTES[0]!;

figma.connect(NoteCard, "https://www.figma.com/design/FIGMA_FILE_KEY?node-id=NODE_ID_NOTE_CARD", {
  props: {
    type: figma.enum("Type", { Question: "question", Blocker: "blocker" } as const),
    text: figma.string("Text"),
    cp: figma.string("Checkpoint"),
    selected: figma.boolean("Selected"),
  },
  example: (props) => (
    <RowList>
      <NoteCard
        note={{ ...NOTE, type: props.type, text: props.text, cp: Number(props.cp) || NOTE.cp }}
        at="2026-09-10T08:00:00Z"
        selected={props.selected}
        opensDialog={false}
        onSelect={() => {}}
        onAnswer={() => {}}
      />
    </RowList>
  ),
});
