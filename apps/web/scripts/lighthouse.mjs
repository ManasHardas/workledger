/**
 * `pnpm -F web lighthouse` — Lighthouse's PWA and accessibility readings for the built UI, served
 * the way a user gets it: by `workledger serve` on this repo, not by `vite preview`.
 *
 * Phase 7 §Acceptance wants these two checks passing before the design pass is done. This script
 * is the measurement, not the gate: it prints the scores and **always exits 0**, so it can be run
 * from a session, on a branch, or from CI as information while the numbers are still moving. The
 * gate comes later, when the numbers are worth defending.
 *
 * Everything it needs that it cannot install is treated as a skip, not a failure: no Chrome on the
 * host, no `lighthouse` in `node_modules`, no built UI. Each prints why and stops.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const CLI = path.join(REPO, "packages", "cli", "bin", "workledger");
const BUILT_UI = path.join(REPO, "packages", "cli", "dist", "web", "index.html");

/** The two categories phase 7 cares about. Lighthouse 11 is pinned because 12 dropped `pwa`. */
const CATEGORIES = ["pwa", "accessibility"];

/** How long to wait for `workledger serve` to print its URL before giving up. */
const START_TIMEOUT_MS = 20_000;

/** Where a system Chrome usually is, per platform. `CHROME_PATH` overrides all of them. */
const CANDIDATES = {
  darwin: [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
  ],
  linux: [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
  ],
  win32: [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ],
};

function skip(reason) {
  console.log(`lighthouse: skipped — ${reason}`);
  process.exitCode = 0;
}

/**
 * The Chrome binary to drive, or `null`. An explicitly set `CHROME_PATH` that does not exist is a
 * skip rather than a silent fall back to some other browser: the operator asked for that one.
 */
function findChrome() {
  const explicit = process.env["CHROME_PATH"]?.trim();
  if (explicit) return existsSync(explicit) ? explicit : null;
  return (CANDIDATES[process.platform] ?? []).find((candidate) => existsSync(candidate)) ?? null;
}

/**
 * Starts `workledger serve --no-open` on this repo and resolves the URL it prints on its first
 * line of stdout. Rejects if it exits, or says nothing, first.
 */
function startServer() {
  const server = spawn(process.execPath, [CLI, "serve", "--no-open"], {
    cwd: REPO,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  server.stderr.setEncoding("utf8");
  server.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  const url = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`\`workledger serve\` printed no URL in ${START_TIMEOUT_MS} ms`));
    }, START_TIMEOUT_MS);
    let out = "";
    server.stdout.setEncoding("utf8");
    server.stdout.on("data", (chunk) => {
      out += chunk;
      const found = /^https?:\/\/\S+$/m.exec(out);
      if (found) {
        clearTimeout(timer);
        resolve(found[0]);
      }
    });
    server.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`\`workledger serve\` exited with ${code}${stderr ? `: ${stderr.trim()}` : ""}`));
    });
  });

  return { server, url };
}

/** `0.93` → `93`, and `null` (a category that did not run) → `n/a`. */
const percent = (score) => (typeof score === "number" ? `${Math.round(score * 100)}` : "n/a");

async function main() {
  const chromePath = findChrome();
  if (chromePath === null) {
    return skip(
      "no Chrome found. Install Google Chrome or point CHROME_PATH at a Chromium binary; " +
        "the PWA and accessibility readings need a real browser.",
    );
  }

  let lighthouse;
  let launch;
  try {
    ({ default: lighthouse } = await import("lighthouse"));
    ({ launch } = await import("chrome-launcher"));
  } catch (error) {
    return skip(`\`lighthouse\` is not installed (${error.message}). Run \`pnpm install\`.`);
  }

  if (!existsSync(BUILT_UI)) {
    return skip(`no built UI at ${BUILT_UI} — run \`pnpm build\` first`);
  }

  const { server, url } = startServer();
  let chrome;
  try {
    const target = await url;
    console.log(`lighthouse: serving ${target}`);
    chrome = await launch({ chromePath, chromeFlags: ["--headless=new", "--no-sandbox"] });
    const run = await lighthouse(target, {
      port: chrome.port,
      output: "json",
      logLevel: "error",
      onlyCategories: CATEGORIES,
    });

    console.log("");
    for (const key of CATEGORIES) {
      const category = run?.lhr?.categories?.[key];
      console.log(`  ${(category?.title ?? key).padEnd(16)} ${percent(category?.score)}`);
    }
    console.log("");
    console.log("lighthouse: informational only — this script never fails the build.");
  } catch (error) {
    // Still not a failure: an unreachable server or a browser that would not start says nothing
    // about the app's accessibility, and this is not the gate.
    console.log(`lighthouse: could not measure — ${error instanceof Error ? error.message : error}`);
  } finally {
    await chrome?.kill();
    server.kill("SIGINT");
  }
  process.exitCode = 0;
}

await main();
