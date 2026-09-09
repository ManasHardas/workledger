/**
 * `workledger checkpoint [--session <ulid>] [--dry-run]` — docs/contracts/p1/cli.md.
 *
 * The only validated write path into the ledger. Reads a `CheckpointPayload` on stdin and runs
 * the contract's eight numbered steps in order, each failing fast; on any failure nothing is
 * written and the exit code says why (`checkpoint` fails closed, data-flow §7).
 *
 * Everything this file does to a payload or a ledger file is done by calling `@workledger/core`
 * — validation, secret scanning, session and backlog rendering — and everything it does to the
 * index is done by calling `src/index/db.ts`. What is left here is the ordering, the resolution
 * rules, and the two side effects core is forbidden to have: the filesystem and SQLite.
 */
import { Readable } from "node:stream";
import process from "node:process";

import {
  MAX_PAYLOAD_BYTES,
  RenderError,
  TRIGGERS,
  appendCheckpoint as renderCheckpoint,
  applyUpdate,
  closeItem,
  createItem,
  formatFindings,
  newBacklogId,
  parseSessionText,
  requiresGoal,
  scanText,
  scanValue,
  validateCheckpointPayload,
} from "@workledger/core";
import type {
  Checkpoint,
  CheckpointPayload,
  CheckpointSummary,
  Finding,
  RemainingItem,
  ResolvedRef,
  SessionFrontmatter,
  Trigger,
  UnparsedLine,
} from "@workledger/core";

import { EXIT_NOT_ENABLED, EXIT_OK, EXIT_SECRET, EXIT_USAGE } from "../exit-codes.js";
import { openIndex } from "../index/db.js";
import {
  backlogFile,
  fileSize,
  findRepoRoot,
  isEnabled,
  listOpenBacklogIds,
  readTextFile,
  sessionFile,
  writeFileAtomic,
} from "../ledger-fs.js";
import type { IndexDb, SessionRow } from "../index/db.js";

/** Options commander parses for `checkpoint`. */
export interface CheckpointOptions {
  /** The session ulid, when the index lookup would otherwise be ambiguous. */
  session?: string;
  /** Perform steps 1–6 and print the would-be stdout line prefixed `dry-run:`. */
  dryRun?: boolean;
}

/**
 * Everything the command touches outside itself, so a test can drive the whole path without a
 * child process: stdin, the two output streams, the working directory, and the two sources of
 * nondeterminism (the clock and the ULID factory).
 */
export interface CheckpointIo {
  /** The raw payload bytes. The cap is measured on these, before any parsing (step 2). */
  readStdin: () => Promise<Buffer>;
  /** One contracted stdout line; the newline is added here. */
  stdout: (line: string) => void;
  /** One stderr line; the newline is added here. */
  stderr: (line: string) => void;
  /** Where the repo-root walk starts. */
  cwd: string;
  /** `WORKLEDGER_SESSION`, or `undefined` when unset. */
  envSession?: string | undefined;
  /** Overrides `WORKLEDGER_HOME` for the index. */
  home?: string | undefined;
  now: () => Date;
  /** Mints the `WL-<ulid>` for a `new: true` Remaining item. */
  newId: () => string;
}

/** The path prefix a payload-level error is reported under when it has no field of its own. */
const PAYLOAD_PATH = "(payload)";

/** Which triggers the index may legally carry into a stamp. */
const TRIGGER_VALUES = new Set<string>(TRIGGERS);

/** A backlog file this checkpoint renders, held until every text has been scanned (step 6). */
interface PendingBacklogWrite {
  id: string;
  file: string;
  text: string;
}

/** Read a stream to the end, stopping once `limit` bytes have been exceeded. */
async function readAll(stream: NodeJS.ReadableStream, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const buffer = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
    chunks.push(buffer);
    total += buffer.length;
    // One byte past the limit is already enough to reject it; there is no reason to buffer the
    // rest of what an agent piped in.
    if (total > limit) break;
  }
  return Buffer.concat(chunks);
}

/** The real environment: process stdin, the process streams, the wall clock, a fresh ULID. */
function processIo(): CheckpointIo {
  return {
    readStdin: () => readAll(process.stdin, MAX_PAYLOAD_BYTES + 1),
    stdout: (line) => void process.stdout.write(`${line}\n`),
    stderr: (line) => void process.stderr.write(`${line}\n`),
    cwd: process.cwd(),
    envSession: process.env["WORKLEDGER_SESSION"]?.trim() || undefined,
    home: process.env["WORKLEDGER_HOME"]?.trim() || undefined,
    now: () => new Date(),
    newId: newBacklogId,
  };
}

/** The stdout line of step 8, built from what the renderer counted. */
export function ackLine(n: number, summary: CheckpointSummary): string {
  return (
    `checkpoint ${n} recorded: ${summary.done} done, ${summary.remaining} remaining ` +
    `(${summary.newItems} new, ${summary.closed} closed), ${summary.questions} question(s)`
  );
}

/** Turn a render failure into the stderr lines the contract shapes errors as. */
function renderErrorLines(error: RenderError): string[] {
  return error.details.length > 0 ? [...error.details] : [`${PAYLOAD_PATH}: ${error.message}`];
}

/**
 * The stamp's `trigger`: the block that asked for this checkpoint, else `manual`
 * (data-flow §2, `checkpoint (agent-invoked)`).
 *
 * A trigger the index cannot vouch for — no pending block, a null column, or a value this build
 * does not know — degrades to `manual` rather than failing the checkpoint: the trigger is
 * provenance, and losing it is not worth refusing a valid digest over.
 */
export function stampTrigger(session: SessionRow): Trigger {
  if (session.blocks_since_checkpoint <= 0) return "manual";
  const recorded = session.last_block_trigger;
  if (recorded !== null && TRIGGER_VALUES.has(recorded)) return recorded as Trigger;
  return "manual";
}

/**
 * Byte size of the session's transcript, which is what `transcript_offset` records: checkpoint
 * `n` covers `[offset(n-1), offset(n))` (data-flow §4). An unreadable or unrecorded transcript
 * leaves the offset where the index last put it, so the span never runs backwards.
 */
export function stampOffset(session: SessionRow): number {
  const size = session.transcript_path === null ? undefined : fileSize(session.transcript_path);
  return size ?? session.last_offset;
}

/**
 * Step 1: resolve the session — `--session`, else `WORKLEDGER_SESSION`, else the single open
 * session for this repo. Two or more open sessions is a usage error naming them (data-flow §3).
 */
function resolveSession(
  db: IndexDb,
  repoRoot: string,
  explicit: string | undefined,
): { session: SessionRow } | { errors: string[] } {
  if (explicit !== undefined) {
    const session = db.getSessionByUlid(explicit);
    if (session === undefined) return { errors: [`--session: no session ${explicit} in the index`] };
    return { session };
  }

  const open = db.listOpenSessions(repoRoot);
  if (open.length === 1) return { session: open[0] as SessionRow };
  if (open.length === 0) {
    return {
      errors: [
        `--session: no open session for ${repoRoot}; pass --session <ulid> or set WORKLEDGER_SESSION`,
      ],
    };
  }
  return {
    errors: [
      `--session: ${open.length} open sessions for ${repoRoot}; pass --session <ulid>`,
      `open sessions: ${open.map((row) => row.ulid).join(", ")}`,
    ],
  };
}

/**
 * Step 2, cross-file half: every `ref` a payload names must be an *open* backlog item. The list
 * of ids an agent may use is printed with the error, because the agent has no other way to
 * discover it from inside the session.
 */
function checkRefs(payload: CheckpointPayload, openIds: readonly string[]): string[] {
  const known = new Set(openIds);
  const errors: string[] = [];
  payload.remaining.forEach((item, index) => {
    if (item.ref !== undefined && !known.has(item.ref)) {
      errors.push(`remaining[${index}].ref: ${item.ref} is not an open backlog item`);
    }
  });
  if (errors.length > 0) errors.push(`open backlog ids: ${openIds.join(", ")}`);
  return errors;
}

/**
 * Step 5, first half: decide which backlog id each Remaining item points at. A `new: true` item
 * mints one here — the ULID is generated in-process and needs no coordination (data-flow §3) —
 * and a `ref` + `rel` item keeps the id it named, already checked against the open list.
 */
function resolveRefs(payload: CheckpointPayload, newId: () => string): Map<string, ResolvedRef> {
  const refs = new Map<string, ResolvedRef>();
  payload.remaining.forEach((item, index) => {
    if (item.new === true) refs.set(String(index), { id: newId(), rel: "new" });
    else if (item.ref !== undefined && item.rel !== undefined) {
      refs.set(String(index), { id: item.ref, rel: item.rel });
    }
  });
  return refs;
}

/**
 * Step 5, second half: render the backlog file each Remaining item implies. Returns the texts
 * rather than writing them, so step 6 can scan every rendered byte before any of it lands.
 */
function renderBacklog(
  repoRoot: string,
  payload: CheckpointPayload,
  refs: ReadonlyMap<string, ResolvedRef>,
  frontmatter: SessionFrontmatter,
  n: number,
  at: string,
): PendingBacklogWrite[] {
  const writes: PendingBacklogWrite[] = [];
  payload.remaining.forEach((item: RemainingItem, index) => {
    const ref = refs.get(String(index));
    if (ref === undefined) return;
    const file = backlogFile(repoRoot, ref.id);

    if (ref.rel === "new") {
      const text = createItem({
        id: ref.id,
        title: item.text,
        why: item.why,
        provenance: {
          harness: frontmatter.harness,
          session: frontmatter.id,
          checkpoint: n,
          author: frontmatter.author,
        },
        blockedBy: item.blocked_by ?? [],
        now: at,
      });
      writes.push({ id: ref.id, file, text });
      return;
    }

    const existing = readTextFile(file);
    if (existing === undefined) {
      throw new RenderError(`backlog item ${ref.id} has no file`, "invalid-document", [
        `remaining[${index}].ref: ${ref.id} has no file under .workledger/backlog/`,
      ]);
    }
    const result =
      ref.rel === "closes"
        ? closeItem(existing, { session: frontmatter.id, checkpoint: n, now: at })
        : applyUpdate(existing, {
            session: frontmatter.id,
            checkpoint: n,
            why: item.why,
            now: at,
          });
    writes.push({ id: ref.id, file, text: result.text });
  });
  return writes;
}

/** Step 6: scan every rendered byte. Ledger-relative labels, so a finding names a file. */
function scanRendered(
  ulid: string,
  sessionText: string,
  backlog: readonly PendingBacklogWrite[],
): Finding[] {
  const findings = scanText(sessionText, `sessions/${ulid}.md`);
  for (const write of backlog) {
    findings.push(...scanText(write.text, `backlog/${write.id}.md`));
  }
  return findings;
}

/**
 * The whole command, with its environment injected.
 *
 * Split out from {@link checkpointCommand} so the contract's steps can be driven from a test
 * worker against a temp repo and a temp `WORKLEDGER_HOME` — a checkpoint's observable behavior
 * is what it writes, and a test that cannot see the writes is not testing the contract.
 */
export async function runCheckpoint(
  options: CheckpointOptions,
  io: CheckpointIo,
): Promise<number> {
  const dryRun = options.dryRun === true;

  const repoRoot = findRepoRoot(io.cwd);
  if (repoRoot === undefined || !isEnabled(repoRoot)) {
    io.stderr(`workledger: ${io.cwd} is not an enabled repo; run \`workledger init\` first`);
    return EXIT_NOT_ENABLED;
  }

  const db = openIndex(io.home === undefined ? {} : { home: io.home });
  try {
    // --- Step 1: resolve the session -------------------------------------------------------
    const explicit = options.session ?? io.envSession;
    const resolved = resolveSession(db, repoRoot, explicit);
    if ("errors" in resolved) {
      for (const line of resolved.errors) io.stderr(line);
      // No session means no index row to record the attempt against; a usage error at step 1 is
      // not something the Stop hook can retry-block on anyway.
      return EXIT_USAGE;
    }
    const session = resolved.session;
    const ulid = session.ulid;

    /** Report a failure the way the contract shapes it, and cache it for the Stop hook (§2). */
    const fail = (exit: number, lines: readonly string[]): number => {
      for (const line of lines) io.stderr(line);
      // A dry run is a rehearsal, not an attempt: recording it would let a failed `--dry-run`
      // raise BLOCK #2 on the next Stop for a checkpoint the agent never tried to record.
      if (!dryRun) {
        db.recordAttempt(ulid, {
          at: io.now().toISOString(),
          exit,
          errors: lines.join("\n"),
        });
      }
      return exit;
    };

    // --- Step 2: byte cap, parse, validate --------------------------------------------------
    const raw = await io.readStdin();
    if (raw.byteLength > MAX_PAYLOAD_BYTES) {
      return fail(EXIT_USAGE, [
        `${PAYLOAD_PATH}: ${raw.byteLength} bytes on stdin, over the ${MAX_PAYLOAD_BYTES}-byte limit`,
      ]);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString("utf8")) as unknown;
    } catch (error) {
      return fail(EXIT_USAGE, [
        `${PAYLOAD_PATH}: ${error instanceof Error ? error.message : String(error)}`,
      ]);
    }

    const validation = validateCheckpointPayload(parsed);
    if (!validation.ok) {
      return fail(
        EXIT_USAGE,
        validation.errors.map((issue) => `${issue.path}: ${issue.message}`),
      );
    }
    const payload = validation.value;

    // `n` is predicted here so the goal rule can be checked with the rest of validation; the
    // number that actually lands is allocated inside the write transaction below.
    const predictedN = db.nextCheckpointNumber(ulid);
    if (requiresGoal(predictedN) && payload.goal === undefined) {
      return fail(EXIT_USAGE, ["goal: required at checkpoint 1"]);
    }

    const refErrors = checkRefs(payload, listOpenBacklogIds(repoRoot));
    if (refErrors.length > 0) return fail(EXIT_USAGE, refErrors);

    // --- Step 3: secret-scan the payload ----------------------------------------------------
    const payloadFindings = scanValue(payload);
    if (payloadFindings.length > 0) return fail(EXIT_SECRET, formatFindings(payloadFindings));

    // --- Step 4: the stamp ------------------------------------------------------------------
    const at = io.now().toISOString();
    const offset = stampOffset(session);
    const draft = {
      at,
      transcript_offset: offset,
      turns: session.turns_total,
      trigger: stampTrigger(session),
    };

    const sessionPath = sessionFile(repoRoot, ulid);
    const sessionText = readTextFile(sessionPath);
    if (sessionText === undefined) {
      return fail(EXIT_USAGE, [
        `--session: session ${ulid} has no file at .workledger/sessions/${ulid}.md`,
      ]);
    }

    let parsedSession;
    try {
      parsedSession = parseSessionText(sessionText);
    } catch (error) {
      if (error instanceof RenderError) return fail(EXIT_USAGE, renderErrorLines(error));
      throw error;
    }

    // A hand-edited line is kept verbatim by the renderer rather than dropped, but the operator
    // should know the file has drifted. Only the section and the count are reported: the line
    // itself has not been through the scanner.
    for (const [section, count] of countUnparsed(parsedSession.unparsed)) {
      io.stderr(`workledger: sessions/${ulid}.md: ${count} unparsed line(s) under ${section}`);
    }

    /**
     * Steps 5–7 for one allocated `n`. On the write path this runs inside the index's
     * `BEGIN IMMEDIATE`, so two concurrent invocations for one session serialize and the second
     * renders against `n + 1` (data-flow §3); a throw from here rolls the row back.
     */
    const render = (
      n: number,
      write: boolean,
    ): { summary: CheckpointSummary; findings: Finding[] } => {
      const refs = resolveRefs(payload, io.newId);
      const stamp: Checkpoint = { n, ...draft };
      const rendered = renderCheckpoint(sessionText, payload, stamp, refs);
      const backlog = renderBacklog(repoRoot, payload, refs, parsedSession.frontmatter, n, at);

      // --- Step 6 ---------------------------------------------------------------------------
      const findings = scanRendered(ulid, rendered.text, backlog);
      if (findings.length > 0 || !write) return { summary: rendered.summary, findings };

      // --- Step 7: atomic writes ------------------------------------------------------------
      writeFileAtomic(sessionPath, rendered.text);
      for (const item of backlog) writeFileAtomic(item.file, item.text);
      return { summary: rendered.summary, findings };
    };

    if (dryRun) {
      try {
        const { summary, findings } = render(predictedN, false);
        if (findings.length > 0) return fail(EXIT_SECRET, formatFindings(findings));
        io.stdout(`dry-run: ${ackLine(predictedN, summary)}`);
        return EXIT_OK;
      } catch (error) {
        if (error instanceof RenderError) return fail(EXIT_USAGE, renderErrorLines(error));
        throw error;
      }
    }

    let summary: CheckpointSummary | undefined;
    let findings: Finding[] = [];
    let row;
    try {
      row = db.appendCheckpoint(ulid, (n) => {
        const result = render(n, true);
        if (result.findings.length > 0) {
          // Roll the `checkpoints` row back: step 6 is a hard stop and nothing may be recorded.
          throw new SecretDetected(result.findings);
        }
        summary = result.summary;
        return draft;
      });
    } catch (error) {
      if (error instanceof SecretDetected) {
        findings = error.findings;
        return fail(EXIT_SECRET, formatFindings(findings));
      }
      if (error instanceof RenderError) return fail(EXIT_USAGE, renderErrorLines(error));
      throw error;
    }

    // --- Step 7, index half, and step 8 -----------------------------------------------------
    db.resetAfterCheckpoint(ulid, { offset, at });
    io.stdout(ackLine(row.n, summary as CheckpointSummary));
    return EXIT_OK;
  } finally {
    db.close();
  }
}

/** Carries step 6's findings out of the write transaction so the row is rolled back first. */
class SecretDetected extends Error {
  readonly findings: Finding[];
  constructor(findings: Finding[]) {
    super("secret detected in the rendered ledger text");
    this.name = "SecretDetected";
    this.findings = findings;
  }
}

/** How many unparsed lines each section of a session file carries, sections with none omitted. */
function countUnparsed(unparsed: readonly UnparsedLine[]): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const line of unparsed) counts.set(line.section, (counts.get(line.section) ?? 0) + 1);
  return [...counts.entries()];
}

/** @returns the process exit code. Async so an implementing slot never has to widen it. */
export async function checkpointCommand(options: CheckpointOptions): Promise<number> {
  return runCheckpoint(options, processIo());
}

/** Wrap a string as the stdin of a {@link CheckpointIo} — the shape tests hand `runCheckpoint`. */
export function stdinFrom(text: string): () => Promise<Buffer> {
  return () => readAll(Readable.from([Buffer.from(text, "utf8")]), MAX_PAYLOAD_BYTES + 1);
}
