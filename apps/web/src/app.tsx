import { AppShell, type NavItem } from "./components/app-shell.js";
import type { LedgerSource } from "./lib/ledger-source.js";
import { useRoute } from "./lib/router.js";
import { SourceProvider } from "./lib/source-context.js";
import { HealthView } from "./routes/health.js";
import { LedgerView } from "./routes/ledger.js";
import { NeedsYouView } from "./routes/needs-you.js";
import { NextView } from "./routes/next.js";

const NAV: NavItem[] = [
  { id: "ledger", label: "Ledger" },
  { id: "next", label: "Next" },
  { id: "needs-you", label: "Needs you" },
  { id: "health", label: "Health" },
];

const VIEWS = {
  ledger: LedgerView,
  next: NextView,
  "needs-you": NeedsYouView,
  health: HealthView,
} as const;

/** The whole app, parameterised by its one dependency. */
export function App({ source }: { source: LedgerSource }) {
  const route = useRoute();
  const View = VIEWS[route];
  return (
    <SourceProvider source={source}>
      <AppShell nav={NAV}>
        <View />
      </AppShell>
    </SourceProvider>
  );
}
