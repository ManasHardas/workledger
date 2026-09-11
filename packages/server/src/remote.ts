/**
 * The repo's web base, resolved from its `origin` remote — docs/contracts/p8/daemon-and-api.md
 * amendment 13.
 *
 * Everything here is arithmetic on a string that is already on disk. `origin`'s URL is read out
 * of `.git/config` rather than by running `git` (a subprocess per `/api/repos` render is not
 * worth it), and no request is ever made to the host: the amendment is explicit that the daemon
 * never contacts the remote, so the URL shapes below are knowledge, not discovery. That is also
 * why the templates carry `{sha}`, `{ref}` and `{path}` instead of being functions — they cross
 * the wire, and the UI substitutes.
 *
 * A host is recognised by a label of its hostname, so a self-hosted `gitlab.acme.internal` reads
 * as GitLab and a `git.acme.internal` — which could be anything — resolves to `null` rather than
 * to a link that 404s.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

/** The forges whose URL shapes this module knows. */
export type RemoteHost = "github" | "gitlab" | "bitbucket";

/** What a resolved `origin` gives the UI. `null` in place of one of these means "no link". */
export interface RepoRemote {
  host: RemoteHost;
  /** `https://github.com/owner/repo` — credentials and `.git` stripped, no trailing slash. */
  webBase: string;
  /** The commit page, with `{sha}` where the commit id goes. */
  commitUrl: string;
  /** The file page, with `{ref}` (a sha or {@link DEFAULT_REF}) and `{path}`. */
  fileUrl: string;
}

/**
 * The ref a file link uses when the ledger line records no commit. All three hosts resolve
 * `HEAD` to the repo's default branch, which is what lets this stay a pure string operation.
 */
export const DEFAULT_REF = "HEAD";

/** `<commit path>`, `<file path>` per host, relative to the web base. */
const SHAPES: Record<RemoteHost, { commit: string; file: string }> = {
  github: { commit: "/commit/{sha}", file: "/blob/{ref}/{path}" },
  gitlab: { commit: "/-/commit/{sha}", file: "/-/blob/{ref}/{path}" },
  bitbucket: { commit: "/commits/{sha}", file: "/src/{ref}/{path}" },
};

/** The three public forges, and the hostname their web UI actually lives on. */
const PUBLIC: readonly (readonly [string, RemoteHost])[] = [
  ["github.com", "github"],
  ["gitlab.com", "gitlab"],
  ["bitbucket.org", "bitbucket"],
];

/**
 * The forge an authority belongs to, and the authority its *web* URLs use.
 *
 * Two rules, in order. A public forge is matched on its real hostname, on an `ssh_config` alias
 * spelled `github.com-personal` (the convention for a second identity — this repo's own
 * `origin`), and on an alternate host like `ssh.github.com`; all of them canonicalise back to
 * the public hostname, because the alias exists only inside that operator's ssh config and no
 * browser can resolve it. Anything else is matched on a label of its hostname, so a self-hosted
 * `gitlab.acme.internal` reads as GitLab and keeps its own authority, and a `git.acme.internal`
 * — which could be running anything — is `null` rather than a link that 404s.
 */
function hostOf(authority: string): { host: RemoteHost; authority: string } | null {
  const lower = authority.toLowerCase();
  const hostname = lower.split(":")[0]!;
  for (const [name, host] of PUBLIC) {
    if (hostname === name || hostname.endsWith(`.${name}`)) return { host, authority: name };
    if (!hostname.startsWith(`${name}-`)) continue;
    // An `ssh_config` alias is a single label: `github.com-personal`. A hostname that carries a
    // dot after the suffix is a *real* host that merely starts the same way
    // (`github.com-mirror.acme.corp`), and canonicalising it would link to someone else's repo
    // on the public forge — so it is refused outright rather than falling through to the
    // self-hosted rule below, which would accept it on its `github` label.
    return /^[a-z0-9_-]+$/.test(hostname.slice(name.length + 1))
      ? { host, authority: name }
      : null;
  }
  const labels = hostname.split(".");
  if (labels.includes("github")) return { host: "github", authority: lower };
  if (labels.includes("gitlab")) return { host: "gitlab", authority: lower };
  if (labels.includes("bitbucket")) return { host: "bitbucket", authority: lower };
  return null;
}

/** `owner/repo` from a URL path: no leading or trailing slash, no `.git`. */
function repoPath(raw: string): string | null {
  const trimmed = raw.replace(/^\/+/, "").replace(/\/+$/, "").replace(/\.git$/i, "").replace(/\/+$/, "");
  return trimmed === "" ? null : trimmed;
}

/** The scheme, authority and repo path of a remote URL, in either of git's two spellings. */
function parseRemoteUrl(raw: string): { scheme: string; authority: string; path: string } | null {
  const url = raw.trim();
  if (url === "") return null;

  // `git@github.com:owner/repo.git` — scp-like, which is not a URL and which `new URL` rejects.
  if (!url.includes("://")) {
    const match = /^(?:[^@/]+@)?([^:/]+):(.+)$/.exec(url);
    if (match === null) return null;
    const repo = repoPath(match[2]!);
    return repo === null ? null : { scheme: "https", authority: match[1]!.toLowerCase(), path: repo };
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.hostname === "") return null;
  const repo = repoPath(parsed.pathname);
  if (repo === null) return null;
  // `ssh://`, `git://` and `file://` say nothing about the web port; only http(s) carries one.
  const web = parsed.protocol === "http:" || parsed.protocol === "https:";
  const scheme = web ? parsed.protocol.slice(0, -1) : "https";
  const authority = web && parsed.port !== "" ? `${parsed.hostname}:${parsed.port}` : parsed.hostname;
  return { scheme, authority, path: repo };
}

/**
 * The `remote` field of `GET /api/repos` and of the session view, from a repo's `origin` URL.
 *
 * `null` for an absent remote, a spelling this cannot read, and — deliberately — for a host that
 * is not one of the three: the amendment's UI shows the identifier with a copy control there, and
 * a wrong link would be worse than none.
 */
export function resolveRemote(originUrl: string | null | undefined): RepoRemote | null {
  if (originUrl === null || originUrl === undefined) return null;
  const parts = parseRemoteUrl(originUrl);
  if (parts === null) return null;
  const known = hostOf(parts.authority);
  if (known === null) return null;
  const webBase = `${parts.scheme}://${known.authority}/${parts.path}`;
  const shape = SHAPES[known.host];
  return {
    host: known.host,
    webBase,
    commitUrl: `${webBase}${shape.commit}`,
    fileUrl: `${webBase}${shape.file}`,
  };
}

/** `remote.commitUrl` with the commit id in it. */
export function commitHref(remote: RepoRemote, sha: string): string {
  return remote.commitUrl.replace("{sha}", encodeURIComponent(sha));
}

/**
 * A `files` entry as a path *inside* the repo, normalised — or `null` when it is not one.
 *
 * The entry is untrusted: it is whatever a checkpoint payload wrote, and the P1 schema accepts
 * any string. `../../../../etc/passwd` on the end of a blob URL is resolved by the browser into a
 * different repository. Restated here rather than imported from `@workledger/api-client` for the
 * same reason `./paths.ts` restates the CLI's path rules — the wire package is the *client's*
 * copy of the contract, and the server does not depend on it. Keep the two in step.
 */
export function repoRelativePath(file: string): string | null {
  const raw = file.trim();
  // A control character or a backslash: neither belongs in a repo-relative path, and both are
  // ways to smuggle something past a reader. Checked by code point rather than by a regex range,
  // which `no-control-regex` forbids for the same reason it is worth checking.
  for (const character of raw) {
    const code = character.codePointAt(0)!;
    if (code < 0x20 || code === 0x7f || character === "\\") return null;
  }
  if (raw === "") return null;
  if (raw.startsWith("/") || raw.startsWith("~") || /^[A-Za-z]:/.test(raw)) return null;
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(raw)) return null;
  const segments: string[] = [];
  for (const segment of raw.split("/")) {
    if (segment === "" || segment === ".") continue;
    // Never climb: `a/..` is only safe when `a` is a real directory rather than a link, which
    // nothing here can know, so the refusal is on the text.
    if (segment === "..") return null;
    segments.push(segment);
  }
  return segments.length === 0 ? null : segments.join("/");
}

/**
 * `remote.fileUrl` at `sha`, or at the default branch when the ledger line records no commit;
 * `null` for a path that is not inside the repo. The separators stay separators; everything else
 * in a segment is escaped.
 */
export function fileHref(
  remote: RepoRemote,
  file: string,
  sha?: string | undefined,
): string | null {
  const relative = repoRelativePath(file);
  if (relative === null) return null;
  return remote.fileUrl
    .replace("{ref}", encodeURIComponent(sha === undefined || sha === "" ? DEFAULT_REF : sha))
    .replace("{path}", relative.split("/").map(encodeURIComponent).join("/"));
}

/**
 * The directory holding `config` for a repo root: `<root>/.git`, or what a `.git` *file* points
 * at — a linked worktree, whose `origin` lives in the main repo's config, reached through
 * `commondir`.
 */
function gitConfigFile(root: string): string {
  const dot = path.join(root, ".git");
  let gitDir = dot;
  let text: string;
  try {
    text = readFileSync(dot, "utf8");
  } catch {
    // A directory (the ordinary case) or nothing at all; either way `<root>/.git/config`.
    return path.join(dot, "config");
  }
  const match = /^gitdir:\s*(.+)$/m.exec(text);
  if (match !== null) gitDir = path.resolve(root, match[1]!.trim());
  try {
    const common = readFileSync(path.join(gitDir, "commondir"), "utf8").trim();
    if (common !== "") gitDir = path.resolve(gitDir, common);
  } catch {
    // Not a linked worktree: the gitdir holds the config itself.
  }
  return path.join(gitDir, "config");
}

/**
 * The `url` of the `origin` remote from a repo's git config, or `null` when there is no repo, no
 * config, or no `origin`. A hand-written config is INI; only the one key is read.
 */
export function readOriginUrl(root: string): string | null {
  let text: string;
  try {
    text = readFileSync(gitConfigFile(root), "utf8");
  } catch {
    return null;
  }
  let inOrigin = false;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("[")) {
      inOrigin = /^\[remote\s+"origin"\]$/.test(line);
      continue;
    }
    if (!inOrigin) continue;
    const match = /^url\s*=\s*(.+)$/.exec(line);
    if (match !== null) return match[1]!.trim();
  }
  return null;
}

/** The repo's `remote` field: `origin` read off disk and resolved, both steps failing to `null`. */
export function repoRemote(root: string): RepoRemote | null {
  return resolveRemote(readOriginUrl(root));
}
