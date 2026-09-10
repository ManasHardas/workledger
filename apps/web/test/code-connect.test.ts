import { isValidElement } from "react";
import { describe, expect, it } from "vitest";

import { connections } from "../src/lib/code-connect.js";

/**
 * Loading every `*.figma.tsx` is the registration: the modules have no exports, they call
 * `figma.connect` at import time exactly as the real Code Connect CLI expects.
 */
const modules = import.meta.glob("../src/**/*.figma.tsx", { eager: true });

/** Every component design spec §14.1 lists, by the file that must map it. */
const EXPECTED = [
  "../src/components/ui/badge.figma.tsx",
  "../src/components/ui/button.figma.tsx",
  "../src/components/ui/card.figma.tsx",
  "../src/components/ui/input.figma.tsx",
  "../src/components/ui/sheet.figma.tsx",
  "../src/components/ui/tabs.figma.tsx",
  "../src/features/health/health-row.figma.tsx",
  "../src/features/ledger/session-card.figma.tsx",
  "../src/features/needs/note-card.figma.tsx",
  "../src/features/next/backlog-item.figma.tsx",
];

/**
 * `https://www.figma.com/design/<FILE_KEY>?node-id=<NODE_ID>` — the one URL form
 * `figma connect publish` accepts, checked here because the CLI is not a dependency
 * (see `apps/web/CODE_CONNECT.md`).
 */
const NODE_URL = /^https:\/\/www\.figma\.com\/design\/([A-Za-z0-9_]+)\?node-id=([A-Za-z0-9_:%-]+)$/;

describe("Code Connect skeletons", () => {
  it("covers every component in the design pass, and nothing else", () => {
    expect(Object.keys(modules).sort()).toEqual(EXPECTED);
  });

  it("registers one connection per file", () => {
    expect(connections).toHaveLength(EXPECTED.length);
  });

  it("points every connection at a well-formed, distinct Figma node URL in one file", () => {
    const keys = new Set<string>();
    for (const { url } of connections) {
      const match = NODE_URL.exec(url);
      expect(match, `not a Figma node URL: ${url}`).not.toBeNull();
      keys.add(match![1]!);
    }
    // A design system lives in one Figma file; two file keys means one of them was pasted wrong.
    expect(keys.size).toBe(1);
    expect(new Set(connections.map((c) => c.url)).size).toBe(connections.length);
  });

  it("declares props and an example that builds an element from them", () => {
    for (const connection of connections) {
      expect(Object.keys(connection.props).length).toBeGreaterThan(0);
      expect(typeof connection.example).toBe("function");
      // The published snippet is this call. If it throws or returns something React cannot render,
      // the mapping is broken whether or not Figma has heard of the node yet.
      expect(isValidElement(connection.example(connection.props))).toBe(true);
    }
  });
});
