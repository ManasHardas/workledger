import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TRANSCRIPT_GONE } from "../src/features/ledger/excerpt-viewer.js";
import { createSource } from "../src/lib/ledger-source.js";
import { SourceProvider } from "../src/lib/source-context.js";
import { LedgerView } from "../src/routes/ledger.js";

import type { Excerpt, LedgerSource } from "../src/lib/ledger-source.js";

const SESSION = "01JBQ4Z8W2K7N3RQ9XMDT5V0AE";

const EXCERPT: Excerpt = {
  cp: 1,
  offset: [0, 41_233],
  turns: [
    { role: "user", text: "Debounce the watcher at 100 ms", tools: 0 },
    { role: "assistant", text: "Done — the watcher coalesces writes.", tools: 7 },
  ],
};

function apiError(code: string, message: string) {
  return Object.assign(new Error(message), { code });
}

/** The fixture ledger with provenance switched on and one `excerpt` implementation under test. */
function provenanceSource(
  excerpt: LedgerSource["excerpt"],
  capabilities = { write: false, live: false, provenance: true },
): { source: LedgerSource; calls: [string, number][] } {
  const base = createSource("fixture");
  const calls: [string, number][] = [];
  const source = Object.assign(Object.create(base) as LedgerSource, {
    capabilities,
    excerpt(ulid: string, cp: number) {
      calls.push([ulid, cp]);
      return excerpt(ulid, cp);
    },
  });
  return { source, calls };
}

function renderDetail(source: LedgerSource) {
  window.location.hash = `#/ledger/${SESSION}`;
  return render(
    <SourceProvider source={source}>
      <LedgerView />
    </SourceProvider>,
  );
}

/** The provenance row for checkpoint `cp` — each one owns its own disclosure control. */
async function checkpointRow(cp: number) {
  const list = await screen.findByRole("list", { name: "Checkpoints, oldest first" });
  const row = within(list).getAllByRole("listitem")[cp - 1];
  expect(row?.textContent).toContain(`[cp ${String(cp)}]`);
  return row!;
}

beforeEach(() => {
  window.location.hash = "";
});

afterEach(cleanup);

describe("provenance excerpt viewer", () => {
  it("reads nothing until the span is asked for, then reads that checkpoint's span", async () => {
    const { source, calls } = provenanceSource(() => Promise.resolve(EXCERPT));
    renderDetail(source);

    const row = await checkpointRow(2);
    const toggle = within(row).getByRole("button", { name: "Show transcript span" });
    // A session detail with eight checkpoints must not read eight transcript spans on mount.
    expect(calls).toEqual([]);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(toggle);
    await waitFor(() => expect(calls).toEqual([[SESSION, 2]]));
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
  });

  it("renders the byte range and the user/assistant turns with their tool counts", async () => {
    const { source } = provenanceSource(() => Promise.resolve(EXCERPT));
    renderDetail(source);
    const row = await checkpointRow(1);
    fireEvent.click(within(row).getByRole("button", { name: "Show transcript span" }));

    expect(await within(row).findByText(/bytes 0–41,233 \(41,233 read\)/)).toBeDefined();
    const turns = within(row).getByRole("list", { name: "Transcript span for checkpoint 1" });
    const items = within(turns).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]!.textContent).toContain("user");
    expect(items[0]!.textContent).toContain("Debounce the watcher at 100 ms");
    // Tool traffic is counted, never returned — so the count is all there is to render.
    expect(items[0]!.textContent).not.toContain("tool call");
    expect(items[1]!.textContent).toContain("assistant");
    expect(items[1]!.textContent).toContain("7 tool calls");
  });

  it("collapses again, and re-reads on the next expansion", async () => {
    const { source, calls } = provenanceSource(() => Promise.resolve(EXCERPT));
    renderDetail(source);
    const row = await checkpointRow(1);

    fireEvent.click(within(row).getByRole("button", { name: "Show transcript span" }));
    await within(row).findByText(/bytes 0–41,233/);

    fireEvent.click(within(row).getByRole("button", { name: "Hide transcript span" }));
    expect(within(row).queryByText(/bytes 0–41,233/)).toBeNull();

    // A repair or an extraction between two clicks moves this span's upper bound, so the second
    // expansion re-reads rather than replaying a cache.
    fireEvent.click(within(row).getByRole("button", { name: "Show transcript span" }));
    await waitFor(() => expect(calls).toHaveLength(2));
  });

  it("says the transcript is gone rather than reporting a failure", async () => {
    const { source } = provenanceSource(() =>
      Promise.reject(apiError("transcript_missing", "the transcript is no longer on this machine")),
    );
    renderDetail(source);
    const row = await checkpointRow(1);
    fireEvent.click(within(row).getByRole("button", { name: "Show transcript span" }));

    const state = await within(row).findByText(new RegExp(TRANSCRIPT_GONE));
    expect(state.getAttribute("role")).toBe("status");
    expect(within(row).queryByRole("alert")).toBeNull();
  });

  it("reports any other failure as one", async () => {
    const { source } = provenanceSource(() =>
      Promise.reject(apiError("bad_request", "cp must be an integer >= 1")),
    );
    renderDetail(source);
    const row = await checkpointRow(1);
    fireEvent.click(within(row).getByRole("button", { name: "Show transcript span" }));
    expect((await within(row).findByRole("alert")).textContent).toContain(
      "cp must be an integer >= 1",
    );
  });

  it("renders a span with no user or assistant turns as exactly that", async () => {
    const { source } = provenanceSource(() =>
      Promise.resolve({ cp: 1, offset: [0, 900] as [number, number], turns: [] }),
    );
    renderDetail(source);
    const row = await checkpointRow(1);
    fireEvent.click(within(row).getByRole("button", { name: "Show transcript span" }));
    expect(await within(row).findByText(/holds no user or assistant turns/)).toBeDefined();
  });

  it("offers no control at all on a source without provenance", async () => {
    const { source } = provenanceSource(() => Promise.resolve(EXCERPT), {
      write: false,
      live: false,
      provenance: false,
    });
    renderDetail(source);
    const row = await checkpointRow(1);
    expect(within(row).queryByRole("button", { name: "Show transcript span" })).toBeNull();
    expect(within(row).getByText(/cannot read transcripts/)).toBeDefined();
  });
});
