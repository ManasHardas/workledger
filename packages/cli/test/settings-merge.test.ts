/**
 * `src/settings-merge.ts` — the `.claude/settings.json` merge (#13).
 *
 * This is the only P1 write outside `.workledger/`, and it edits a file the user owns, so the
 * assertions here are the destructive ones: foreign hooks survive, foreign top-level keys
 * survive, the written block is the contract's byte for byte, a second run writes nothing, and
 * a `.bak` exists before the new content does.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  HOOKED_EVENTS,
  HOOK_TIMEOUT_SECONDS,
  SettingsError,
  hookCommandString,
  mergeHooks,
  mergeSettingsFile,
  unifiedDiff,
} from "../src/settings-merge.js";
import type { SettingsIo } from "../src/settings-merge.js";

/** A `.claude/settings.json` with an unrelated `PreToolUse` hook and an unrelated `Stop` entry. */
const FOREIGN = {
  $schema: "https://json.schemastore.org/claude-code-settings.json",
  permissions: { allow: ["Bash(git status)"] },
  hooks: {
    PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo pre" }] }],
    Stop: [{ hooks: [{ type: "command", command: "echo mine", timeout: 5 }] }],
  },
};

/** A temp repo root, optionally seeded with `settings.json`. */
function repo(settings?: unknown): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "workledger-settings-"));
  if (settings !== undefined) {
    mkdirSync(path.join(root, ".claude"), { recursive: true });
    writeFileSync(
      path.join(root, ".claude", "settings.json"),
      `${JSON.stringify(settings, null, 2)}\n`,
      "utf8",
    );
  }
  return root;
}

/** A collecting `SettingsIo` that always answers the confirmation with `answer`. */
function io(answer = true): SettingsIo & { lines: string[]; asked: string[] } {
  const lines: string[] = [];
  const asked: string[] = [];
  return {
    lines,
    asked,
    stdout: (line) => void lines.push(line),
    confirm: async (question) => {
      asked.push(question);
      return answer;
    },
  };
}

/** Read back `<root>/.claude/settings.json`. */
function read(root: string): { text: string; json: Record<string, unknown> } {
  const text = readFileSync(path.join(root, ".claude", "settings.json"), "utf8");
  return { text, json: JSON.parse(text) as Record<string, unknown> };
}

describe("settings merge", () => {
  it("foreign hooks are preserved", async () => {
    const root = repo(FOREIGN);
    const out = io();

    await mergeSettingsFile(root, out, false);
    const { json } = read(root);

    const hooks = json["hooks"] as Record<string, unknown[]>;
    expect(hooks["PreToolUse"]).toEqual(FOREIGN.hooks.PreToolUse);
    expect(hooks["Stop"]![0]).toEqual(FOREIGN.hooks.Stop[0]);
    expect(hooks["Stop"]).toHaveLength(2);
    // And the keys that have nothing to do with hooks.
    expect(json["$schema"]).toBe(FOREIGN.$schema);
    expect(json["permissions"]).toEqual(FOREIGN.permissions);
  });

  it("the written block matches the frozen contract", async () => {
    const root = repo();
    await mergeSettingsFile(root, io(), false);
    const { json } = read(root);

    expect(json).toEqual({
      hooks: {
        SessionStart: [
          {
            hooks: [
              {
                type: "command",
                command:
                  "if command -v workledger >/dev/null 2>&1; then exec workledger hook SessionStart; fi",
                timeout: 10,
              },
            ],
          },
        ],
        Stop: [
          {
            hooks: [
              {
                type: "command",
                command:
                  "if command -v workledger >/dev/null 2>&1; then exec workledger hook Stop; fi",
                timeout: 10,
              },
            ],
          },
        ],
        SessionEnd: [
          {
            hooks: [
              {
                type: "command",
                command:
                  "if command -v workledger >/dev/null 2>&1; then exec workledger hook SessionEnd; fi",
                timeout: 10,
              },
            ],
          },
        ],
      },
    });
    // `Stop` has no matcher support, so the group must not carry one.
    for (const group of (json["hooks"] as Record<string, unknown[]>)["Stop"]!) {
      expect(Object.keys(group as object)).toEqual(["hooks"]);
    }
    expect(HOOK_TIMEOUT_SECONDS).toBe(10);
  });

  it("a second merge is a no-op", async () => {
    const root = repo(FOREIGN);
    const first = io();
    await mergeSettingsFile(root, first, false);
    const after = read(root).text;

    const second = io();
    const outcome = await mergeSettingsFile(root, second, false);

    expect(outcome.status).toBe("unchanged");
    expect(outcome.diff).toBe("");
    expect(second.lines).toEqual([]);
    expect(read(root).text).toBe(after);
    for (const event of HOOKED_EVENTS) {
      const groups = (read(root).json["hooks"] as Record<string, unknown[]>)[event]!;
      const ours = JSON.stringify(groups).split(hookCommandString(event)).length - 1;
      expect(ours, event).toBe(1);
    }
  });

  it("a .bak is written and the diff is printed before any write", async () => {
    const root = repo(FOREIGN);
    const before = read(root).text;
    const out = io();

    const outcome = await mergeSettingsFile(root, out, true);

    expect(outcome.status).toBe("written");
    expect(outcome.backup).toBe(path.join(root, ".claude", "settings.json.bak"));
    expect(readFileSync(outcome.backup!, "utf8")).toBe(before);
    // The diff reached stdout, and the confirmation was asked after it.
    expect(out.lines[0]).toBe("--- a/.claude/settings.json");
    expect(out.lines.some((line) => line.startsWith("@@"))).toBe(true);
    expect(out.lines.some((line) => line.includes(hookCommandString("Stop")) && line.startsWith("+"))).toBe(true);
    expect(out.asked).toHaveLength(1);
    expect(out.asked[0]).toContain(outcome.file);
  });

  it("declining leaves the file untouched and writes no backup", async () => {
    const root = repo(FOREIGN);
    const before = read(root).text;

    const outcome = await mergeSettingsFile(root, io(false), true);

    expect(outcome.status).toBe("declined");
    expect(read(root).text).toBe(before);
    expect(existsSync(path.join(root, ".claude", "settings.json.bak"))).toBe(false);
  });

  it("no backup is written when there was no file", async () => {
    const root = repo();
    const outcome = await mergeSettingsFile(root, io(), false);

    expect(outcome.status).toBe("written");
    expect(outcome.backup).toBeUndefined();
    expect(existsSync(path.join(root, ".claude", "settings.json.bak"))).toBe(false);
  });

  it("corrects a stale workledger command in place instead of duplicating it", () => {
    const stale = {
      hooks: {
        Stop: [{ hooks: [{ type: "command", command: "command -v workledger && workledger hook Stop", timeout: 5 }] }],
      },
    };
    const { settings, changed } = mergeHooks(stale);

    expect(changed).toBe(true);
    const groups = (settings["hooks"] as Record<string, unknown[]>)["Stop"]!;
    expect(groups).toHaveLength(1);
    expect(groups[0]).toEqual({
      hooks: [{ type: "command", command: hookCommandString("Stop"), timeout: 10 }],
    });
  });

  it("never mutates the settings object it was given", () => {
    const input = structuredClone(FOREIGN) as unknown as Record<string, unknown>;
    mergeHooks(input);

    expect(input).toEqual(FOREIGN);
  });

  it("refuses a settings file whose shape the merge cannot preserve", async () => {
    expect(() => mergeHooks({ hooks: "nope" })).toThrow(SettingsError);
    expect(() => mergeHooks({ hooks: { Stop: "nope" } })).toThrow(/hooks\.Stop/);

    const broken = repo();
    mkdirSync(path.join(broken, ".claude"), { recursive: true });
    writeFileSync(path.join(broken, ".claude", "settings.json"), "{ not json", "utf8");
    await expect(mergeSettingsFile(broken, io(), false)).rejects.toThrow(SettingsError);
  });
});

describe("unifiedDiff", () => {
  it("is empty for equal texts", () => {
    expect(unifiedDiff("a\nb\n", "a\nb\n", "f")).toBe("");
  });

  it("renders one hunk with the diff -u header, signs and ranges", () => {
    const diff = unifiedDiff("a\nb\nc\n", "a\nB\nc\n", "f");

    expect(diff).toBe(["--- a/f", "+++ b/f", "@@ -1,3 +1,3 @@", " a", "-b", "+B", " c", ""].join("\n"));
  });

  it("splits distant changes into separate hunks", () => {
    const before = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
    const after = before.replace("line 1\n", "line one\n").replace("line 18", "line eighteen");
    const diff = unifiedDiff(before, after, "f");

    expect(diff.split("\n").filter((line) => line.startsWith("@@"))).toHaveLength(2);
  });
});
