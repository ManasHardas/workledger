/**
 * Reading `.workledger/identities.yaml` off disk — docs/contracts/p5/config-and-identities.md
 * §`identities.yaml`.
 *
 * The format, the case-insensitive resolution rule and the display helpers live in
 * `@workledger/core/identities`, where they are pure functions of a string. Only the two things
 * that need `node:fs` are here: where the file is, and reading it. `packages/server` reads the
 * same file through the same core parser for `GET /api/identities`, so the CLI's output and the
 * UI's names cannot disagree about what the file says.
 *
 * A missing or unreadable file is {@link NO_IDENTITIES} rather than an error — "Missing file:
 * emails display as before" is the contract, and this module is reached from `commands/brief.ts`,
 * which the `SessionStart` hook calls inside a 300 ms budget.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { NO_IDENTITIES, parseIdentities } from "@workledger/core/identities";

import { LEDGER_DIR } from "./ledger-fs.js";
import type { HookConfig } from "./config.js";
import type { IdentityMap } from "@workledger/core/identities";

export {
  NO_IDENTITIES,
  formatActor,
  identityList,
  parseIdentities,
  resolveActor,
  resolveMaybe,
} from "@workledger/core/identities";
export type { Identity, IdentityMap, NamedActor } from "@workledger/core/identities";

/** Absolute path of a repo's identities file, honouring `config.identities_file`. */
export function identitiesFile(root: string, config?: Pick<HookConfig, "identities_file">): string {
  const name = config?.identities_file?.trim();
  return path.join(root, LEDGER_DIR, name === undefined || name === "" ? "identities.yaml" : name);
}

/** Load a repo's identities file. A missing or unreadable file is {@link NO_IDENTITIES}. */
export function loadIdentities(
  root: string,
  config?: Pick<HookConfig, "identities_file">,
): IdentityMap {
  let text: string;
  try {
    text = readFileSync(identitiesFile(root, config), "utf8");
  } catch {
    return NO_IDENTITIES;
  }
  return parseIdentities(text);
}
