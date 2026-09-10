/**
 * Code Connect mapping for `SessionCard` — **skeleton**; see `apps/web/CODE_CONNECT.md`.
 *
 * Only what a designer can actually vary is mapped. A session is a ledger record, not a Figma
 * property, so the example passes a fixture with the goal Figma supplies patched in; the operator
 * swaps the fixture for the real call-site expression when the node id lands.
 */
import figma from "../../lib/code-connect.js";
import { FIXTURE_SESSIONS } from "../../lib/fixtures.js";
import type { ParsedSession } from "../../lib/ledger-source.js";
import { SessionCard } from "./session-card.js";

const SESSION = FIXTURE_SESSIONS[0] as ParsedSession;

figma.connect(
  SessionCard,
  "https://www.figma.com/design/FIGMA_FILE_KEY?node-id=NODE_ID_SESSION_CARD",
  {
    props: {
      goal: figma.string("Goal"),
      active: figma.boolean("Selected"),
    },
    example: (props) => (
      <SessionCard
        session={{ ...SESSION, goal: props.goal }}
        active={props.active}
        onFocus={() => {}}
      />
    ),
  },
);
