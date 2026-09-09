/**
 * Filesystem access to one repo's ledger, read side only.
 *
 * `packages/cli` owns the same handful of path rules for the write side, but it is a bundled
 * binary with no exports map (`packages/cli/package.json` ships `dist/main.js` and a `bin`), so
 * there is nothing for this package to import. The rules restated here are the read-only third
 * of `packages/cli/src/ledger-fs.ts` — directory layout, "a missing file is `undefined`" — and
 * nothing that writes.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/** The ledger directory inside an enabled repo. */
export const LEDGER_DIR = ".workledger";

/** The paths one enabled repo's ledger is made of. */
export interface LedgerPaths {
  /** The repo root — the directory holding `.workledger/`. */
  readonly root: string;
  /** `<root>/.workledger`. */
  readonly ledger: string;
  /** `<root>/.workledger/sessions`. */
  readonly sessions: string;
  /** `<root>/.workledger/backlog`. */
  readonly backlog: string;
  /** `<root>/.workledger/config.yaml`. */
  readonly config: string;
}

/** The ledger paths for one repo root. Does not check that any of them exist. */
export function ledgerPaths(root: string): LedgerPaths {
  const ledger = path.join(root, LEDGER_DIR);
  return {
    root,
    ledger,
    sessions: path.join(ledger, "sessions"),
    backlog: path.join(ledger, "backlog"),
    config: path.join(ledger, "config.yaml"),
  };
}

/** Read a UTF-8 ledger file, or `undefined` when it does not exist or is not readable. */
export function readTextFile(file: string): string | undefined {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
}

/** The `.md` file names (not paths) in one ledger directory; none when the directory is absent. */
export function listMarkdown(dir: string): string[] {
  try {
    return readdirSync(dir).filter((name) => name.endsWith(".md") && !name.startsWith("."));
  } catch {
    return [];
  }
}

/** Byte size of `file`, or `undefined` when it cannot be stat'd. */
export function fileSize(file: string): number | undefined {
  try {
    return statSync(file).size;
  } catch {
    return undefined;
  }
}

/** Modification time of `file` in epoch milliseconds, or `undefined` when it cannot be stat'd. */
export function fileMtimeMs(file: string): number | undefined {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return undefined;
  }
}

/** The `<ulid>` / `<id>` a ledger file name carries, or `undefined` when it is not one. */
export function ledgerId(file: string): string | undefined {
  const base = path.basename(file);
  if (!base.endsWith(".md") || base.startsWith(".")) return undefined;
  return base.slice(0, -3);
}
