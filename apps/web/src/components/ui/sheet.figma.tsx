/**
 * Code Connect mapping for the sheet — **skeleton**; see `apps/web/CODE_CONNECT.md`.
 *
 * The node maps to `SheetContent`, which is the panel a designer draws; `Sheet` itself is Radix's
 * headless root and has nothing on the canvas.
 */
import figma from "../../lib/code-connect.js";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "./sheet.js";

figma.connect(SheetContent, "https://www.figma.com/design/FIGMA_FILE_KEY?node-id=NODE_ID_SHEET", {
  props: {
    side: figma.enum("Side", {
      Right: "right",
      Left: "left",
      Top: "top",
      Bottom: "bottom",
    } as const),
    title: figma.string("Title"),
    description: figma.string("Description"),
    body: figma.children("Body"),
  },
  example: (props) => (
    <Sheet>
      <SheetContent side={props.side}>
        <SheetHeader>
          <SheetTitle>{props.title}</SheetTitle>
          <SheetDescription>{props.description}</SheetDescription>
        </SheetHeader>
        {props.body}
      </SheetContent>
    </Sheet>
  ),
});
