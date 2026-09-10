import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app.js";
import "./index.css";
import { createSource } from "./lib/ledger-source.js";
import type { LedgerSource } from "./lib/ledger-source.js";

const container = document.getElementById("root");
if (!container) throw new Error("#root is missing from index.html");

// A production bundle is the one `workledger serve` hosts, so it always reads through the real
// server; in dev the fixture ledger is the default and `VITE_API_BASE` opts into a running server.
//
// Same-origin is spelled `window.location.origin`, not `""`: `serve` does host the app and `/api`
// together, but `@workledger/api-client` rejects an empty base (`normalizeBaseUrl`) because it
// also has to run under Node, where a relative URL has no origin to resolve against. Passing `""`
// threw `ApiClientError: baseUrl must not be empty` before the first render, so the hosted app was
// a blank page.
const apiBase = import.meta.env.VITE_API_BASE as string | undefined;

/**
 * The source the app reads through.
 *
 * P8's daemon serves every repo on the machine and requires `?repo=<id>` on each per-repo call,
 * so the local source is scoped to the first repo `/api/repos` lists. This is the interim shim
 * until the Home view and the `/#/r/<id>/…` routes land: one repo, chosen for the user. A server
 * that lists none (nothing enabled yet) or cannot list (`serve --repo`, or a pre-P8 build) is
 * read unscoped, which is what those servers answer to.
 */
async function pickSource(): Promise<LedgerSource> {
  if (!import.meta.env.PROD && apiBase === undefined) return createSource("fixture");
  const machine = createSource("local", { baseUrl: apiBase ?? window.location.origin });
  try {
    const first = (await machine.listRepos())[0];
    if (first !== undefined) return machine.forRepo(first.id);
  } catch {
    // Not a machine-mode daemon; the unscoped source is the right one.
  }
  return machine;
}

const root = createRoot(container);
void pickSource().then((source) => {
  root.render(
    <StrictMode>
      <App source={source} />
    </StrictMode>,
  );
});

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`);
  });
}
