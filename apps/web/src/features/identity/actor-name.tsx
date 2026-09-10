import type { IdentityMap } from "./live.js";

/** Anything the ledger records a person as: an `Actor`, a `HumanStamp`, a history `by`. */
export interface NamedActor {
  name: string;
  email: string;
}

/** `by` on a history entry is a person *or* a `{ session, checkpoint }` — only the first has a name. */
export function isActor(by: unknown): by is NamedActor {
  return typeof by === "object" && by !== null && "email" in by && "name" in by;
}

/**
 * What one actor is *called* here — the mapped name, or the email when nothing maps it.
 *
 * The ledger's own `name` is deliberately not the fallback: it is whatever `git config user.name`
 * happened to be on the machine that wrote the record, which is exactly the value
 * `.workledger/identities.yaml` exists to override. The email is the stable identity, so a repo
 * with no file (or with no row for this address) shows the address rather than a name nobody
 * agreed on (docs/contracts/p5/config-and-identities.md: "Missing file: emails display as before").
 */
export function displayName(actor: NamedActor, identities: IdentityMap): string {
  return identities.get(actor.email.trim().toLowerCase())?.name ?? actor.email;
}

/**
 * One actor, rendered as its mapped name with the email on the `title`.
 *
 * The tooltip is the point of the mapping rather than a decoration: two people can share a
 * display name and only the address disambiguates them, so the address stays one hover away even
 * when the name is what is on screen.
 */
export function ActorName({
  actor,
  identities,
  className,
}: {
  actor: NamedActor;
  identities: IdentityMap;
  className?: string;
}) {
  return (
    <span title={actor.email} className={className}>
      {displayName(actor, identities)}
    </span>
  );
}
