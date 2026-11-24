// One test browser at a time across ALL innovation loops on this box (cardlens, portfolio, ops-hub), plus the
// resource checks that go with it. Ve decided on 2026-11-24 (item B, "preview resource limits"): server-pc is an
// i5-10500T with 16 GB that also runs the CardLens API, recognition, the contact API, the hub and the Target stock
// checker (Playwright too), so loop browsers queue behind one shared lock, run at BelowNormal priority, and are
// skipped when free memory is under 2 GB. Every refusal is fail-open: the caller reports "unverified (busy)".
//
// The lock is a file, <shared>\browser.lock, created exclusively (O_EXCL). <shared> is
// %USERPROFILE%\.innovation-loop-shared (INNOVATION_LOOP_SHARED_DIR overrides it, for tests): every loop runs as the
// same Windows user, and the reduced-token sessions can write there (user profile, Medium integrity). The record
// says who holds it and until when; a lock whose owner process is gone, or whose holdUntil passed, is stale and taken
// over. Holders: smoke.mjs (every loop's live render check), preview-browse.mjs (cardlens preview QA) and, through
// the CLI below, update-snapshots.ps1 (cardlens docker baselines).
//
// Library: import { acquireBrowserSlot, setLowPriority, ... } from "./browser-lock.mjs"
// CLI:     node browser-lock.mjs acquire --what <text> --owner-pid <pid> [--hold-min 20] [--wait-sec 600] [--no-memory]
//          node browser-lock.mjs release --owner-pid <pid>
//          node browser-lock.mjs status
//          last line: BROWSER-LOCK OK <path> | BROWSER-LOCK BUSY <why> | BROWSER-LOCK RELEASED | BROWSER-LOCK FREE |
//          BROWSER-LOCK HELD <json>; exit 0 (OK / RELEASED / FREE / HELD) or 3 (BUSY)
/* global process, console, setTimeout */
import { openSync, writeSync, closeSync, readFileSync, unlinkSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const MIN_FREE_BYTES = 2 * 1024 * 1024 * 1024; // skip browser work below 2 GB free RAM
export const DEFAULT_HOLD_MINUTES = 10;

export function sharedDir(env = process.env) {
  return env.INNOVATION_LOOP_SHARED_DIR || path.join(os.homedir(), ".innovation-loop-shared");
}
export function lockPath(env = process.env) {
  return path.join(sharedDir(env), "browser.lock");
}

// Is process <pid> alive? (signal 0: ESRCH = gone, EPERM = alive but not ours)
export function pidAlive(pid) {
  const n = Number(pid);
  if (!Number.isInteger(n) || n <= 0) return false;
  try {
    process.kill(n, 0);
    return true;
  } catch (e) {
    return e && e.code === "EPERM";
  }
}

// Pure: is the lock record stale? A record that cannot be parsed, has no holdUntil, whose owner is gone or whose
// holdUntil passed is stale. Returns { stale, why }.
export function lockIsStale(rec, nowMs, alive = pidAlive) {
  if (!rec || typeof rec !== "object") return { stale: true, why: "unreadable lock record" };
  const until = Date.parse(rec.holdUntil || "");
  if (!Number.isFinite(until)) return { stale: true, why: "lock record has no holdUntil" };
  if (nowMs > until)
    return { stale: true, why: `held past its holdUntil ${rec.holdUntil} by ${rec.what || "?"}` };
  if (!alive(rec.pid)) return { stale: true, why: `owner process ${rec.pid} (${rec.what || "?"}) is gone` };
  return { stale: false, why: "" };
}

// Pure: may browser work start with <free> bytes of free physical memory?
export function memoryGate(freeBytes, minBytes = MIN_FREE_BYTES) {
  const mb = (b) => Math.round(b / (1024 * 1024));
  if (!Number.isFinite(freeBytes) || freeBytes < 0)
    return { ok: true, why: "free memory unknown: not gated" };
  if (freeBytes < minBytes)
    return { ok: false, why: `free memory ${mb(freeBytes)} MB is under ${mb(minBytes)} MB` };
  return { ok: true, why: `free memory ${mb(freeBytes)} MB` };
}

function readRec(p) {
  try {
    return JSON.parse(readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return null;
  }
}

// One attempt to take the lock. Returns { ok, holder, why }.
export function tryAcquire({
  what,
  ownerPid = process.pid,
  holdMinutes = DEFAULT_HOLD_MINUTES,
  env = process.env,
  now = Date.now,
  alive = pidAlive,
} = {}) {
  const p = lockPath(env);
  try {
    mkdirSync(path.dirname(p), { recursive: true });
  } catch (e) {
    return {
      ok: true,
      unlocked: true,
      why: `lock folder not writable (${e.code || e.message}): running without the lock`,
    };
  }
  for (let i = 0; i < 2; i++) {
    const t = now();
    const rec = {
      pid: ownerPid,
      what: String(what || "browser").slice(0, 120),
      loop: env.INNOVATION_LOOP_NAME || "",
      startedAt: new Date(t).toISOString(),
      holdUntil: new Date(t + holdMinutes * 60000).toISOString(),
    };
    try {
      const fd = openSync(p, "wx");
      try {
        writeSync(fd, JSON.stringify(rec));
      } finally {
        closeSync(fd);
      }
      return { ok: true, holder: rec, why: "" };
    } catch (e) {
      if (e && e.code !== "EEXIST")
        return {
          ok: true,
          unlocked: true,
          why: `lock file not writable (${e.code || e.message}): running without the lock`,
        };
    }
    const cur = readRec(p);
    const st = lockIsStale(cur, now(), alive);
    if (!st.stale)
      return {
        ok: false,
        holder: cur,
        why: `held by ${cur.what || "?"} (pid ${cur.pid}${cur.loop ? `, ${cur.loop}` : ""}) since ${cur.startedAt}`,
      };
    // stale: take it over (unlink, then one more exclusive create; a racing waiter that wins makes us wait again)
    // re-read first: never remove a fresh lock another waiter took over a moment ago
    const again = readRec(p);
    if (again && cur && (again.pid !== cur.pid || again.startedAt !== cur.startedAt)) continue;
    try {
      unlinkSync(p);
    } catch {
      /* someone else removed it first */
    }
  }
  return { ok: false, holder: null, why: "lost the race for a stale lock" };
}

// Release: only the holder's own record (same pid) is removed.
export function release({ ownerPid = process.pid, env = process.env } = {}) {
  const p = lockPath(env);
  const cur = readRec(p);
  if (cur && Number(cur.pid) === Number(ownerPid)) {
    try {
      unlinkSync(p);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Take the one browser slot, waiting up to waitMs. Memory is checked first (and again after a wait). Returns
// { ok, busy, why, release }: ok false = busy (lock held past the wait, or low memory) -> the caller skips its browser
// work and reports unverified (busy). Never throws.
export async function acquireBrowserSlot({
  what,
  ownerPid = process.pid,
  holdMinutes = DEFAULT_HOLD_MINUTES,
  waitMs = 300000,
  pollMs = 2000,
  checkMemory = true,
  freemem = () => os.freemem(),
  env = process.env,
  now = Date.now,
  alive = pidAlive,
} = {}) {
  const none = () => false;
  const start = now();
  let last = "";
  for (;;) {
    if (checkMemory) {
      const m = memoryGate(freemem());
      if (!m.ok) return { ok: false, busy: true, why: `${m.why}: browser work skipped`, release: none };
    }
    const r = tryAcquire({ what, ownerPid, holdMinutes, env, now, alive });
    if (r.ok)
      return {
        ok: true,
        busy: false,
        why: r.why || "",
        unlocked: !!r.unlocked,
        release: () => (r.unlocked ? false : release({ ownerPid, env })),
      };
    last = r.why;
    if (now() - start + pollMs > waitMs)
      return {
        ok: false,
        busy: true,
        why: `another loop's browser is running (${last}); waited ${Math.round((now() - start) / 1000)} s`,
        release: none,
      };
    await sleep(pollMs);
  }
}

// BelowNormal for this process; Chromium and its helpers inherit it (Windows: a child of a BelowNormal process starts
// BelowNormal). Not Idle: an Idle browser starved by a busy CPU times out and QA would read that as a failure.
export function setLowPriority(pid = 0) {
  try {
    os.setPriority(pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
    return true;
  } catch {
    return false;
  }
}

// ---- CLI (update-snapshots.ps1 and tests) ----------------------------------------------------------------------
const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const opt = (k, d = "") => {
    const i = argv.indexOf(`--${k}`);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d;
  };
  const ownerPid = Number(opt("owner-pid", "0"));
  if (cmd === "acquire") {
    if (!(ownerPid > 0)) {
      console.log("BROWSER-LOCK BUSY --owner-pid is required");
      process.exit(3);
    }
    const r = await acquireBrowserSlot({
      what: opt("what", "browser"),
      ownerPid,
      holdMinutes: Number(opt("hold-min", "20")),
      waitMs: Number(opt("wait-sec", "600")) * 1000,
      checkMemory: !argv.includes("--no-memory"),
    });
    if (r.ok) {
      console.log(`BROWSER-LOCK OK ${r.unlocked ? `(no lock: ${r.why})` : lockPath()}`);
      process.exit(0);
    }
    console.log(`BROWSER-LOCK BUSY ${r.why}`);
    process.exit(3);
  } else if (cmd === "release") {
    console.log(release({ ownerPid }) ? "BROWSER-LOCK RELEASED" : "BROWSER-LOCK FREE");
    process.exit(0);
  } else if (cmd === "status") {
    const cur = readRec(lockPath());
    if (!cur) console.log("BROWSER-LOCK FREE");
    else
      console.log(
        `BROWSER-LOCK HELD ${JSON.stringify({ ...cur, stale: lockIsStale(cur, Date.now()).why || false })}`,
      );
    process.exit(0);
  } else {
    console.log("usage: node browser-lock.mjs acquire|release|status ...");
    process.exit(2);
  }
}
