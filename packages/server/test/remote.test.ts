/**
 * P8 amendment 13 — remote resolution and the two fields the links are built from.
 *
 * The table is the contract's "either ssh or https form, with credentials and `.git` stripped":
 * every row is a spelling of `origin` a real repo has, and the assertion is the `webBase` and the
 * two templates it produces. A host nobody recognises and a repo with no remote at all are both
 * `null` — never a guess, and never a request: nothing in this module or its callers opens a
 * socket, which is the amendment's "no request is ever made to the remote host by the daemon".
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import { commitHref, fileHref, readOriginUrl, repoRelativePath, resolveRemote } from "../src/remote.js";
import { FakeOps, seedRepo } from "./helpers.js";
import type { RepoRemote } from "../src/remote.js";
import type { Repo } from "../src/repos.js";
import type { ServerApp } from "../src/app.js";
import type { SessionDetailView } from "../src/views.js";

const temps: string[] = [];
const servers: ServerApp[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) server.close();
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "wl-remote-"));
  temps.push(dir);
  return dir;
}

/** A repo root whose `.git/config` names `origin` — or names nothing, for `url === null`. */
function repoWithOrigin(url: string | null): string {
  const root = tempDir();
  mkdirSync(path.join(root, ".git"), { recursive: true });
  const body = url === null
    ? "[core]\n\trepositoryformatversion = 0\n"
    : `[core]\n\trepositoryformatversion = 0\n[remote "origin"]\n\turl = ${url}\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n`;
  writeFileSync(path.join(root, ".git", "config"), body, "utf8");
  return root;
}

describe("resolveRemote", () => {
  const table: { name: string; url: string; expected: RepoRemote | null }[] = [
    {
      name: "github ssh",
      url: "git@github.com:ManasHardas/workledger.git",
      expected: {
        host: "github",
        webBase: "https://github.com/ManasHardas/workledger",
        commitUrl: "https://github.com/ManasHardas/workledger/commit/{sha}",
        fileUrl: "https://github.com/ManasHardas/workledger/blob/{ref}/{path}",
      },
    },
    {
      name: "github ssh through a host alias with an explicit ssh:// and a port",
      url: "ssh://git@github.com:2222/ManasHardas/workledger.git",
      expected: {
        host: "github",
        webBase: "https://github.com/ManasHardas/workledger",
        commitUrl: "https://github.com/ManasHardas/workledger/commit/{sha}",
        fileUrl: "https://github.com/ManasHardas/workledger/blob/{ref}/{path}",
      },
    },
    {
      name: "github https",
      url: "https://github.com/ManasHardas/workledger.git",
      expected: {
        host: "github",
        webBase: "https://github.com/ManasHardas/workledger",
        commitUrl: "https://github.com/ManasHardas/workledger/commit/{sha}",
        fileUrl: "https://github.com/ManasHardas/workledger/blob/{ref}/{path}",
      },
    },
    {
      name: "https with a token in the URL — the credentials never reach the web base",
      url: "https://x-access-token:ghp_ThisIsNotARealToken@github.com/ManasHardas/workledger.git",
      expected: {
        host: "github",
        webBase: "https://github.com/ManasHardas/workledger",
        commitUrl: "https://github.com/ManasHardas/workledger/commit/{sha}",
        fileUrl: "https://github.com/ManasHardas/workledger/blob/{ref}/{path}",
      },
    },
    {
      name: "github ssh through an ssh_config host alias — the alias never reaches the browser",
      url: "git@github.com-personal:manashardas/workledger.git",
      expected: {
        host: "github",
        webBase: "https://github.com/manashardas/workledger",
        commitUrl: "https://github.com/manashardas/workledger/commit/{sha}",
        fileUrl: "https://github.com/manashardas/workledger/blob/{ref}/{path}",
      },
    },
    {
      name: "gitlab.com ssh, nested group",
      url: "git@gitlab.com:acme/platform/api.git",
      expected: {
        host: "gitlab",
        webBase: "https://gitlab.com/acme/platform/api",
        commitUrl: "https://gitlab.com/acme/platform/api/-/commit/{sha}",
        fileUrl: "https://gitlab.com/acme/platform/api/-/blob/{ref}/{path}",
      },
    },
    {
      name: "self-hosted gitlab over https, port kept",
      url: "https://gitlab.acme.internal:8443/acme/api.git",
      expected: {
        host: "gitlab",
        webBase: "https://gitlab.acme.internal:8443/acme/api",
        commitUrl: "https://gitlab.acme.internal:8443/acme/api/-/commit/{sha}",
        fileUrl: "https://gitlab.acme.internal:8443/acme/api/-/blob/{ref}/{path}",
      },
    },
    {
      name: "bitbucket ssh",
      url: "git@bitbucket.org:acme/api.git",
      expected: {
        host: "bitbucket",
        webBase: "https://bitbucket.org/acme/api",
        commitUrl: "https://bitbucket.org/acme/api/commits/{sha}",
        fileUrl: "https://bitbucket.org/acme/api/src/{ref}/{path}",
      },
    },
    { name: "an unrecognised host", url: "git@git.acme.internal:acme/api.git", expected: null },
    {
      // The alias rule must not turn someone else's host into github.com: an `ssh_config` alias
      // is one label, and a dot after the suffix means a real, different host.
      name: "a lookalike host that merely starts like a public forge",
      url: "git@github.com-mirror.acme.corp:acme/api.git",
      expected: null,
    },
    {
      name: "a lookalike https host",
      url: "https://gitlab.com-evil.example/acme/api.git",
      expected: null,
    },
    { name: "a local path remote", url: "/srv/git/api.git", expected: null },
    { name: "a host with no path", url: "https://github.com/", expected: null },
    { name: "an empty remote", url: "", expected: null },
  ];

  for (const row of table) {
    it(`resolves ${row.name}`, () => {
      expect(resolveRemote(row.url)).toEqual(row.expected);
    });
  }

  it("is null for a missing remote", () => {
    expect(resolveRemote(null)).toBeNull();
    expect(resolveRemote(undefined)).toBeNull();
  });

  it("builds a commit URL and a file URL, defaulting to the default branch with no commit", () => {
    const remote = resolveRemote("git@github.com:ManasHardas/workledger.git")!;
    expect(commitHref(remote, "0f1e2d3")).toBe(
      "https://github.com/ManasHardas/workledger/commit/0f1e2d3",
    );
    expect(fileHref(remote, "packages/server/src/remote.ts", "0f1e2d3")).toBe(
      "https://github.com/ManasHardas/workledger/blob/0f1e2d3/packages/server/src/remote.ts",
    );
    // No commit on the item: the default branch, which every one of the three hosts spells HEAD.
    expect(fileHref(remote, "packages/server/src/remote.ts")).toBe(
      "https://github.com/ManasHardas/workledger/blob/HEAD/packages/server/src/remote.ts",
    );
    // A space in a path is escaped, and the separators are not.
    expect(fileHref(remote, "docs/a file.md")).toBe(
      "https://github.com/ManasHardas/workledger/blob/HEAD/docs/a%20file.md",
    );
  });

  /**
   * A `files` entry is untrusted — the P1 schema accepts any string — and the browser resolves
   * `..` in a blob URL, so an escaping path would link to a *different repository*. The builder
   * refuses rather than the caller, so every caller inherits the refusal.
   */
  it("refuses a file path that is not inside the repo", () => {
    const remote = resolveRemote("git@github.com:ManasHardas/workledger.git")!;
    for (const bad of [
      "../../../../../../etc/passwd",
      "packages/../../etc/passwd",
      "node_modules/.bin/../../../etc/hosts",
      "/etc/passwd",
      "~/.ssh/id_ed25519",
      "..\\..\\Windows",
      "https://evil.example/x",
      "",
    ]) {
      expect(fileHref(remote, bad), bad).toBeNull();
      expect(repoRelativePath(bad), bad).toBeNull();
    }
    expect(repoRelativePath("./packages/./server//src")).toBe("packages/server/src");
  });
});

describe("readOriginUrl", () => {
  it("reads `origin` out of .git/config", () => {
    const root = repoWithOrigin("git@github.com:ManasHardas/workledger.git");
    expect(readOriginUrl(root)).toBe("git@github.com:ManasHardas/workledger.git");
  });

  it("is null for a repo whose config names no origin, and for a directory that is not a repo", () => {
    expect(readOriginUrl(repoWithOrigin(null))).toBeNull();
    expect(readOriginUrl(tempDir())).toBeNull();
  });

  it("follows the gitdir of a worktree to the main repo's config", () => {
    const main = repoWithOrigin("https://github.com/ManasHardas/workledger.git");
    const worktreeGitDir = path.join(main, ".git", "worktrees", "p7-b");
    mkdirSync(worktreeGitDir, { recursive: true });
    writeFileSync(path.join(worktreeGitDir, "commondir"), "../..\n", "utf8");
    const worktree = tempDir();
    writeFileSync(path.join(worktree, ".git"), `gitdir: ${worktreeGitDir}\n`, "utf8");
    expect(readOriginUrl(worktree)).toBe("https://github.com/ManasHardas/workledger.git");
  });
});

/**
 * The projection: what `GET /api/repos` and the session view carry, so the UI can build a link
 * without knowing a thing about any host's URL shape.
 */
describe("server projection", () => {
  /** A served repo with the given `origin` and, optionally, an `editor:` line in its config. */
  function serve(origin: string | null, editor?: string) {
    const repo = seedRepo();
    if (origin !== null) {
      mkdirSync(path.join(repo.root, ".git"), { recursive: true });
      writeFileSync(
        path.join(repo.root, ".git", "config"),
        `[remote "origin"]\n\turl = ${origin}\n`,
        "utf8",
      );
    }
    if (editor !== undefined) {
      const file = path.join(repo.ledger, "config.yaml");
      writeFileSync(file, `${readFileSync(file, "utf8")}editor: ${editor}\n`, "utf8");
    }
    const server = createApp({
      repoRoot: repo.root,
      ops: new FakeOps("WL-unset"),
      home: path.join(repo.root, "home"),
      env: { PATH: "" },
      homeDir: repo.root,
    });
    temps.push(repo.root);
    servers.push(server);
    return { repo, server };
  }

  async function json<T>(server: ServerApp, url: string): Promise<T> {
    const response = await server.app.request(url);
    expect(response.status).toBe(200);
    return (await response.json()) as T;
  }

  it("carries the resolved remote and the default editor on GET /api/repos", async () => {
    const { server } = serve("git@github.com:ManasHardas/workledger.git");
    const [row] = await json<Repo[]>(server, "/api/repos");
    expect(row?.remote).toEqual({
      host: "github",
      webBase: "https://github.com/ManasHardas/workledger",
      commitUrl: "https://github.com/ManasHardas/workledger/commit/{sha}",
      fileUrl: "https://github.com/ManasHardas/workledger/blob/{ref}/{path}",
    });
    expect(row?.editor).toBe("vscode");
  });

  it("reports remote null for a repo with no remote, and honours the config's editor", async () => {
    const { server } = serve(null, "none");
    const [row] = await json<Repo[]>(server, "/api/repos");
    expect(row?.remote).toBeNull();
    expect(row?.editor).toBe("none");
  });

  it("gives the session view the remote, the editor and the repo's absolute path", async () => {
    const { repo, server } = serve("git@gitlab.com:acme/api.git", "cursor");
    const sessions = await json<{ frontmatter: { id: string } }[]>(server, "/api/sessions");
    const ulid = sessions[0]!.frontmatter.id;
    const view = await json<SessionDetailView>(server, `/api/sessions/${ulid}`);
    expect(view.remote?.host).toBe("gitlab");
    expect(view.remote?.commitUrl).toBe("https://gitlab.com/acme/api/-/commit/{sha}");
    expect(view.editor).toBe("cursor");
    expect(view.repoPath).toBe(repo.root);
    // The list stays the read model's rows: the links are a detail-view concern.
    expect(view.frontmatter.id).toBe(ulid);
  });
});
