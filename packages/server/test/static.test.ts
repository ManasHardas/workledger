/**
 * api.md §Static assets: `GET /` and any non-`/api` path serve the built `apps/web`, with
 * `index.html` as the fallback for hash routing.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { appFor, seedRepo, seedStatic } from "./helpers.js";
import { resolveStatic } from "../src/routes/static.js";
import type { TempRepo } from "./helpers.js";
import type { ServerApp } from "../src/app.js";

const INDEX = "<!doctype html><title>workledger</title><div id=app></div>";

let repo: TempRepo;
let web: { dir: string; cleanup(): void };
let server: ServerApp;

beforeEach(() => {
  repo = seedRepo();
  web = seedStatic({
    "index.html": INDEX,
    "assets/app.js": "export const ok = 1;\n",
    "assets/app.css": ":root{--ok:1}\n",
  });
  server = appFor(repo, { staticDir: web.dir });
});

afterEach(() => {
  server.close();
  web.cleanup();
  repo.cleanup();
});

describe("static assets", () => {
  it("serves index.html at /", async () => {
    const response = await server.app.request("/");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toBe(INDEX);
  });

  it("serves a real asset with its content type", async () => {
    const js = await server.app.request("/assets/app.js");
    expect(js.status).toBe(200);
    expect(js.headers.get("content-type")).toContain("text/javascript");
    expect(await js.text()).toBe("export const ok = 1;\n");

    const css = await server.app.request("/assets/app.css");
    expect(css.headers.get("content-type")).toContain("text/css");
  });

  it("falls back to index.html for a route that is not a file", async () => {
    const response = await server.app.request("/backlog/WL-01M246Y97SPQKRBJJYNX141QB5");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(INDEX);
  });

  it("never lets the static fallback answer an /api path", async () => {
    const response = await server.app.request("/api/does-not-exist");
    expect(response.status).toBe(404);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe("not_found");
  });

  it("refuses to escape the asset directory", () => {
    expect(resolveStatic(web.dir, "/../../etc/passwd")).toBeUndefined();
    expect(resolveStatic(web.dir, "/%2e%2e/%2e%2e/etc/passwd")).toBeUndefined();
    // A malformed percent-escape is simply not a file here.
    expect(resolveStatic(web.dir, "/%zz")).toBeUndefined();
    expect(resolveStatic(web.dir, "/assets")).toBeUndefined();
    expect(resolveStatic(web.dir, "/index.html")).toContain("index.html");
  });

  it("404s in the error shape when staticDir has no index.html", async () => {
    const empty = seedStatic({});
    const bare = appFor(repo, { staticDir: empty.dir });
    try {
      const response = await bare.app.request("/anything");
      expect(response.status).toBe(404);
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe("not_found");
    } finally {
      bare.close();
      empty.cleanup();
    }
  });
});
