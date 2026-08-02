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
const args = process.argv.slice(2);

/** `all` builds the whole English catalog rather than just what is collected. */
async function resolveSets() {
  if (args[0] === "all") {
    const sets = await getJson("/catalog/sets");
    const list = Array.isArray(sets) ? sets : (sets?.data ?? []);
    return list.map((s) => s.id).filter(Boolean);
  }
  return args.length ? args : DEFAULT_SETS;
}

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
  if (args[0] === "all") {
    // Whole-catalog builds cover promos and oddities that genuinely have no
    // cards; failing the run after forty minutes of downloads would be worse
    // than noting it. A named-set build still refuses, because there the set
    // was asked for by name and its absence is the bug.
    console.log(`  ${setId}: no cards — skipping`);
    return [];
  }
  throw new Error(`${setId} returned no cards after 4 attempts — refusing to build a partial index`);
}

const SETS = await resolveSets();
console.log(`Building index for ${SETS.length} sets…`);

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

/**
 * Download, hash, discard — one chunk at a time.
 *
 * The first version collected every image as a base64 data URL and hashed the
 * lot at the end. That is fine for the ten sets being collected and fatal for
 * the whole catalog: 20,460 images at ~50KB of base64 each is over a gigabyte,
 * and the build died with a V8 out-of-memory after forty minutes of downloads.
 * Nothing survives a chunk here except 8 bytes and a little metadata per card.
 */
const CHUNK = 100;
const hashes = [];
const downloaded = [];

for (const setId of SETS) {
  const data = await setCards(setId);
  const cards = [];
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
  }

  let done = 0;
  for (let at = 0; at < cards.length; at += CHUNK) {
    const slice = cards.slice(at, at + CHUNK);
    const images = await mapLimit(slice, 8, async (c) => {
      try {
        const res = await fetch(c.url);
        if (!res.ok) return null;
        const buf = Buffer.from(await res.arrayBuffer());
        return `data:${res.headers.get("content-type") ?? "image/png"};base64,${buf.toString("base64")}`;
      } catch {
        return null;
      }
    });

    const keep = slice.filter((_, i) => images[i]);
    const part = await page.evaluate(async (sources) => {
      const { perceptualHash, artRect } = window.PHash;
      const out = [];
      for (const src of sources) {
        const bmp = await createImageBitmap(await (await fetch(src)).blob());
        // Normalised to one size first, so a set published at a different
        // resolution cannot hash differently for that reason alone.
        const canvas = new OffscreenCanvas(245, 342);
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(bmp, 0, 0, 245, 342);
        const img = ctx.getImageData(0, 0, 245, 342);
        const h = perceptualHash(img.data, 245, 342, artRect(245, 342));
        out.push([h[0], h[1]]);
        bmp.close();
      }
      return out;
    }, images.filter(Boolean));

    hashes.push(...part);
    downloaded.push(...keep);
    done += keep.length;
  }
  console.log(`  ${setId.padEnd(10)} ${done}/${data.length}   (${downloaded.length} total)`);
}

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
