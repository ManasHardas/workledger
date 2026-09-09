/**
 * The `.workledger/**` watcher behind `/api/events`.
 *
 * `fs.watch(dir, { recursive: true })` is native on both platforms this project supports —
 * macOS via FSEvents since forever, Linux via a recursive inotify implementation since Node 20,
 * and the engine floor here is Node 22 (`package.json`). That is the whole reason no watcher
 * dependency is added: `chokidar` exists to paper over exactly the recursive gap that Node 22
 * closed.
 *
 * It can still fail — an unsupported filesystem, a network mount, `ENOSPC` from exhausted inotify
 * watches — and api.md requires the server to keep emitting when it does. So a failure at
 * construction *or* an `error` on a live watcher switches the instance to a 2 s `mtime` poll,
 * which emits the same paths through the same debounce.
 */
import { watch } from "node:fs";
import path from "node:path";
import type { FSWatcher } from "node:fs";

import { fileMtimeMs, listMarkdown } from "./paths.js";
import type { LedgerPaths } from "./paths.js";

/** api.md §SSE: "debounced at 100 ms". */
export const DEBOUNCE_MS = 100;
/** api.md §SSE: "the server polls every 2 s". */
export const POLL_MS = 2000;

/** How the running watcher is getting its changes. */
export type WatchMode = "watch" | "poll";

export interface WatcherOptions {
  paths: LedgerPaths;
  /** Absolute paths that changed since the last flush; never empty. */
  onChange: (files: string[]) => void;
  debounceMs?: number;
  pollMs?: number;
}

/** A running watcher. */
export interface Watcher {
  /** `"watch"` while `fs.watch` is live, `"poll"` after a fallback. */
  readonly mode: WatchMode;
  close(): void;
}

/** The `.md` files of both ledger directories, with their mtimes, for the polling fallback. */
function snapshot(paths: LedgerPaths): Map<string, number> {
  const out = new Map<string, number>();
  for (const dir of [paths.sessions, paths.backlog]) {
    for (const name of listMarkdown(dir)) {
      const file = path.join(dir, name);
      out.set(file, fileMtimeMs(file) ?? 0);
    }
  }
  const configMtime = fileMtimeMs(paths.config);
  if (configMtime !== undefined) out.set(paths.config, configMtime);
  return out;
}

/**
 * Start watching `.workledger/**`.
 *
 * The ledger directory is watched rather than each subdirectory, so a `sessions/` or `backlog/`
 * created after startup is picked up without a restart.
 */
export function startWatcher(options: WatcherOptions): Watcher {
  const { paths, onChange } = options;
  const debounceMs = options.debounceMs ?? DEBOUNCE_MS;
  const pollMs = options.pollMs ?? POLL_MS;

  const pending = new Set<string>();
  let timer: NodeJS.Timeout | undefined;
  let fsWatcher: FSWatcher | undefined;
  let poller: NodeJS.Timeout | undefined;
  let previous: Map<string, number> | undefined;
  let closed = false;
  let mode: WatchMode = "watch";

  const flush = (): void => {
    timer = undefined;
    if (pending.size === 0) return;
    const files = [...pending];
    pending.clear();
    onChange(files);
  };

  const queue = (file: string): void => {
    if (closed) return;
    pending.add(file);
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(flush, debounceMs);
    timer.unref?.();
  };

  const startPolling = (): void => {
    if (closed || poller !== undefined) return;
    mode = "poll";
    previous = snapshot(paths);
    poller = setInterval(() => {
      const next = snapshot(paths);
      for (const [file, mtime] of next) {
        if (previous?.get(file) !== mtime) queue(file);
      }
      for (const file of previous ?? []) {
        if (!next.has(file[0])) queue(file[0]);
      }
      previous = next;
    }, pollMs);
    poller.unref?.();
  };

  try {
    fsWatcher = watch(paths.ledger, { recursive: true, persistent: false }, (_event, filename) => {
      if (filename === null || filename === undefined) return;
      const name = filename.toString();
      // `.md.<pid>.<n>.tmp` scratch files are the atomic-write staging of `packages/cli`
      // (`ledger-fs.ts` writes then renames); the rename itself fires for the real name.
      if (name.endsWith(".tmp")) return;
      queue(path.resolve(paths.ledger, name));
    });
    fsWatcher.on("error", () => {
      fsWatcher?.close();
      fsWatcher = undefined;
      startPolling();
    });
  } catch {
    startPolling();
  }

  return {
    get mode(): WatchMode {
      return mode;
    },
    close(): void {
      closed = true;
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      pending.clear();
      fsWatcher?.close();
      fsWatcher = undefined;
      if (poller !== undefined) clearInterval(poller);
      poller = undefined;
    },
  };
}
