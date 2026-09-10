/**
 * Code Connect mapping for one Health row — **skeleton**; see `apps/web/CODE_CONNECT.md`.
 *
 * `Row` is internal to `health-report.tsx`, so this uses Code Connect's example-only form —
 * `figma.connect(url, …)` with no component — and shows the composition the node stands for. When
 * the component is exported, the operator adds it as the first argument and shortens the example.
 */
import { Badge } from "../../components/ui/badge.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card.js";
import figma from "../../lib/code-connect.js";

/** The same reading-to-variant rule `health-report.tsx` applies, restated for the snippet. */
const VARIANT = { ok: "outline", warn: "warning", broken: "destructive" } as const;

figma.connect("https://www.figma.com/design/FIGMA_FILE_KEY?node-id=NODE_ID_HEALTH_ROW", {
  props: {
    status: figma.enum("Status", { Ok: "ok", Warn: "warn", Broken: "broken" } as const),
    label: figma.string("Label"),
    detail: figma.string("Detail"),
    problem: figma.string("Problem"),
  },
  example: (props) => (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={VARIANT[props.status]}>{props.status}</Badge>
          <CardTitle>{props.label}</CardTitle>
        </div>
        <CardDescription className="break-words">{props.detail}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
          <li>{props.problem}</li>
        </ul>
      </CardContent>
    </Card>
  ),
});
