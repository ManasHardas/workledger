/**
 * P8 amendment 13's URL builders, and the rule that keeps them inside the repo.
 *
 * A `files` entry is whatever a checkpoint payload put there — core's schema accepts any string
 * — so it is untrusted input. `../../../../etc/passwd` appended to a blob URL is resolved by the
 * browser into *another repository*, and appended to `vscode://file/<root>` it opens an arbitrary
 * local file. Both builders therefore vet the path themselves rather than trusting their callers,
 * and a path that does not survive the check has no URL at all: the view falls back to the
 * identifier with a copy control.
 */
import { describe, expect, it } from "vitest";

import { commitHref, editorHref, fileHref, repoRelativePath } from "../src/index.js";
import type { RepoRemote } from "../src/index.js";

const GITHUB: RepoRemote = {
  host: "github",
  webBase: "https://github.com/ManasHardas/workledger",
  commitUrl: "https://github.com/ManasHardas/workledger/commit/{sha}",
  fileUrl: "https://github.com/ManasHardas/workledger/blob/{ref}/{path}",
};

const ROOT = "/Users/m/Projects/workledger";

describe("repoRelativePath", () => {
  it("keeps a path inside the repo and normalises it", () => {
    expect(repoRelativePath("packages/server/src/remote.ts")).toBe("packages/server/src/remote.ts");
    expect(repoRelativePath("./packages/./server/src")).toBe("packages/server/src");
    expect(repoRelativePath("packages//server///src")).toBe("packages/server/src");
    expect(repoRelativePath("docs/a file.md")).toBe("docs/a file.md");
    expect(repoRelativePath("packages/server/")).toBe("packages/server");
  });

  it("refuses anything that leaves the repo root or is not a repo-relative path", () => {
    for (const bad of [
      "../../../../../../etc/passwd",
      "packages/../../etc/passwd",
      // Refused even though it lexically stays inside: `packages` may be a link, and nothing
      // here can see the filesystem to know.
      "packages/server/../server/src",
      "node_modules/.bin/../../../etc/hosts",
      "..",
      "/etc/passwd",
      "//evil.example/x",
      "~/.ssh/id_ed25519",
      "~root/.ssh/id_ed25519",
      "C:\\Windows\\system32",
      "..\\..\\Windows",
      "https://evil.example/x",
      "file:///etc/passwd",
      "",
      "   ",
      ".",
      "a\u0000b",
      "a\nb",
    ]) {
      expect(repoRelativePath(bad), bad).toBeNull();
    }
  });
});

describe("commitHref / fileHref / editorHref", () => {
  it("builds a commit URL", () => {
    expect(commitHref(GITHUB, "0f1e2d3")).toBe(
      "https://github.com/ManasHardas/workledger/commit/0f1e2d3",
    );
  });

  it("builds a file URL at the commit, or at the default branch without one", () => {
    expect(fileHref(GITHUB, "packages/server/src/remote.ts", "0f1e2d3")).toBe(
      "https://github.com/ManasHardas/workledger/blob/0f1e2d3/packages/server/src/remote.ts",
    );
    expect(fileHref(GITHUB, "packages/server/src/remote.ts")).toBe(
      "https://github.com/ManasHardas/workledger/blob/HEAD/packages/server/src/remote.ts",
    );
    // Escaped once, and the separators stay separators.
    expect(fileHref(GITHUB, "docs/a file.md")).toBe(
      "https://github.com/ManasHardas/workledger/blob/HEAD/docs/a%20file.md",
    );
  });

  it("is null rather than a link to another repository for a path that escapes the root", () => {
    expect(fileHref(GITHUB, "../../../../../../etc/passwd")).toBeNull();
    expect(fileHref(GITHUB, "/etc/passwd")).toBeNull();
    expect(fileHref(GITHUB, "node_modules/.bin/../../../etc/hosts")).toBeNull();
    expect(fileHref(GITHUB, "~/.ssh/id_ed25519")).toBeNull();
  });

  it("builds an editor URL from the repo root and the relative path", () => {
    expect(editorHref("vscode", ROOT, "packages/server/src/remote.ts")).toBe(
      `vscode://file${ROOT}/packages/server/src/remote.ts`,
    );
    expect(editorHref("cursor", ROOT, "docs/a file.md")).toBe(
      `cursor://file${ROOT}/docs/a%20file.md`,
    );
  });

  it("is null for `none`, for an absent editor or root, and for a path that escapes the root", () => {
    expect(editorHref("none", ROOT, "a.ts")).toBeNull();
    expect(editorHref(undefined, ROOT, "a.ts")).toBeNull();
    expect(editorHref("vscode", undefined, "a.ts")).toBeNull();
    expect(editorHref("vscode", ROOT, "../../../../../../etc/passwd")).toBeNull();
    expect(editorHref("vscode", ROOT, "/etc/passwd")).toBeNull();
    expect(editorHref("vscode", ROOT, "..\\..\\Windows")).toBeNull();
  });
});
