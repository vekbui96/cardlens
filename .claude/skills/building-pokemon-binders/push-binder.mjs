#!/usr/bin/env node
// Lay resolved slots into pages and merge the binder into the home server.
//
//   COLLECTION_TOKEN=... node push-binder.mjs slots.json --name "Riolu & Lucario" [--id <id>] [--format 9|12] [--dry]
//
// The token comes from the environment, never argv: a command line ends up in
// shell history and in any transcript of the session.
import { readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

const BASE = process.env.CARDLENS_API ?? "https://server-pc.tail0e4194.ts.net:8443";

const args = process.argv.slice(2);
const slotsPath = args.find((a) => !a.startsWith("--"));
const flag = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : d;
};
const dry = args.includes("--dry");
const name = flag("name");
/**
 * Pockets per page side. Read from the format rather than a two-way guess.
 *
 * This was `format === "12" ? 12 : 9`, which silently turned every other value
 * into a 9 — so `--format 4` laid a jumbo binder out nine to a page, and
 * `--format 16`, added 2026-09-27, could not be asked for at all. A format the
 * app supports and this tool quietly rewrites is the worst of both.
 */
const POCKETS = { 4: 4, 9: 9, 12: 12, 16: 16 };
const format = String(flag("format", "9"));
const pockets = POCKETS[format];
if (!pockets) {
  console.error(`unknown --format ${format}; expected one of ${Object.keys(POCKETS).join(", ")}`);
  process.exit(1);
}
/**
 * The cover, carried through untouched.
 *
 * A binder is pushed WHOLE and converges last-write-wins, so every field left
 * off this object is a field the push deletes. The cover is not one of the
 * pockets and so never appears in `slots.json` — which meant a rebuild of a
 * binder that had one silently threw it away, with nothing in the output
 * saying so. Pass `--cover '<json>'` (the slot, as the server returns it) to
 * keep it. `--keep-cover` fetches the binder first and reuses what is there.
 */
const coverArg = flag("cover");
const keepCover = args.includes("--keep-cover");
/** Same reasoning: a trade binder that came back not-for-trade lost a flag. */
const forTrade = args.includes("--for-trade");

if (!slotsPath || !name) {
  console.error(
    'usage: COLLECTION_TOKEN=... node push-binder.mjs slots.json --name "..." [--id <id>] [--dry]',
  );
  process.exit(1);
}
const token = process.env.COLLECTION_TOKEN;
if (!token && !dry) {
  console.error("COLLECTION_TOKEN is not set");
  process.exit(1);
}

/**
 * An existing binder is edited BY ID.
 *
 * A fresh id would leave the old binder on every other device and give you two
 * of them — the merge converges on the id, so it is the only thing tying this
 * push to the thing you meant to change. Ids must be unique across DEVICES,
 * hence the random suffix when making a new one.
 */
const id = flag("id") ?? `b${Date.now().toString(36)}${randomBytes(5).toString("hex")}`;

const slots = JSON.parse(readFileSync(slotsPath, "utf8"));
const pages = [];
slots.forEach((slot, i) => {
  const page = Math.floor(i / pockets);
  pages[page] ??= { slots: {} };
  // A null is a line the catalog could not name. It stays an EMPTY pocket so
  // everything after it keeps the position the list gave it — closing the gap
  // would shift every later card one pocket from where you expect it.
  if (slot) pages[page].slots[i % pockets] = slot;
});

let cover = coverArg ? JSON.parse(coverArg) : undefined;
if (keepCover && !cover) {
  if (!flag("id")) {
    console.error("--keep-cover needs --id: there is no existing binder to read a cover from");
    process.exit(1);
  }
  if (!token) {
    console.error("--keep-cover needs COLLECTION_TOKEN to read the binder back");
    process.exit(1);
  }
  const res = await fetch(`${BASE}/api/binders?since=0`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    console.error(`could not read the binder back: HTTP ${res.status}`);
    process.exit(1);
  }
  const body = await res.json().catch(() => null);
  const existing = (body?.binders ?? []).find((b) => b.id === flag("id"));
  if (!existing) {
    console.error(`--keep-cover: the server holds no binder ${flag("id")}`);
    process.exit(1);
  }
  cover = existing.cover;
  console.log(cover ? "keeping the existing cover" : "the existing binder has no cover");
}

const binder = {
  id,
  name,
  format: String(pockets),
  pages,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  // Absent means default — never write a field holding its default value, or
  // the next sync carries an edit that says nothing. See CLAUDE.md.
  ...(cover ? { cover } : {}),
  ...(forTrade ? { forTrade: true } : {}),
};
writeFileSync("binder.json", JSON.stringify(binder, null, 2));

const filled = slots.filter(Boolean).length;
console.log(`${name}: ${filled} cards across ${pages.length} pages (id ${id})`);
if (dry) {
  console.log("dry run — nothing sent; wrote binder.json");
  process.exit(0);
}

const res = await fetch(`${BASE}/api/binders/merge`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  body: JSON.stringify({ binders: [binder] }),
});
const body = await res.json().catch(() => null);
if (!res.ok) {
  console.error(`push failed: HTTP ${res.status}`, body);
  process.exit(1);
}

// `dropped` counts rows the server refused as invalid. Anything above zero
// means the push silently did less than it claims.
const mine = (body?.binders ?? []).find((b) => b.id === id);
const landed = mine?.pages?.reduce((n, p) => n + Object.keys(p.slots).length, 0) ?? 0;
console.log(`pushed. dropped=${body?.dropped ?? "?"} — server now holds ${landed} cards`);
if (body?.dropped) process.exitCode = 1;
if (landed !== filled) {
  console.error(`MISMATCH: sent ${filled}, server has ${landed}`);
  process.exitCode = 1;
}
