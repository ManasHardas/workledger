/**
 * Code Connect mapping for one Health row — **skeleton**; see `apps/web/CODE_CONNECT.md`.
 *
 * `HealthRow` is internal to `health-report.tsx`, so this uses Code Connect's example-only form —
 * `figma.connect(url, …)` with no component — and shows the composition the node stands for: the
 * shared `ListRow`, a status chip, the reading's name, and how many complaints doctor made. The
 * complaints themselves are in the right panel (docs/design/direction.md rule 3), not on the row.
 */
import { Badge } from "../../components/ui/badge.js";
import { ListRow, RowList, RowTitle } from "../../components/ui/list-row.js";
import figma from "../../lib/code-connect.js";

/** The same reading-to-variant rule `health-report.tsx` applies, restated for the snippet. */
const VARIANT = { ok: "outline", warn: "warning", broken: "destructive" } as const;

figma.connect("https://www.figma.com/design/FIGMA_FILE_KEY?node-id=NODE_ID_HEALTH_ROW", {
  props: {
    status: figma.enum("Status", { Ok: "ok", Warn: "warn", Broken: "broken" } as const),
    label: figma.string("Label"),
    problems: figma.string("Problems"),
    selected: figma.boolean("Selected"),
  },
  example: (props) => (
    <RowList>
      <ListRow selected={props.selected} aria-label={props.label}>
        <Badge variant={VARIANT[props.status]} className="shrink-0">
          {props.status}
        </Badge>
        <RowTitle aria-haspopup="dialog">{props.label}</RowTitle>
        <span className="shrink-0 text-xs tabular-nums text-subtle-foreground">
          {props.problems}
        </span>
      </ListRow>
    </RowList>
  ),
});
