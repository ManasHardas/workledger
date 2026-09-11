import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { Panel, PanelHost, usePanelOpen } from "../src/components/ui/panel.js";
import { PANEL_SHEET_QUERY } from "../src/lib/media.js";

/**
 * The right pane primitive of `docs/design/direction.md` §Shell: a floating, inset, shadowed panel
 * with its own header on desktop — never a full-height drawer — and a modal bottom sheet below
 * 768 px, with focus moving in on open and back to the opener on close in both forms.
 */

/** jsdom has no `matchMedia`; a test that wants the sheet form says which query matches. */
function matchAll(queries: string[]): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: queries.includes(query),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
}

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "matchMedia");
});

/**
 * A middle pane with two rows that open the panel — the second one *replaces* the first's contents
 * rather than closing it — and something else to click behind it.
 */
function Harness() {
  const [row, setRow] = useState<string | null>(null);
  return (
    <PanelHost>
      {() => (
        <>
          <Inset />
          <button type="button" onClick={() => setRow("Wired the switcher")}>
            Open evidence
          </button>
          <button type="button" onClick={() => setRow("Second row")}>
            Open the second row
          </button>
          <button type="button">Something else</button>
          <Panel
            open={row !== null}
            onOpenChange={(next) => setRow(next ? row : null)}
            title={row ?? ""}
            description="[cp 3]"
          >
            <p>a1b2c3d</p>
          </Panel>
        </>
      )}
    </PanelHost>
  );
}

/** Reports the host's inset state, which is how the middle pane makes room on desktop. */
function Inset() {
  return <span data-testid="inset">{usePanelOpen() ? "inset" : "flush"}</span>;
}

describe("the floating right panel", () => {
  it("is a non-modal floating panel on desktop, with its own header and close control", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Open evidence" }));

    const panel = await screen.findByRole("dialog", { name: "Wired the switcher" });
    expect(panel.getAttribute("data-variant")).toBe("panel");
    // Non-modal: no scrim, and the middle pane behind it is still there to be used.
    expect(document.querySelector("[data-panel-overlay]")).toBeNull();
    expect(screen.getByRole("button", { name: "Something else" })).toBeDefined();
    // Its own header: the title, the identifier line, and a close control.
    expect(screen.getByText("[cp 3]")).toBeDefined();
    expect(screen.getByRole("button", { name: "Close panel" })).toBeDefined();
    // The middle pane makes room for it rather than being covered.
    expect(screen.getByTestId("inset").textContent).toBe("inset");
  });

  it("is a modal bottom sheet with a drag handle below 768 px", async () => {
    matchAll([PANEL_SHEET_QUERY]);
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Open evidence" }));

    const panel = await screen.findByRole("dialog", { name: "Wired the switcher" });
    expect(panel.getAttribute("data-variant")).toBe("sheet");
    expect(document.querySelector("[data-panel-overlay]")).not.toBeNull();
  });

  it("moves focus into the panel on open and back to the opener on close", async () => {
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Open evidence" });
    opener.focus();
    fireEvent.click(opener);

    const panel = await screen.findByRole("dialog", { name: "Wired the switcher" });
    await waitFor(() => expect(panel.contains(document.activeElement)).toBe(true));

    fireEvent.click(screen.getByRole("button", { name: "Close panel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener));
    expect(screen.getByTestId("inset").textContent).toBe("flush");
  });

  it("returns focus to the row that opened it last when a second row replaced its contents", async () => {
    render(<Harness />);
    const first = screen.getByRole("button", { name: "Open evidence" });
    first.focus();
    fireEvent.click(first);
    await screen.findByRole("dialog", { name: "Wired the switcher" });

    // Non-modal, so the middle pane is still live: a second row replaces the panel's contents.
    const second = screen.getByRole("button", { name: "Open the second row" });
    second.focus();
    fireEvent.click(second);
    await screen.findByRole("dialog", { name: "Second row" });

    fireEvent.click(screen.getByRole("button", { name: "Close panel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // The row just clicked, not the one that opened it first — a jump backwards reads as a bug.
    await waitFor(() => expect(document.activeElement).toBe(second));
  });

  it("closes on Escape and returns focus, in both forms", async () => {
    for (const queries of [[], [PANEL_SHEET_QUERY]]) {
      matchAll(queries);
      render(<Harness />);
      const opener = screen.getByRole("button", { name: "Open evidence" });
      opener.focus();
      fireEvent.click(opener);
      await screen.findByRole("dialog", { name: "Wired the switcher" });

      fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      await waitFor(() => expect(document.activeElement).toBe(opener));
      cleanup();
    }
  });
});
