/**
 * Code Connect mapping for the tab bar — **skeleton**; see `apps/web/CODE_CONNECT.md`.
 *
 * The node maps to `TabsList`, the only part of the set that is drawn; the example carries the
 * `Tabs` root and one panel so the published snippet is something a developer can paste.
 */
import figma from "../../lib/code-connect.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs.js";

figma.connect(TabsList, "https://www.figma.com/design/FIGMA_FILE_KEY?node-id=NODE_ID_TABS", {
  props: {
    first: figma.string("Tab 1"),
    second: figma.string("Tab 2"),
    panel: figma.children("Panel"),
  },
  example: (props) => (
    <Tabs defaultValue="first">
      <TabsList>
        <TabsTrigger value="first">{props.first}</TabsTrigger>
        <TabsTrigger value="second">{props.second}</TabsTrigger>
      </TabsList>
      <TabsContent value="first">{props.panel}</TabsContent>
    </Tabs>
  ),
});
