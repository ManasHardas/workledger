/**
 * Code Connect mapping for `Card` — **skeleton**; see `apps/web/CODE_CONNECT.md`.
 *
 * `Card` is a composition rather than a single component, so the example shows the whole shape the
 * Figma frame stands for: header, title, description, content.
 */
import figma from "../../lib/code-connect.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./card.js";

figma.connect(Card, "https://www.figma.com/design/FIGMA_FILE_KEY?node-id=NODE_ID_CARD", {
  props: {
    title: figma.string("Title"),
    description: figma.string("Description"),
    content: figma.children("Content"),
  },
  example: (props) => (
    <Card>
      <CardHeader>
        <CardTitle>{props.title}</CardTitle>
        <CardDescription>{props.description}</CardDescription>
      </CardHeader>
      <CardContent>{props.content}</CardContent>
    </Card>
  ),
});
