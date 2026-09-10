/**
 * `.workledger/identities.yaml` for `GET /api/identities` —
 * docs/contracts/p5/config-and-identities.md §`identities.yaml`.
 *
 * The format and the resolution rule are not restated here: they are pure functions of a string
 * in `@workledger/core/identities`, which is the one parser `workledger backlog show` and this
 * route both run. What this module adds is the read-side third `./paths.ts` already owns for the
 * rest of the ledger — where the file is, honouring `config.identities_file`, and "a missing file
 * is not an error".
 *
 * Reading it here rather than taking it as an injected op (the way `./ops.ts` and `./jobs.ts`
 * take theirs) is deliberate: those two exist because writing the ledger and opening
 * `index.sqlite` are things this package must not do, while reading a two-key file out of the
 * ledger directory is exactly what this package is for. A missing file is an empty list, which is
 * the contract's "emails display as before" on the wire.
 */
import path from "node:path";

import { parse } from "yaml";

import { identityList, parseIdentities } from "@workledger/core/identities";

import { readTextFile } from "./paths.js";
import type { Identity } from "@workledger/core/identities";
import type { LedgerPaths } from "./paths.js";

export type { Identity } from "@workledger/core/identities";

/** The default file name, and what an absent or blank `identities_file` falls back to. */
export const IDENTITIES_FILE = "identities.yaml";

/**
 * `config.identities_file` — the optional key of the P5 config contract, relative to
 * `.workledger/`.
 *
 * A config that does not parse, or that carries something other than a non-empty string here, is
 * the default file name: the config's own validity is `/api/health`'s business (`config.problems`)
 * and must not turn a name lookup into a 500.
 */
export function identitiesFileName(paths: LedgerPaths): string {
  const text = readTextFile(paths.config);
  if (text === undefined) return IDENTITIES_FILE;
  try {
    const doc = parse(text) as Record<string, unknown> | null;
    const name = doc?.["identities_file"];
    if (typeof name !== "string" || name.trim() === "") return IDENTITIES_FILE;
    return name.trim();
  } catch {
    return IDENTITIES_FILE;
  }
}

/**
 * Every mapped identity, by lower-cased email. An absent, unreadable or malformed file is `[]` —
 * the contract's "Missing file: emails display as before", which on the wire is a client that
 * finds no match and keeps rendering the email.
 */
export function listIdentities(paths: LedgerPaths): Identity[] {
  const text = readTextFile(path.join(paths.ledger, identitiesFileName(paths)));
  return text === undefined ? [] : identityList(parseIdentities(text));
}
