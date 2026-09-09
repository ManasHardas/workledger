/**
 * A throwaway repo seeded with **this repo's own** `.workledger/` — the dogfood ledger the issue's
 * acceptance criterion names ("all GET endpoints return the documented shapes for this repo's
 * dogfood ledger"). Copying it rather than inventing fixtures means the tests read the same
 * frontmatter the CLI actually writes, and a schema drift breaks them.
 */
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createApp } from "../src/app.js";
import type { ServerApp } from "../src/app.js";

/** `<repo>/.workledger`, four directories up from this file. */
export const DOGFOOD_LEDGER = fileURLToPath(new URL("../../../.workledger", import.meta.url));

/** A temp repo plus its cleanup. */
export interface TempRepo {
  root: string;
  ledger: string;
  sessions: string;
  backlog: string;
  cleanup(): void;
}

/** Copy the dogfood ledger into a fresh temp directory. */
export function seedRepo(): TempRepo {
  const root = mkdtempSync(path.join(os.tmpdir(), "workledger-server-"));
  const ledger = path.join(root, ".workledger");
  cpSync(DOGFOOD_LEDGER, ledger, { recursive: true });
  return {
    root,
    ledger,
    sessions: path.join(ledger, "sessions"),
    backlog: path.join(ledger, "backlog"),
    cleanup: () => void rmSync(root, { recursive: true, force: true }),
  };
}

/** A temp static asset directory with an `index.html` and one real file. */
export function seedStatic(files: Record<string, string>): { dir: string; cleanup(): void } {
  const dir = mkdtempSync(path.join(os.tmpdir(), "workledger-web-"));
  for (const [name, body] of Object.entries(files)) {
    const file = path.join(dir, name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, body, "utf8");
  }
  return { dir, cleanup: () => void rmSync(dir, { recursive: true, force: true }) };
}

/** `createApp` over a temp repo, with the watcher knobs tests need. */
export function appFor(repo: TempRepo, overrides: Partial<Parameters<typeof createApp>[0]> = {}): ServerApp {
  return createApp({
    repoRoot: repo.root,
    home: path.join(repo.root, "home"),
    env: { PATH: "" },
    homeDir: repo.root,
    ...overrides,
  });
}
