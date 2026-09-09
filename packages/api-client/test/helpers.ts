/**
 * Test rig for the client: a real `packages/server` over a throwaway copy of **this repo's own**
 * `.workledger/`, and a Node `EventSource`.
 *
 * The GET tests run against the real server rather than a mock because the thing under test is
 * the wire contract, and a mock of `docs/contracts/p2/api.md` would agree with the client by
 * construction — including where both are wrong. Copying the dogfood ledger means the fixtures are
 * the frontmatter the CLI actually writes, so a schema drift breaks these tests too.
 *
 * `EventSource` is not a Node global (it is still flagged as of Node 25), so `sseSource` below is
 * the ~40 lines of `text/event-stream` framing the client needs. It is the injected
 * `options.EventSource`, which is why the client takes one at all.
 */
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createApp } from "@workledger/server";

import type { EventSourceCtor, EventSourceLike, MessageEventLike } from "../src/events.js";

/** `<repo>/.workledger`, four directories up from this file. */
export const DOGFOOD_LEDGER = fileURLToPath(new URL("../../../.workledger", import.meta.url));

/** A running server plus everything a test needs to poke at it. */
export interface Harness {
  baseUrl: string;
  /** The temp repo's `.workledger/`, so a test can touch a file and watch the SSE land. */
  ledger: string;
  root: string;
  stop(): Promise<void>;
}

/** Copy the dogfood ledger into a temp repo and serve it on a random loopback port. */
export async function startHarness(): Promise<Harness> {
  const root = mkdtempSync(path.join(os.tmpdir(), "workledger-api-client-"));
  const ledger = path.join(root, ".workledger");
  cpSync(DOGFOOD_LEDGER, ledger, { recursive: true });

  const app = createApp({
    repoRoot: root,
    home: path.join(root, "home"),
    env: { PATH: "" },
    homeDir: root,
    // The default watcher debounce plus a 2 s poll fallback would make the SSE test wait on the
    // machine rather than on the contract.
    debounceMs: 20,
    pollMs: 100,
    pingMs: 1000,
  });
  const server = await app.start();

  return {
    baseUrl: `http://127.0.0.1:${server.port}`,
    ledger,
    root,
    stop: async () => {
      app.close();
      await server.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

/**
 * A minimal `EventSource` over `fetch`: connect, parse `event:`/`data:` frames separated by a
 * blank line, dispatch to the listeners the client registered, and report any transport failure
 * through `onerror` so the client's reconnect is exercised for real.
 */
class FetchEventSource implements EventSourceLike {
  onerror: ((event: unknown) => void) | null = null;

  readonly #listeners = new Map<string, ((event: MessageEventLike) => void)[]>();
  readonly #controller = new AbortController();
  #closed = false;

  constructor(url: string) {
    void this.#run(url);
  }

  addEventListener(type: string, listener: (event: MessageEventLike) => void): void {
    const list = this.#listeners.get(type) ?? [];
    list.push(listener);
    this.#listeners.set(type, list);
  }

  close(): void {
    this.#closed = true;
    this.#controller.abort();
  }

  #fail(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.onerror?.(new Error("stream ended"));
  }

  async #run(url: string): Promise<void> {
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { accept: "text/event-stream" },
        signal: this.#controller.signal,
      });
    } catch {
      this.#fail();
      return;
    }
    if (!response.ok || response.body === null) {
      this.#fail();
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // SSE separates frames with a blank line; anything after the last one is a partial frame
        // and stays in the buffer.
        let split = buffer.indexOf("\n\n");
        while (split !== -1) {
          this.#dispatch(buffer.slice(0, split));
          buffer = buffer.slice(split + 2);
          split = buffer.indexOf("\n\n");
        }
      }
    } catch {
      // An abort from close() lands here too; #fail() is a no-op once closed.
    }
    this.#fail();
  }

  #dispatch(frame: string): void {
    let name = "message";
    const data: string[] = [];
    for (const line of frame.split("\n")) {
      if (line.startsWith("event:")) name = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
    }
    for (const listener of this.#listeners.get(name) ?? []) {
      listener({ data: data.join("\n") });
    }
  }
}

/** The injected `EventSource` every live test passes to the client. */
export const sseSource: EventSourceCtor = FetchEventSource;

/** Resolve once `predicate` holds, or reject after `timeoutMs`. */
export async function waitFor(
  predicate: () => boolean,
  timeoutMs = 8000,
  label = "condition",
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
