/**
 * Code Connect mapping for `BacklogItem` — **skeleton**; see `apps/web/CODE_CONNECT.md`.
 *
 * The item and the five writes come from Review's backlog half, not from Figma; what the canvas
 * varies is the card's variant — Review's proposal card (`10:75`) or the card the groups below it
 * use — and its three states: selected, renaming in place, and a write in flight.
 */
import figma from "../../lib/code-connect.js";
import { FIXTURE_BACKLOG } from "../../lib/fixtures.js";
import type { BacklogView } from "../../lib/ledger-source.js";
import type { BacklogActions } from "./backlog-actions.js";
import { BacklogItem } from "./backlog-item.js";

const ITEM = FIXTURE_BACKLOG[0] as BacklogView;

/** A no-op `BacklogActions`, so the example is a complete call and still writes nothing. */
const NO_WRITES: BacklogActions = {
  run: () => {},
  edit: () => {},
  assign: () => {},
  rank: () => {},
  merge: () => {},
};

figma.connect(
  BacklogItem,
  "https://www.figma.com/design/FIGMA_FILE_KEY?node-id=NODE_ID_BACKLOG_ITEM",
  {
    props: {
      variant: figma.enum("Variant", { Proposal: "proposal", Row: "row" } as const),
      selected: figma.boolean("Selected"),
      editing: figma.boolean("Editing"),
      busy: figma.boolean("Busy"),
    },
    example: (props) => (
      <BacklogItem
        variant={props.variant}
        item={ITEM}
        actions={NO_WRITES}
        canWrite
        selected={props.selected}
        editing={props.editing}
        busy={props.busy}
        onSelect={() => {}}
        onOpen={() => {}}
        onEditingChange={() => {}}
      />
    ),
  },
);
