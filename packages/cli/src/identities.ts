/**
 * `.workledger/identities.yaml` — docs/contracts/p5/config-and-identities.md §`identities.yaml`.
 *
 * ```yaml
 * schema_version: 1
 * identities:
 *   - { email: manas.hardas@gmail.com, name: Manas Hardas, dome_user: null }
 * ```
 *
 * The file is committed and shared, which is the whole point: a teammate's clone shows names
 * instead of the email addresses git happens to record. Resolution is by `email`, compared
 * case-insensitively, and it replaces only the *display* name — the ledger files keep whatever
 * `Actor` was written into them, because the map is a view over the ledger and never a rewrite
 * of it.
 *
 * Parsed by hand, for the reason `src/config.ts` documents at length: this module is reached
 * from `commands/brief.ts`, which the `SessionStart` hook calls inside a 300 ms budget, and the
 * file is two keys deep. A file that does not parse is an *empty* map rather than an error —
 * "Missing file: emails display as before" is the contract, and a malformed file must degrade to
 * the same place rather than cost a session its brief.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { LEDGER_DIR } from "./ledger-fs.js";
import type { HookConfig } from "./config.js";

/** One row of the `identities:` sequence. */
export interface Identity {
  /** The git email this row maps, as written in the file. */
  email: string;
  /** The display name shown wherever that email's `Actor` appears. */
  name: string;
  /** The Dome user id this email maps card edits back to in P6; `null` when unmapped. */
  dome_user: string | null;
}

/** The loaded map, keyed by lower-cased email. */
export type IdentityMap = ReadonlyMap<string, Identity>;

/** The empty map — a missing, unreadable or unparseable file. */
export const NO_IDENTITIES: IdentityMap = new Map<string, Identity>();

/** Absolute path of a repo's identities file, honouring `config.identities_file`. */
export function identitiesFile(root: string, config?: Pick<HookConfig, "identities_file">): string {
  const name = config?.identities_file?.trim();
  return path.join(root, LEDGER_DIR, name === undefined || name === "" ? "identities.yaml" : name);
}

/** Strip a `#` comment that is not inside quotes. */
function stripComment(line: string): string {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i] as string;
    if (quote !== null) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "#" && (i === 0 || line[i - 1] === " ")) return line.slice(0, i);
  }
  return line;
}

/** Remove one layer of matching quotes and trim. */
function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0] as string;
    if ((first === '"' || first === "'") && trimmed.endsWith(first)) return trimmed.slice(1, -1);
  }
  return trimmed;
}

/** Split a flow-map body on top-level commas. */
function splitFlow(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  let quote: string | null = null;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i] as string;
    if (quote !== null) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "{" || ch === "[") depth += 1;
    else if (ch === "}" || ch === "]") depth -= 1;
    else if (ch === "," && depth === 0) {
      parts.push(body.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(body.slice(start));
  return parts.map((part) => part.trim()).filter((part) => part !== "");
}

/** `key: value` into `fields`, ignoring a line that is not a mapping entry. */
function readPair(fields: Map<string, string>, text: string): void {
  const colon = text.indexOf(":");
  if (colon < 0) return;
  fields.set(text.slice(0, colon).trim(), text.slice(colon + 1).trim());
}

/** Turn a collected `{ email, name, dome_user }` mapping into an {@link Identity}. */
function toIdentity(fields: Map<string, string>): Identity | undefined {
  const email = unquote(fields.get("email") ?? "");
  const name = unquote(fields.get("name") ?? "");
  if (email === "" || name === "") return undefined;
  const dome = unquote(fields.get("dome_user") ?? "");
  return { email, name, dome_user: dome === "" || dome === "null" || dome === "~" ? null : dome };
}

/**
 * Parse the identities document.
 *
 * Both YAML shapes the contract's example can be written in are read: the flow mapping it shows
 * (`- { email: …, name: … }`) and the block mapping a person editing the file by hand will
 * reach for instead. Later rows for one email win, so a file that grew a duplicate has one
 * answer rather than an order-dependent one. Never throws.
 */
export function parseIdentities(text: string): IdentityMap {
  const map = new Map<string, Identity>();
  let inSequence = false;
  let fields: Map<string, string> | undefined;

  const flush = (): void => {
    if (fields === undefined) return;
    const identity = toIdentity(fields);
    fields = undefined;
    if (identity !== undefined) map.set(identity.email.toLowerCase(), identity);
  };

  for (const raw of text.split("\n")) {
    const line = stripComment(raw).replace(/\s+$/, "");
    if (line.trim() === "" || line.trim().startsWith("---")) continue;

    if (!/^\s/.test(line)) {
      // A top-level key ends any sequence that was open.
      flush();
      inSequence = line.replace(/\s+$/, "").startsWith("identities:");
      continue;
    }
    if (!inSequence) continue;

    const trimmed = line.trim();
    if (trimmed.startsWith("-")) {
      flush();
      fields = new Map<string, string>();
      const item = trimmed.slice(1).trim();
      if (item.startsWith("{")) {
        const close = item.lastIndexOf("}");
        for (const part of splitFlow(item.slice(1, close < 0 ? undefined : close))) {
          readPair(fields, part);
        }
        flush();
      } else if (item !== "") {
        readPair(fields, item);
      }
      continue;
    }
    if (fields !== undefined) readPair(fields, trimmed);
  }
  flush();
  return map;
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

/** The shape resolution applies to: an `Actor`, or a `HumanStamp`, or anything with those keys. */
interface Named {
  name: string;
  email: string;
  dome_user?: string | null | undefined;
}

/**
 * The display form of one actor: the mapped `name` when its email is in the map, otherwise the
 * actor exactly as the ledger recorded it.
 *
 * `dome_user` is filled in from the map only when the ledger has none of its own, so a stamp
 * that already carries an id keeps it.
 */
export function resolveActor<T extends Named>(actor: T, identities: IdentityMap): T {
  const match = identities.get(actor.email.trim().toLowerCase());
  if (match === undefined) return actor;
  const domeUser = actor.dome_user ?? match.dome_user;
  return { ...actor, name: match.name, ...(domeUser === null ? {} : { dome_user: domeUser }) };
}

/** {@link resolveActor} for a field that may be absent or null. */
export function resolveMaybe<T extends Named>(
  actor: T | null | undefined,
  identities: IdentityMap,
): T | null | undefined {
  return actor === null || actor === undefined ? actor : resolveActor(actor, identities);
}

/**
 * How an actor is written in one line of CLI output: `Name <email>`, or the bare email when
 * neither the ledger nor the map has a name for it.
 */
export function formatActor(actor: Named, identities: IdentityMap): string {
  const resolved = resolveActor(actor, identities);
  const name = resolved.name.trim();
  return name === "" ? resolved.email : `${name} <${resolved.email}>`;
}
