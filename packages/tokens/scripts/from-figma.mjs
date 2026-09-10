/**
 * `node scripts/from-figma.mjs <export.json> [--theme <name>] [--mode <light|dark>] [--dry-run]`
 *
 * Pulls Figma variables into `tokens.json` — the one direction design values are allowed to travel
 * (design spec §14.1: "Figma variables are exported into `packages/tokens`"). Two input shapes are
 * accepted, because the operator can reach the variables two ways:
 *
 * - the REST response of `GET /v1/files/:key/variables/local`, saved to a file: a `meta` object
 *   carrying `variables` and `variableCollections`, values keyed by mode id;
 * - the Figma MCP server's `get_variable_defs` output, saved to a file: a flat
 *   `{ "<variable name>": "<value>" }` map with no collection and no mode, so the theme and mode it
 *   belongs to come from `--theme` and `--mode`.
 *
 * A collection maps to a *theme* and each of its modes to light or dark; `COLOR_GROUPS` below is
 * the whole of that mapping. Colors land in the theme's two groups; every other variable is
 * theme-independent and lands in the scale group its name points at.
 *
 * Three rules make this safe to run against a hand-tuned `tokens.json`:
 *
 * - **Key order is preserved.** The file is rewritten by splicing new `$value` literals into the
 *   original text, never by `JSON.stringify` — which reorders `"0"`, `"1"`, `"2"` … ahead of every
 *   other key and would rewrite the spacing scale on every sync.
 * - **Nothing is invented.** A variable whose name has no token counterpart is a mismatch between
 *   the Figma file and this repo, not a new token: the script writes nothing and exits 1 with the
 *   offending names, so the operator fixes one side or the other deliberately.
 * - **The generated artifacts follow.** `build-preset.mjs` runs afterwards, so `tokens.css` and
 *   `tailwind.preset.js` can never be a sync behind the tokens they come from.
 */
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import process from "node:process";

const PKG = new URL("../", import.meta.url);
const TOKENS = new URL("tokens.json", PKG);

/** px per rem — the browser default, and the base `tokens.json` is written against. */
const REM = 16;

/**
 * Which `tokens.json` color group each (theme, mode) pair writes into. The default theme is the
 * one shipped today; `dome` is the palette the Dome card target gets (design spec §14.2) and its
 * groups only exist once someone adds them — until then a dome export fails the unknown-name
 * check by name rather than writing colors into the wrong theme.
 */
const COLOR_GROUPS = {
  default: { light: ["color", "light"], dark: ["color", "dark"] },
  dome: { light: ["color", "dome-light"], dark: ["color", "dome-dark"] },
};

/** Collection name → theme. Anything that does not name a theme is the default one. */
function themeOf(collectionName) {
  return /\bdome\b/i.test(collectionName) ? "dome" : "default";
}

/** Mode name → light or dark. Figma files spell these "Light"/"Dark", "Day"/"Night", "1"/"2". */
function modeOf(modeName) {
  return /dark|night/i.test(modeName) ? "dark" : "light";
}

// ---------------------------------------------------------------------------------------------
// A position-aware JSON reader, so a rewrite can be surgical.
// ---------------------------------------------------------------------------------------------

/**
 * Indexes every `$value` leaf in `text` by its dotted token path, recording where its literal
 * starts and ends. `$`-prefixed keys are metadata and do not extend the path, so
 * `color.light.background.$value` is indexed as `color.light.background`.
 */
function indexTokens(text) {
  const found = new Map();
  let i = 0;

  const fail = (what) => {
    throw new Error(`tokens.json: expected ${what} at offset ${i}`);
  };
  const ws = () => {
    while (i < text.length && " \t\r\n".includes(text[i])) i += 1;
  };
  const string = () => {
    const start = i;
    i += 1;
    while (i < text.length) {
      if (text[i] === "\\") i += 2;
      else if (text[i] === '"') {
        i += 1;
        return { start, end: i };
      } else i += 1;
    }
    return fail("a closing quote");
  };
  const value = (path) => {
    ws();
    const c = text[i];
    if (c === "{") return object(path);
    if (c === "[") return array(path);
    if (c === '"') return string();
    const start = i;
    while (i < text.length && !",}] \t\r\n".includes(text[i])) i += 1;
    if (start === i) fail("a value");
    return { start, end: i };
  };
  const array = (path) => {
    const start = i;
    i += 1;
    ws();
    if (text[i] === "]") return { start, end: (i += 1) };
    for (;;) {
      value(path);
      ws();
      if (text[i] === ",") {
        i += 1;
        continue;
      }
      if (text[i] === "]") return { start, end: (i += 1) };
      fail("`,` or `]`");
    }
  };
  const object = (path) => {
    const start = i;
    i += 1;
    ws();
    if (text[i] === "}") return { start, end: (i += 1) };
    for (;;) {
      ws();
      if (text[i] !== '"') fail("a key");
      const key = string();
      const name = JSON.parse(text.slice(key.start, key.end));
      ws();
      if (text[i] !== ":") fail("`:`");
      i += 1;
      const span = value(name.startsWith("$") ? path : [...path, name]);
      if (name === "$value") found.set(path.join("."), span);
      ws();
      if (text[i] === ",") {
        i += 1;
        continue;
      }
      if (text[i] === "}") return { start, end: (i += 1) };
      fail("`,` or `}`");
    }
  };

  value([]);
  return found;
}

// ---------------------------------------------------------------------------------------------
// Figma values → token values
// ---------------------------------------------------------------------------------------------

const hexByte = (channel) =>
  Math.round(Math.min(1, Math.max(0, channel)) * 255)
    .toString(16)
    .padStart(2, "0");

/** `{ r, g, b, a }` in 0–1 floats → `#rrggbb`, or `#rrggbbaa` when the alpha is not opaque. */
function hex({ r, g, b, a }) {
  const rgb = `#${hexByte(r)}${hexByte(g)}${hexByte(b)}`;
  return a === undefined || a >= 1 ? rgb : `${rgb}${hexByte(a)}`;
}

/** Figma measures in px; `tokens.json` is written in rem, so every number converts on the way in. */
function rem(px) {
  const n = px / REM;
  return `${Number(n.toFixed(6))}rem`;
}

/** One Figma value → the string a `$value` holds. */
function tokenValue(name, raw) {
  if (typeof raw === "number") return rem(raw);
  if (raw !== null && typeof raw === "object") {
    if (typeof raw.r === "number") return hex(raw);
    throw new Error(`variable "${name}": unsupported value ${JSON.stringify(raw)}`);
  }
  if (typeof raw === "string") {
    const px = /^(-?\d+(?:\.\d+)?)px$/.exec(raw.trim());
    if (px) return rem(Number(px[1]));
    if (/^-?\d+(?:\.\d+)?$/.test(raw.trim())) return rem(Number(raw));
    return raw;
  }
  throw new Error(`variable "${name}": unsupported value ${JSON.stringify(raw)}`);
}

/**
 * A Figma variable name (`color/background`, `type/size/base`) plus the theme and mode it was read
 * under → the dotted token path it should land on. Colors are the only theme-aware family.
 */
function tokenPath(name, theme, mode) {
  const parts = name
    .split("/")
    .map((part) => part.trim())
    .filter((part) => part !== "");
  if (parts.length === 0) return null;
  if (parts[0] !== "color") return parts.join(".");
  const group = COLOR_GROUPS[theme]?.[mode];
  return group === undefined ? null : [...group, ...parts.slice(1)].join(".");
}

// ---------------------------------------------------------------------------------------------
// Export readers
// ---------------------------------------------------------------------------------------------

/**
 * Both shapes reduce to the same thing: a list of
 * `{ name, theme, mode, value }` readings, one per variable per mode.
 */
function readings(exported, options) {
  const meta = exported?.meta ?? exported;
  if (meta && typeof meta === "object" && meta.variables && meta.variableCollections) {
    return restReadings(meta);
  }
  if (exported && typeof exported === "object" && !Array.isArray(exported)) {
    return Object.entries(exported).map(([name, value]) => ({
      name,
      theme: options.theme,
      mode: options.mode,
      value,
    }));
  }
  throw new Error("unrecognised export: expected a Figma variables response or a name→value map");
}

/** The REST `GET /v1/files/:key/variables/local` shape. */
function restReadings(meta) {
  const out = [];
  for (const variable of Object.values(meta.variables)) {
    const collection = meta.variableCollections[variable.variableCollectionId];
    if (collection === undefined) {
      throw new Error(`variable "${variable.name}" names a collection the export does not carry`);
    }
    const theme = themeOf(collection.name ?? "");
    for (const [modeId, value] of Object.entries(variable.valuesByMode ?? {})) {
      const modeName = collection.modes?.find((m) => m.modeId === modeId)?.name ?? modeId;
      out.push({ name: variable.name, theme, mode: modeOf(modeName), value });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------------------------

function parseArgs(argv) {
  const options = { file: undefined, theme: "default", mode: "light", dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--theme") options.theme = argv[(i += 1)];
    else if (arg === "--mode") options.mode = argv[(i += 1)];
    else if (arg.startsWith("-")) throw new Error(`unknown option ${arg}`);
    else if (options.file === undefined) options.file = arg;
    else throw new Error("only one export file may be given");
  }
  if (options.file === undefined) throw new Error("usage: from-figma.mjs <export.json> [--theme <name>] [--mode <light|dark>] [--dry-run]");
  if (COLOR_GROUPS[options.theme] === undefined) throw new Error(`unknown theme "${options.theme}"`);
  if (options.mode !== "light" && options.mode !== "dark") throw new Error(`unknown mode "${options.mode}"`);
  return options;
}

export async function sync(argv, io = console) {
  const options = parseArgs(argv);
  const text = readFileSync(TOKENS, "utf8");
  const index = indexTokens(text);
  const exported = JSON.parse(readFileSync(options.file, "utf8"));

  const unknown = [];
  /** dotted path → { value, from } — `from` is the variable name, for the conflict message. */
  const wanted = new Map();

  for (const reading of readings(exported, options)) {
    const path = tokenPath(reading.name, reading.theme, reading.mode);
    if (path === null || !index.has(path)) {
      unknown.push(`${reading.name} (${reading.theme}/${reading.mode}) → ${path ?? "no token path"}`);
      continue;
    }
    const value = tokenValue(reading.name, reading.value);
    const already = wanted.get(path);
    if (already !== undefined && already.value !== value) {
      throw new Error(
        `token "${path}" is written twice with different values: ` +
          `"${already.value}" from ${already.from}, "${value}" from ${reading.name}`,
      );
    }
    wanted.set(path, { value, from: reading.name });
  }

  if (unknown.length > 0) {
    io.error(`from-figma: ${unknown.length} Figma variable(s) have no token counterpart:`);
    for (const line of [...new Set(unknown)].sort()) io.error(`  ${line}`);
    io.error("from-figma: nothing was written. Add the token to tokens.json or rename the Figma variable.");
    return 1;
  }

  const edits = [];
  const changes = [];
  for (const [path, { value }] of wanted) {
    const span = index.get(path);
    const before = JSON.parse(text.slice(span.start, span.end));
    if (before === value) continue;
    edits.push({ ...span, text: JSON.stringify(value) });
    changes.push({ path, before, after: value });
  }

  if (changes.length === 0) {
    io.log(`from-figma: ${wanted.size} variable(s) read, no token changes`);
  } else {
    io.log(`from-figma: ${changes.length} of ${wanted.size} token(s) changed`);
    const width = Math.max(...changes.map((c) => c.path.length));
    for (const c of changes.sort((a, b) => a.path.localeCompare(b.path))) {
      io.log(`  ~ ${c.path.padEnd(width)}  ${c.before} → ${c.after}`);
    }
  }

  if (options.dryRun) {
    io.log("from-figma: --dry-run, nothing written");
    return 0;
  }

  if (edits.length > 0) {
    let next = text;
    for (const edit of edits.sort((a, b) => b.start - a.start)) {
      next = next.slice(0, edit.start) + edit.text + next.slice(edit.end);
    }
    writeFileSync(TOKENS, next);
    io.log(`from-figma: wrote ${fileURLToPath(TOKENS)}`);
  }

  // Always regenerate: `tokens.css` and `tailwind.preset.js` may be stale for reasons that have
  // nothing to do with this sync, and running the generator is cheap and deterministic.
  await import("./build-preset.mjs");
  return 0;
}

/**
 * `import.meta.main` is Node 24+, so entry detection is the argv comparison every version supports
 * — through `realpathSync`, because `import.meta.url` is already resolved and `argv[1]` is not: on
 * macOS a `mktemp -d` path runs through a `/var` → `/private/var` symlink, and the unresolved
 * comparison silently made the whole script a no-op that still exited 0.
 */
const invoked = process.argv[1] === undefined ? "" : realpathSync(process.argv[1]);
if (invoked === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await sync(process.argv.slice(2));
  } catch (error) {
    console.error(`from-figma: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
