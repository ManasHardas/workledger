/**
 * `GET /` and every non-`/api` path serve the built `apps/web` from `staticDir`, with
 * `index.html` as the fallback so hash routing (and a deep link that is not a file) still lands
 * on the app (api.md §Static assets).
 */
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { Context } from "hono";

/** Content types the built web app can produce. Anything else is served as a byte stream. */
const TYPES = new Map<string, string>([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
  [".ico", "image/x-icon"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
  [".map", "application/json; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"],
]);

/** The file `pathname` names inside `root`, or `undefined` when it escapes or is not a file. */
export function resolveStatic(root: string, pathname: string): string | undefined {
  // `decodeURIComponent` can throw on a malformed escape; a bad URL is simply not a file here.
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
  const candidate = path.resolve(root, `.${path.posix.normalize(decoded)}`);
  // Path traversal: `..` segments must not reach outside the asset directory.
  const rootWithSep = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (candidate !== root && !candidate.startsWith(rootWithSep)) return undefined;
  try {
    return statSync(candidate).isFile() ? candidate : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Serve one file with its content type.
 *
 * Read whole rather than streamed: the built `apps/web` is capped at 1 MB gzipped
 * (plans/feature-p2-data-flow.md §Assets and packaging), so there is nothing here worth a
 * stream — and a lazily-opened stream turns a file deleted between `stat` and the first read
 * into an unhandled error on a socket the response has already committed to.
 *
 * @returns `undefined` when the file vanished between the `stat` and the read.
 */
export function serveFile(c: Context, file: string): Response | undefined {
  const type = TYPES.get(path.extname(file).toLowerCase()) ?? "application/octet-stream";
  let body: Buffer;
  try {
    body = readFileSync(file);
  } catch {
    return undefined;
  }
  return c.body(new Uint8Array(body), 200, { "content-type": type });
}

/**
 * The handler for every non-`/api` path: the file if it exists, else `index.html`, else a 404
 * left to the app's `notFound`.
 */
export function staticHandler(root: string) {
  return (c: Context): Response | undefined => {
    const file = resolveStatic(root, new URL(c.req.url).pathname);
    const served = file === undefined ? undefined : serveFile(c, file);
    if (served !== undefined) return served;
    const index = resolveStatic(root, "/index.html");
    return index === undefined ? undefined : serveFile(c, index);
  };
}
