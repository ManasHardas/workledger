/**
 * Code Connect mapping for `Input` — **skeleton**; see `apps/web/CODE_CONNECT.md` for the file key
 * and node id the operator fills in.
 */
import figma from "../../lib/code-connect.js";
import { Input } from "./input.js";

figma.connect(Input, "https://www.figma.com/design/FIGMA_FILE_KEY?node-id=NODE_ID_INPUT", {
  props: {
    type: figma.enum("Type", { Text: "text", Search: "search", Number: "number" } as const),
    placeholder: figma.string("Placeholder"),
    disabled: figma.boolean("Disabled"),
  },
  example: (props) => (
    <Input type={props.type} placeholder={props.placeholder} disabled={props.disabled} />
  ),
});
