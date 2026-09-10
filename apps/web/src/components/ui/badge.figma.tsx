/**
 * Code Connect mapping for `Badge` — **skeleton**; see `apps/web/CODE_CONNECT.md`.
 *
 * The variant list is `badgeVariants` verbatim: a Figma variant with no code counterpart would
 * publish a snippet that does not compile.
 */
import figma from "../../lib/code-connect.js";
import { Badge } from "./badge.js";

figma.connect(Badge, "https://www.figma.com/design/FIGMA_FILE_KEY?node-id=NODE_ID_BADGE", {
  props: {
    variant: figma.enum("Variant", {
      Default: "default",
      Secondary: "secondary",
      Outline: "outline",
      Accent: "accent",
      Destructive: "destructive",
      Warning: "warning",
    } as const),
    label: figma.textContent("Label"),
  },
  example: (props) => <Badge variant={props.variant}>{props.label}</Badge>,
});
