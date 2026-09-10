/**
 * Code Connect mapping for `Button` — **skeleton**.
 *
 * `FIGMA_FILE_KEY` and `NODE_ID_*` are placeholders: the operator replaces them with the real file
 * key and node id from the Figma file before running `npx figma connect publish`. See
 * `apps/web/CODE_CONNECT.md`.
 */
import figma from "../../lib/code-connect.js";
import { Button } from "./button.js";

figma.connect(Button, "https://www.figma.com/design/FIGMA_FILE_KEY?node-id=NODE_ID_BUTTON", {
  props: {
    variant: figma.enum("Variant", {
      Primary: "default",
      Secondary: "secondary",
      Outline: "outline",
      Ghost: "ghost",
      Destructive: "destructive",
    } as const),
    size: figma.enum("Size", {
      Default: "default",
      Small: "sm",
      Large: "lg",
      Icon: "icon",
    } as const),
    disabled: figma.boolean("Disabled"),
    label: figma.textContent("Label"),
  },
  example: (props) => (
    <Button variant={props.variant} size={props.size} disabled={props.disabled}>
      {props.label}
    </Button>
  ),
});
