/**
 * Code Connect mapping for the "Needs you" note card — **skeleton**; see
 * `apps/web/CODE_CONNECT.md`.
 *
 * `NoteCard` is internal to `needs-panel.tsx`, so this uses Code Connect's example-only form —
 * `figma.connect(url, …)` with no component — and shows the composition the node stands for. When
 * the component is exported, the operator adds it as the first argument and shortens the example.
 */
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card.js";
import figma from "../../lib/code-connect.js";

figma.connect("https://www.figma.com/design/FIGMA_FILE_KEY?node-id=NODE_ID_NOTE_CARD", {
  props: {
    type: figma.enum("Type", { Question: "question", Blocker: "blocker" } as const),
    text: figma.string("Text"),
    session: figma.string("Session goal"),
  },
  example: (props) => (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={props.type === "blocker" ? "destructive" : "secondary"}>
            {props.type}
          </Badge>
          <CardDescription>{props.session}</CardDescription>
        </div>
        <CardTitle>{props.text}</CardTitle>
      </CardHeader>
      <CardContent>
        <Button size="sm">Resolve</Button>
      </CardContent>
    </Card>
  ),
});
