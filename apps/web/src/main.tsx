import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app.js";
import "./index.css";
import { createSource } from "./lib/ledger-source.js";

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
const source =
  import.meta.env.PROD || apiBase !== undefined
    ? createSource("local", { baseUrl: apiBase ?? window.location.origin })
    : createSource("fixture");

createRoot(container).render(
  <StrictMode>
    <App source={source} />
  </StrictMode>,
);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`);
  });
}
