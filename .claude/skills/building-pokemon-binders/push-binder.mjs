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
const format = flag("format", "9");
const pockets = format === "12" ? 12 : 9;

if (!slotsPath || !name) {
  console.error('usage: COLLECTION_TOKEN=... node push-binder.mjs slots.json --name "..." [--id <id>] [--dry]');
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

const binder = { id, name, format: String(pockets), pages, createdAt: Date.now(), updatedAt: Date.now() };
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
