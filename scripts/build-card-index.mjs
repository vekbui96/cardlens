/**
 * Build the artwork index the scanner matches against.
 *
 * Emits two static assets under public/card-index/, shipped from GitHub Pages
 * rather than the companion server: the CDN is free, and SERVER-PC has been
 * found powered off twice. Scanning must not depend on a machine in a house
 * being switched on.
 *
 *   index-<version>.bin   2 uint32 per card, little-endian — 8 bytes each
 *   cards-<version>.json  parallel metadata, same order
 *
 * Hashing runs in real Chromium so the index is built by the SAME code path
 * that will hash the camera frame. Preprocessing that differs between the two
 * halves is the classic way to lose accuracy and never work out why, which is
 * also why phash.ts does its own downscale rather than trusting drawImage.
 *
 *   node scripts/build-card-index.mjs [setId...]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { build } from "esbuild";
import { chromium } from "@playwright/test";

const execFile = promisify(execFileCb);

/** Defaults to the sets actually being collected, most-held first. */
const DEFAULT_SETS = ["rsv10pt5", "me2", "me5", "me3", "zsv10pt5", "me4", "sv8", "sv8pt5", "me1", "me2pt5"];
const SETS = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_SETS;

const HOST = "server-pc.tail0e4194.ts.net:8443";
const FUNNEL_IP = "199.38.181.54";
const OUT_DIR = "public/card-index";

async function getJson(path) {
  const { stdout } = await execFile(
    "curl",
    ["-s", "-m", "120", "--resolve", `${HOST}:${FUNNEL_IP}`, `https://${HOST}/api${path}`],
    { maxBuffer: 512 * 1024 * 1024 },
  );
  return JSON.parse(stdout);
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (i < items.length) {
        const at = i++;
        out[at] = await fn(items[at], at);
      }
    }),
  );
  return out;
}

/**
 * A set that comes back empty is a FAILURE, not an answer.
 *
 * pokemontcg.io fails roughly a quarter of the time in bursts (see CLAUDE.md),
 * and the first version of this script accepted the empty result and moved on.
 * That silently dropped White Flare — 173 cards, the largest single holding in
 * the collection — from the index, and nothing would have surfaced it until
 * scanning those cards mysteriously never worked.
 */
async function setCards(setId) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const info = await getJson(`/set-information/${setId}`);
    const data = info?.cards?.data ?? [];
    if (data.length > 0) return data;
    console.log(`  ${setId}: empty (attempt ${attempt}/4) — retrying`);
    // Failures cluster in time rather than being independent, so a tight retry
    // lands inside the same burst. Back off past it.
    await new Promise((r) => setTimeout(r, attempt * 3000));
  }
  throw new Error(`${setId} returned no cards after 4 attempts — refusing to build a partial index`);
}

console.log(`Building index for ${SETS.length} sets…`);
const cards = [];
for (const setId of SETS) {
  const data = await setCards(setId);
  let kept = 0;
  for (const c of data) {
    const url = c.images?.small ?? c.images?.large;
    if (!url) continue;
    cards.push({
      id: c.id,
      name: c.name,
      number: c.number,
      setId: c.set?.id ?? setId,
      setName: c.set?.name ?? setId,
      rarity: c.rarity ?? null,
      url,
    });
    kept++;
  }
  console.log(`  ${setId.padEnd(10)} ${kept}/${data.length} cards with art`);
}

console.log(`Downloading ${cards.length} images…`);
const downloaded = (
  await mapLimit(cards, 8, async (c) => {
    try {
      const res = await fetch(c.url);
      if (!res.ok) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      const type = res.headers.get("content-type") ?? "image/png";
      return { ...c, data: `data:${type};base64,${buf.toString("base64")}` };
    } catch {
      return null;
    }
  })
).filter(Boolean);
console.log(`  ${downloaded.length} downloaded (${cards.length - downloaded.length} failed)`);

const bundled = await build({
  entryPoints: ["src/scan/phash.ts"],
  bundle: true,
  format: "iife",
  globalName: "PHash",
  write: false,
  target: "es2022",
});

const browser = await chromium.launch();
const page = await browser.newPage();
await page.addScriptTag({ content: bundled.outputFiles[0].text });

// Chunked so a few thousand data URLs are not passed in one argument.
const hashes = [];
const CHUNK = 250;
for (let at = 0; at < downloaded.length; at += CHUNK) {
  const slice = downloaded.slice(at, at + CHUNK).map((c) => c.data);
  const part = await page.evaluate(async (images) => {
    const { perceptualHash, artRect } = window.PHash;
    const out = [];
    for (const src of images) {
      const bmp = await createImageBitmap(await (await fetch(src)).blob());
      // Every card is normalised to one size first, so a set whose art is
      // published at a different resolution cannot hash differently for that
      // reason alone.
      const canvas = new OffscreenCanvas(245, 342);
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(bmp, 0, 0, 245, 342);
      const img = ctx.getImageData(0, 0, 245, 342);
      const h = perceptualHash(img.data, 245, 342, artRect(245, 342));
      out.push([h[0], h[1]]);
      bmp.close();
    }
    return out;
  }, slice);
  hashes.push(...part);
  process.stdout.write(`\r  hashed ${hashes.length}/${downloaded.length}`);
}
console.log();
await browser.close();

const index = new Uint32Array(hashes.length * 2);
hashes.forEach(([a, b], i) => {
  index[i * 2] = a;
  index[i * 2 + 1] = b;
});

/**
 * Version is content-derived, so a rebuild that changes nothing produces the
 * same filename and every cached copy stays valid — and one that DOES change
 * gets a new URL, which is what lets the service worker cache it forever.
 */
const { createHash } = await import("node:crypto");
const version = createHash("sha256").update(Buffer.from(index.buffer)).digest("hex").slice(0, 8);

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(`${OUT_DIR}/index-${version}.bin`, Buffer.from(index.buffer));
writeFileSync(
  `${OUT_DIR}/cards-${version}.json`,
  JSON.stringify(
    downloaded.map((c) => ({
      id: c.id,
      name: c.name,
      number: c.number,
      setId: c.setId,
      setName: c.setName,
      rarity: c.rarity,
    })),
  ),
);
writeFileSync(
  `${OUT_DIR}/latest.json`,
  JSON.stringify(
    { version, cards: downloaded.length, sets: SETS, builtAt: new Date().toISOString() },
    null,
    2,
  ),
);

const kb = (n) => `${(n / 1024).toFixed(0)}KB`;
console.log(`\nindex-${version}.bin  ${kb(index.byteLength)}  (${downloaded.length} cards)`);
console.log(`cards-${version}.json ${kb(Buffer.byteLength(JSON.stringify(downloaded.map((c) => c.id))))}+`);

// Collisions matter more than size: two cards sharing a hash can never be told
// apart by artwork, and the scanner has to fall back to asking.
const seen = new Map();
let collisions = 0;
for (let i = 0; i < hashes.length; i++) {
  const key = `${hashes[i][0]}:${hashes[i][1]}`;
  if (seen.has(key)) {
    collisions++;
    if (collisions <= 5) console.log(`  collision: ${downloaded[i].id} = ${downloaded[seen.get(key)].id}`);
  } else seen.set(key, i);
}
console.log(`exact collisions: ${collisions}`);
