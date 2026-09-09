import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app.js";
import "./index.css";
import { createSource } from "./lib/ledger-source.js";

const container = document.getElementById("root");
if (!container) throw new Error("#root is missing from index.html");

// `"fixture"` until packages/api-client (#35) merges; #37–#39 swap in
// `createSource("local", { baseUrl: "/api" })` and nothing else here changes.
createRoot(container).render(
  <StrictMode>
    <App source={createSource("fixture")} />
  </StrictMode>,
);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`);
  });
}
