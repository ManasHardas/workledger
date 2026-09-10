import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const PKG = fileURLToPath(new URL("../", import.meta.url));
const FIXTURE = path.join(PKG, "test", "fixtures", "figma-variables-local.json");

/** The three files a sync may rewrite: the tokens themselves and the two generated artifacts. */
const ARTIFACTS = ["tokens.json", "tokens.css", "tailwind.preset.js"] as const;

/**
 * A throwaway copy of `packages/tokens`, because `from-figma.mjs` writes next to itself by design
 * (the operator runs it in the package, not against a `--tokens` path). Every assertion is then a
 * comparison between the copy and the committed original.
 */
function sandbox(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "wl-tokens-"));
  cpSync(path.join(PKG, "scripts"), path.join(dir, "scripts"), { recursive: true });
  for (const file of ARTIFACTS) cpSync(path.join(PKG, file), path.join(dir, file));
  return dir;
}

function run(dir: string, args: string[]): { status: number; stdout: string; stderr: string } {
  const chunks = { stdout: "", stderr: "" };
  let status = 0;
  try {
    chunks.stdout = execFileSync(
      process.execPath,
      [path.join(dir, "scripts", "from-figma.mjs"), ...args],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    status = failure.status ?? 1;
    chunks.stdout = failure.stdout ?? "";
    chunks.stderr = failure.stderr ?? "";
  }
  return { status, ...chunks };
}

const original = (file: string) => readFileSync(path.join(PKG, file), "utf8");
const synced = (dir: string, file: string) => readFileSync(path.join(dir, file), "utf8");

describe("from-figma", () => {
  it("round-trips an export of the current tokens without changing a byte", () => {
    const dir = sandbox();
    const result = run(dir, [FIXTURE]);

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("no token changes");
    for (const file of ARTIFACTS) expect(synced(dir, file)).toBe(original(file));
  });

  it("reads every token in tokens.json — a token the fixture misses is drift, not a pass", () => {
    // A round-trip over half the file would also report "no token changes", so the count is the
    // half of that assertion that has teeth: it must equal the number of `$value` leaves.
    const leaves = original("tokens.json").match(/"\$value":/g)?.length ?? 0;
    expect(leaves).toBeGreaterThan(0);
    expect(run(sandbox(), [FIXTURE]).stdout).toContain(`${leaves} variable(s) read`);
  });

  it("exits 1 and lists the names when a variable has no token counterpart", () => {
    const dir = sandbox();
    const input = path.join(dir, "get_variable_defs.json");
    // The Figma MCP `get_variable_defs` shape: a flat name → value map, no collection, no mode.
    writeFileSync(
      input,
      JSON.stringify({ "color/background": "#fbfbfa", "color/brand-new": "#ff0000", "spacing/7": "28px" }),
    );

    const result = run(dir, [input]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("2 Figma variable(s) have no token counterpart");
    expect(result.stderr).toContain("color/brand-new");
    expect(result.stderr).toContain("spacing/7");
    // Nothing is written when any name is unknown, so the good half of the export is not applied
    // behind the operator's back.
    for (const file of ARTIFACTS) expect(synced(dir, file)).toBe(original(file));
  });

  it("rewrites changed values, prints the diff and leaves key order alone", () => {
    const dir = sandbox();
    const input = path.join(dir, "get_variable_defs.json");
    writeFileSync(input, JSON.stringify({ "color/primary": "#ff0000", "spacing/4": "20px" }));

    const result = run(dir, [input]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("~ color.light.primary");
    expect(result.stdout).toContain("#2f6b4f → #ff0000");
    expect(result.stdout).toContain("1rem → 1.25rem");

    const before = original("tokens.json");
    const after = synced(dir, "tokens.json");
    // `JSON.stringify` hoists `"0"`, `"1"`, `"2"` … above every other key, so a naive rewrite would
    // reorder the whole spacing scale. Comparing the key sequence in source order catches that.
    const keys = (text: string) => text.match(/^\s*"[^"]+":/gm)?.map((line) => line.trim());
    expect(keys(after)).toEqual(keys(before));
    // Two values differ and nothing else does.
    const differing = after
      .split("\n")
      .filter((line, i) => line !== before.split("\n")[i]);
    expect(differing).toEqual(['        "$value": "#ff0000"', '      "$value": "1.25rem"']);

    // The generated artifacts follow the tokens rather than lagging a sync behind.
    expect(synced(dir, "tokens.css")).toContain("--wl-color-primary: #ff0000;");
    expect(synced(dir, "tokens.css")).toContain("--wl-spacing-4: 1.25rem;");
  });

  it("maps a dome collection onto the dome theme and says so when its groups are missing", () => {
    const dir = sandbox();
    const input = path.join(dir, "dome.json");
    writeFileSync(input, JSON.stringify({ "color/background": "#0b0c0d" }));

    const result = run(dir, [input, "--theme", "dome", "--mode", "dark"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("color/background (dome/dark) → color.dome-dark.background");
  });
});
