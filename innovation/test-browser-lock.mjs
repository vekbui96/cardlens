// Tests for browser-lock.mjs (the one-browser-at-a-time lock, the memory gate and the priority setting).
//   node innovation\test-browser-lock.mjs        last line: TEST-BROWSER-LOCK PASS (<n> checks) | FAIL
/* global process, console, setTimeout */
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { spawnSync, spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  lockIsStale,
  memoryGate,
  tryAcquire,
  release,
  acquireBrowserSlot,
  lockPath,
  setLowPriority,
  MIN_FREE_BYTES,
} from "./browser-lock.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
let pass = 0;
let fail = 0;
const check = (cond, what) => {
  if (cond) pass++;
  else {
    fail++;
    console.log(`FAIL: ${what}`);
  }
};
const dir = mkdtempSync(path.join(os.tmpdir(), "browser-lock-"));
const env = { INNOVATION_LOOP_SHARED_DIR: dir, INNOVATION_LOOP_NAME: "test" };
const p = lockPath(env);
const GB = 1024 * 1024 * 1024;

// ---- pure rules ----
const now = Date.parse("2026-11-24T12:00:00Z");
const rec = (o = {}) => ({
  pid: 4242,
  what: "smoke",
  startedAt: "2026-11-24T11:59:00Z",
  holdUntil: "2026-11-24T12:05:00Z",
  ...o,
});
check(!lockIsStale(rec(), now, () => true).stale, "a live owner inside holdUntil is not stale");
check(lockIsStale(rec(), now, () => false).stale, "a dead owner is stale");
check(
  lockIsStale(rec({ holdUntil: "2026-11-24T11:59:30Z" }), now, () => true).stale,
  "past holdUntil is stale even with a live pid (pid reuse)",
);
check(
  lockIsStale(null, now).stale && lockIsStale({ pid: 1 }, now).stale,
  "an unreadable record or one without holdUntil is stale",
);
check(
  memoryGate(3 * GB).ok && memoryGate(3 * GB).why === "free memory 3072 MB",
  "3 GB free passes the memory gate",
);
check(
  !memoryGate(1.5 * GB).ok && /under 2048 MB/.test(memoryGate(1.5 * GB).why),
  "1.5 GB free fails the memory gate (under 2 GB)",
);
check(MIN_FREE_BYTES === 2 * GB, "the memory floor is 2 GB");
check(memoryGate(NaN).ok, "unknown free memory does not gate");

// ---- the lock file ----
const a = tryAcquire({ what: "first", ownerPid: process.pid, holdMinutes: 5, env });
check(a.ok && existsSync(p), "the first holder takes the lock and the file exists");
const holderRec = JSON.parse(readFileSync(p, "utf8"));
check(
  holderRec.pid === process.pid &&
    holderRec.what === "first" &&
    holderRec.loop === "test" &&
    Date.parse(holderRec.holdUntil) > Date.now(),
  "the record names pid, what, loop and holdUntil",
);
const b = tryAcquire({ what: "second", ownerPid: process.pid + 1, env });
check(!b.ok && /held by first/.test(b.why), `a second holder is refused while the first is alive (${b.why})`);
check(!release({ ownerPid: process.pid + 1, env }) && existsSync(p), "another pid cannot release it");
check(release({ ownerPid: process.pid, env }) && !existsSync(p), "the holder releases it");

// stale takeover: a dead owner, and an expired hold
writeFileSync(
  p,
  JSON.stringify(rec({ pid: 999999, holdUntil: new Date(Date.now() + 600000).toISOString() })),
);
const c = tryAcquire({ what: "after-dead", ownerPid: process.pid, env, alive: () => false });
check(
  c.ok && JSON.parse(readFileSync(p, "utf8")).what === "after-dead",
  "a lock whose owner died is taken over",
);
release({ ownerPid: process.pid, env });
writeFileSync(
  p,
  JSON.stringify(rec({ pid: process.pid, holdUntil: new Date(Date.now() - 1000).toISOString() })),
);
const d = tryAcquire({ what: "after-expiry", ownerPid: process.pid, env });
check(d.ok && JSON.parse(readFileSync(p, "utf8")).what === "after-expiry", "an expired lock is taken over");
release({ ownerPid: process.pid, env });
writeFileSync(p, "garbage {");
check(
  tryAcquire({ what: "after-garbage", ownerPid: process.pid, env }).ok,
  "a garbage lock file is taken over",
);
release({ ownerPid: process.pid, env });

// ---- the waiting slot ----
tryAcquire({ what: "holder", ownerPid: process.pid, holdMinutes: 5, env });
let t0 = Date.now();
const busy = await acquireBrowserSlot({
  what: "waiter",
  ownerPid: process.pid + 7,
  waitMs: 1200,
  pollMs: 300,
  env,
  freemem: () => 8 * GB,
});
check(
  !busy.ok && busy.busy && /another loop's browser is running/.test(busy.why) && Date.now() - t0 >= 800,
  `a waiter gives up after its wait: busy (${busy.why})`,
);
setTimeout(() => release({ ownerPid: process.pid, env }), 500);
t0 = Date.now();
const got = await acquireBrowserSlot({
  what: "waiter",
  ownerPid: process.pid,
  waitMs: 5000,
  pollMs: 200,
  env,
  freemem: () => 8 * GB,
});
check(got.ok && Date.now() - t0 >= 400, "a waiter gets the slot once the holder releases it");
check(got.release() && !existsSync(p), "release() of the slot removes the lock");
const low = await acquireBrowserSlot({ what: "low-mem", env, freemem: () => 1 * GB });
check(
  !low.ok && low.busy && /under 2048 MB/.test(low.why) && !existsSync(p),
  "under 2 GB free: busy, no lock taken",
);
const noMem = await acquireBrowserSlot({
  what: "no-mem-check",
  env,
  checkMemory: false,
  freemem: () => 1 * GB,
});
check(noMem.ok, "checkMemory false skips the memory gate (docker baselines)");
noMem.release();

// unwritable lock folder: run without the lock (fail open), never throw
const blocked = path.join(dir, "file-not-dir");
writeFileSync(blocked, "x");
const un = tryAcquire({ what: "x", env: { INNOVATION_LOOP_SHARED_DIR: path.join(blocked, "sub") } });
check(un.ok && un.unlocked, `an unwritable lock folder runs without the lock (${un.why})`);

// ---- the CLI (update-snapshots.ps1) interoperates with the library ----
const cli = (args) =>
  spawnSync(process.execPath, [path.join(here, "browser-lock.mjs"), ...args], {
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
let r = cli([
  "acquire",
  "--what",
  "docker baselines",
  "--owner-pid",
  String(process.pid),
  "--hold-min",
  "20",
  "--wait-sec",
  "1",
  "--no-memory",
]);
check(r.status === 0 && /^BROWSER-LOCK OK /m.test(r.stdout), `CLI acquire OK (${r.stdout.trim()})`);
check(
  !tryAcquire({ what: "smoke", ownerPid: process.pid + 3, env }).ok,
  "a library caller sees the CLI's lock (owner = the calling PowerShell's pid)",
);
r = cli([
  "acquire",
  "--what",
  "second",
  "--owner-pid",
  String(process.pid + 3),
  "--wait-sec",
  "1",
  "--no-memory",
]);
check(
  r.status === 3 && /^BROWSER-LOCK BUSY /m.test(r.stdout),
  `CLI acquire while held: BUSY, exit 3 (${r.stdout.trim()})`,
);
r = cli(["status"]);
check(/^BROWSER-LOCK HELD .*docker baselines/m.test(r.stdout), "CLI status shows the holder");
r = cli(["release", "--owner-pid", String(process.pid)]);
check(/BROWSER-LOCK RELEASED/.test(r.stdout) && !existsSync(p), "CLI release removes it");
r = cli(["acquire", "--what", "x"]);
check(r.status === 3, "CLI acquire without --owner-pid refuses");

// ---- priority: BelowNormal, inherited by the processes a BelowNormal process starts (Chromium) ----
const BN = os.constants.priority.PRIORITY_BELOW_NORMAL;
const child = spawn(process.execPath, ["-e", "setTimeout(()=>{}, 3000)"]);
await new Promise((res) => setTimeout(res, 300));
check(
  setLowPriority(child.pid) && os.getPriority(child.pid) === BN,
  "setLowPriority sets BelowNormal on a process",
);
child.kill();
const inh = spawnSync(
  process.execPath,
  [
    "-e",
    `const os=require('os');os.setPriority(0,os.constants.priority.PRIORITY_BELOW_NORMAL);const r=require('child_process').spawnSync(process.execPath,['-e','console.log(require("os").getPriority())'],{encoding:'utf8'});console.log(r.stdout.trim())`,
  ],
  { encoding: "utf8" },
);
check(
  Number(inh.stdout.trim()) === BN,
  `a child of a BelowNormal process starts BelowNormal (got ${inh.stdout.trim()}, want ${BN})`,
);

// ---- wiring: every browser launcher next to this file takes the slot (the same file ships in every loop) ----
const smokeFile = path.join(here, "smoke.mjs");
if (existsSync(smokeFile)) {
  const s = readFileSync(smokeFile, "utf8");
  check(
    /acquireBrowserSlot\(/.test(s) && /setLowPriority\(\)/.test(s),
    "smoke.mjs takes the browser slot and lowers its priority",
  );
  check(
    /process\.exit\(2\)/.test(s) && /unverified \(busy\)/.test(s),
    "smoke.mjs exits 2 (could not run: unverified, busy) when the slot is busy",
  );
  check(
    /300000\)/.test(s) && /slot\.release\(\)/.test(s),
    "smoke.mjs has a 5-minute hard cap and releases the slot",
  );
}
const browseFile = path.join(here, "preview-browse.mjs");
if (existsSync(browseFile)) {
  const s = readFileSync(browseFile, "utf8");
  check(
    /acquireBrowserSlot\(/.test(s) &&
      /PREVIEW-BROWSE BUSY unverified \(busy\)/.test(s) &&
      /slot\.release\(\)/.test(s),
    "preview-browse.mjs takes the slot, says BUSY, releases it",
  );
}

rmSync(dir, { recursive: true, force: true });
if (fail > 0) {
  console.log(`TEST-BROWSER-LOCK FAIL (${fail} failed, ${pass} passed)`);
  process.exit(1);
}
console.log(`TEST-BROWSER-LOCK PASS (${pass} checks)`);
