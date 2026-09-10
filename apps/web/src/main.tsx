import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app.js";
import "./index.css";
import { createSource } from "./lib/ledger-source.js";

const container = document.getElementById("root");
if (!container) throw new Error("#root is missing from index.html");

// A production bundle is the one `workledger serve` hosts, so it always reads through the real
// server; in dev the fixture ledger is the default and `VITE_API_BASE` opts into a running server.
// The base URL is same-origin `""` because `serve` hosts the app and `/api` together — an absolute
// origin here would only be right for a dev server pointed at a separate `serve`.
const apiBase = import.meta.env.VITE_API_BASE as string | undefined;
const source =
  import.meta.env.PROD || apiBase !== undefined
    ? createSource("local", { baseUrl: apiBase ?? "" })
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
