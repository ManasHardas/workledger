/**
 * @vitest-environment node
 *
 * The script under test is a Node script, and jsdom rewrites `import.meta.url` to an http URL,
 * which `fileURLToPath` refuses.
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const SCRIPT = fileURLToPath(new URL("../scripts/lighthouse.mjs", import.meta.url));

describe("pnpm -F web lighthouse", () => {
  it("says why it skipped and still exits 0 when there is no Chrome to drive", () => {
    // `CHROME_PATH` set to something that does not exist is the one case the script must not
    // paper over by finding some other browser — and it is how a machine with no Chrome is
    // simulated on a machine that has one.
    let status = 0;
    let stdout: string;
    try {
      stdout = execFileSync(process.execPath, [SCRIPT], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, CHROME_PATH: "/nonexistent/chrome" },
      });
    } catch (error) {
      const failure = error as { status?: number; stdout?: string };
      status = failure.status ?? 1;
      stdout = failure.stdout ?? "";
    }

    // The whole contract of this script for now: it reports, it never gates.
    expect(status).toBe(0);
    expect(stdout).toContain("lighthouse: skipped");
    expect(stdout).toContain("no Chrome found");
  });
});
