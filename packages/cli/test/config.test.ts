/**
 * `.workledger/config.yaml` — the full-validation half of `src/config.ts` (#13).
 *
 * The fast hook loader (`parseConfig` / `loadConfig`) is covered by `hook.test.ts`; what is
 * asserted here is the pair of properties cli.md §`.workledger/config.yaml` fixes: unknown keys
 * are preserved and ignored, and an invalid file is *reported* (by `doctor`, through
 * `checkConfigFile`) while `hook` treats it as defaults and never throws.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_CONFIG,
  DEFAULT_CONFIG_YAML,
  checkConfigFile,
  configFile,
  loadConfig,
} from "../src/config.js";

/** A temp repo whose `.workledger/config.yaml` holds `text` (or which has none at all). */
function repoWith(text?: string): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "workledger-config-"));
  mkdirSync(path.join(root, ".workledger"), { recursive: true });
  if (text !== undefined) writeFileSync(configFile(root), text, "utf8");
  return root;
}

describe("config.yaml", () => {
  it("defaults match the frozen config.yaml", async () => {
    const root = repoWith(DEFAULT_CONFIG_YAML);
    const check = await checkConfigFile(root);

    expect(check.errors).toEqual([]);
    expect(check.config).toEqual({
      schema_version: 1,
      harnesses: ["claude-code"],
      thresholds: { bytes: 2000000, minutes: 20, turns: 15 },
      brief: { inject: true, max_tokens: 2000 },
      stale_turns: 5,
      orphan_minutes: 30,
      private_paths: [],
      auto_commit: false,
      // P5 additions (docs/contracts/p5/config-and-identities.md).
      identities_file: "identities.yaml",
      // P3 additions (docs/contracts/p3/cli.md §Config additions). `Config` is loose, so
      // these pass through validation unchanged and reach the fast loader as typed values.
      backfill: { since: "14d", concurrency: 2, seconds_per_session: 45 },
      extract: {
        model: "claude-haiku-4-5",
        usd_per_million_input: 1,
        usd_per_million_output: 5,
      },
    });
    // And the fast loader reads the same file to the same values.
    expect(loadConfig(root)).toEqual(DEFAULT_CONFIG);
  });

  it("unknown keys survive a load", async () => {
    const root = repoWith(`${DEFAULT_CONFIG_YAML}future_knob: 7\nnested: { a: b }\n`);
    const check = await checkConfigFile(root);

    expect(check.errors).toEqual([]);
    expect(check.raw?.["future_knob"]).toBe(7);
    expect(check.config?.["future_knob"]).toBe(7);
    expect(check.config?.["nested"]).toEqual({ a: "b" });
  });

  it("an invalid file falls back to defaults without throwing", async () => {
    const root = repoWith("thresholds: { bytes: -1 }\nstale_turns: 0\nschema_version: 9\n");

    // `hook` fails open …
    expect(() => loadConfig(root)).not.toThrow();
    expect(loadConfig(root).thresholds.bytes).toBe(DEFAULT_CONFIG.thresholds.bytes);
    expect(loadConfig(root).stale_turns).toBe(DEFAULT_CONFIG.stale_turns);

    // … and `doctor` reports it, one line per failure, naming the key.
    const check = await checkConfigFile(root);
    expect(check.present).toBe(true);
    expect(check.config).toBeUndefined();
    expect(check.errors.length).toBeGreaterThan(0);
    expect(check.errors.join("\n")).toContain("schema_version");
  });

  it("reports unparseable YAML rather than throwing", async () => {
    const root = repoWith("thresholds: { bytes: 1\nbrief: [\n");
    const check = await checkConfigFile(root);

    expect(check.present).toBe(true);
    expect(check.errors).toHaveLength(1);
    expect(check.errors[0]).not.toContain("frontmatter");
    expect(loadConfig(root).brief.max_tokens).toBe(DEFAULT_CONFIG.brief.max_tokens);
  });

  it("accepts a leading `---` and refuses a second document", async () => {
    const withMarker = await checkConfigFile(repoWith(`---\n${DEFAULT_CONFIG_YAML}`));
    expect(withMarker.errors).toEqual([]);

    const twoDocuments = await checkConfigFile(
      repoWith(`${DEFAULT_CONFIG_YAML}---\nschema_version: 1\n`),
    );
    expect(twoDocuments.errors[0]).toContain("single YAML mapping");
  });

  it("reports a missing file as absent, not as invalid", async () => {
    const check = await checkConfigFile(repoWith());

    expect(check.present).toBe(false);
    expect(check.errors).toEqual([]);
    expect(check.file).toBe(configFile(check.file.replace(/\/\.workledger\/config\.yaml$/, "")));
  });
});
