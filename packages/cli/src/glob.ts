/**
 * The glob subset `private_paths` is matched with — docs/contracts/p5/config-and-identities.md:
 * "matched with picomatch semantics against the session's `cwd` relative to the repo root".
 *
 * Deliberately not picomatch itself. `packages/cli` publishes a bundled binary whose only
 * runtime dependency is `better-sqlite3`, and the hook's `SessionStart` budget is 300 ms
 * including Node startup (plans/feature-p1-data-flow.md §6); a glob engine that supports
 * extglobs, POSIX classes and negation would be a new dependency and a new module init for a
 * feature whose whole input is a handful of directory patterns an operator typed into
 * `config.yaml`.
 *
 * What is supported is the picomatch surface those patterns actually use, with picomatch's
 * semantics for each: `*` matches within one segment, `**` crosses segments, `?` is one
 * character, `[abc]` / `[!a-z]` are character classes, and `{a,b}` alternates. Anything else is
 * a literal. `a/**` matches `a` as well as everything under it, which is what picomatch does and
 * what an operator writing `secrets/**` means.
 */

/** Characters that must be escaped when a glob character is taken literally. */
const REGEX_SPECIAL = /[.+^$()|\\]/;

/**
 * Translate one glob into the body of an anchored regular expression.
 *
 * Written as a single left-to-right pass rather than a chain of replacements so that a `*`
 * inside a character class stays literal and a `,` inside nested braces does not split the outer
 * alternation.
 */
function toRegexSource(glob: string): string {
  let out = "";
  let i = 0;
  const depth: number[] = [];
  while (i < glob.length) {
    const ch = glob[i] as string;

    if (ch === "*") {
      const globstar = glob[i + 1] === "*";
      if (globstar) {
        // `a/**` and `a/**/b`: the slash before the globstar is part of it, so `a/**` matches
        // `a` itself. Same rule as picomatch's `globstar` default.
        const trailingSlash = glob[i + 2] === "/";
        if (out.endsWith("/")) {
          out = `${out.slice(0, -1)}(?:/.*)?`;
          i += trailingSlash ? 3 : 2;
          // `a/**/b` still needs the separator before `b`.
          if (trailingSlash && i < glob.length) out += "/";
          continue;
        }
        out += ".*";
        i += 2;
        continue;
      }
      out += "[^/]*";
      i += 1;
      continue;
    }

    if (ch === "?") {
      out += "[^/]";
      i += 1;
      continue;
    }

    if (ch === "[") {
      const close = glob.indexOf("]", i + (glob[i + 1] === "]" || glob[i + 1] === "!" ? 2 : 1));
      if (close < 0) {
        // An unterminated `[` is a literal bracket, not a syntax error — the config file is not
        // a program and a typo must not make a session private by accident.
        out += "\\[";
        i += 1;
        continue;
      }
      const body = glob.slice(i + 1, close);
      out += `[${body.startsWith("!") ? `^${body.slice(1)}` : body}]`;
      i = close + 1;
      continue;
    }

    if (ch === "{") {
      depth.push(out.length);
      out += "(?:";
      i += 1;
      continue;
    }
    if (ch === "}" && depth.length > 0) {
      depth.pop();
      out += ")";
      i += 1;
      continue;
    }
    if (ch === "," && depth.length > 0) {
      out += "|";
      i += 1;
      continue;
    }

    out += REGEX_SPECIAL.test(ch) ? `\\${ch}` : ch;
    i += 1;
  }
  // An unbalanced `{` leaves groups open; close them rather than throwing.
  for (let n = depth.length; n > 0; n -= 1) out += ")";
  return out;
}

/**
 * `true` when `value` matches `glob`.
 *
 * `value` is a `/`-separated relative path; the empty string is the repo root. Matching is
 * case-sensitive, like picomatch's default.
 */
export function matchGlob(value: string, glob: string): boolean {
  if (glob === "") return false;
  let source: string;
  try {
    source = toRegexSource(glob);
  } catch {
    return false;
  }
  try {
    return new RegExp(`^(?:${source})$`).test(value);
  } catch {
    // A character class the translation produced but `RegExp` rejects (`[z-a]`): no match, and
    // never a thrown error on the hook's path.
    return false;
  }
}
