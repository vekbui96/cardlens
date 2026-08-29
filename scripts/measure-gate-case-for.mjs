/**
 * How does the false-accept leak SCALE with the size of the index?
 *
 * `measure-gate-safety.mjs` answers "does the shipped gate leak at 20,205
 * cards" (it does: 2 trials in 121,230). It cannot answer the question that
 * decides whether MIN_MARGIN 8 is a bug or a coincidence: **is 2 the top of a
 * curve, or a point on one that is still climbing?** The index has already gone
 * 1,709 -> 20,205 once, and the answer changed from 0 to 2 when it did.
 *
 * This script re-uses the render cache `measure-gate-safety.mjs` already wrote
 * (`node_modules/.cache/gate-safety/`) — no images are re-downloaded and no
 * hashing is redone, so every hash here is byte-identical to the one that
 * passed that script's PARITY check against the shipped `index-*.bin`.
 *
 * It measures the same gate over SMALLER indexes carved out of the shipped one:
 *
 *  - **prefix** — the first K sets in release order, which is how the catalog
 *    actually grows: new sets are appended, and every new set is a chance for
 *    its art to collide with something already there.
 *  - **random** — uniform subsets at fixed sizes, several seeds each, so
 *    "bigger index" is separated from "different era of card art".
 *
 * A trial is scored exactly as `measure-gate-safety.mjs` scores it: a distorted
 * render of card i is searched against the sub-index, and it is a FALSE ACCEPT
 * when the gate passes and the top hit is not i. Only cards inside the subset
 * are queried, because a card outside it is not in the index and could not be
 * recognised at all.
 *
 *   node scripts/measure-gate-case-for.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { MAX_DISTANCE, HASH_BITS } from "../src/scan/phash.ts";

const OUT_DIR = "public/card-index";
const WORK_DIR = "node_modules/.cache/gate-safety";
const RENDERS = ["clean", "resampled", "cropError", "dim", "glare", "tilted", "everything"];
const MARGINS = [6, 7, 8, 9, 10, 11];

function popcount(n) {
  n = n - ((n >>> 1) & 0x55555555);
  n = (n & 0x33333333) + ((n >>> 2) & 0x33333333);
  n = (n + (n >>> 4)) & 0x0f0f0f0f;
  return (n * 0x01010101) >>> 24;
}

function readShippedIndex() {
  const latest = JSON.parse(readFileSync(`${OUT_DIR}/latest.json`, "utf8"));
  const cards = JSON.parse(readFileSync(`${OUT_DIR}/cards-${latest.version}.json`, "utf8"));
  const bin = readFileSync(`${OUT_DIR}/index-${latest.version}.bin`);
  const words = new Uint32Array(bin.buffer, bin.byteOffset, bin.byteLength / 4);
  if (words.length !== cards.length * 2) throw new Error("index inconsistent with cards");
  return { latest, cards, words };
}

function readRenders(latest, n) {
  if (!existsSync(`${WORK_DIR}/progress.json`)) {
    throw new Error(`No render cache at ${WORK_DIR} — run: node scripts/measure-gate-safety.mjs fetch`);
  }
  const prog = JSON.parse(readFileSync(`${WORK_DIR}/progress.json`, "utf8"));
  if (prog.version !== latest.version) throw new Error(`cache is for index ${prog.version}`);
  if (prog.count !== n) throw new Error(`cache holds ${prog.count} of ${n}`);
  if (prog.renders.join(",") !== RENDERS.join(",")) throw new Error("cache render list does not match");
  const rb = readFileSync(`${WORK_DIR}/renders.u32`);
  return { R: new Uint32Array(rb.buffer, rb.byteOffset, n * RENDERS.length * 2), prog };
}

/** Nearest and second-nearest in a flat sub-index. Same pruning as the sweep. */
function nearestTwo(index, m, q0, q1, skip) {
  let d1 = HASH_BITS + 1;
  let d2 = HASH_BITS + 1;
  let at = -1;
  for (let j = 0, jb = 0; j < m; j++, jb += 2) {
    if (j === skip) continue;
    let d = popcount(q0 ^ index[jb]);
    if (d < d2) {
      d += popcount(q1 ^ index[jb + 1]);
      if (d < d1) {
        d2 = d1;
        d1 = d;
        at = j;
      } else if (d < d2) d2 = d;
    }
  }
  return { d1, d2, at };
}

/** Mulberry32 — a seeded PRNG, so every subset here is reproducible. */
function rng(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Run the whole gate over one subset of ordinals.
 *
 * Returns leaks per margin, auto-accepts per margin, the crowding count
 * (cards whose nearest OTHER entry is under the margin), and the highest margin
 * any wrong top-1 hit achieved — the headroom number.
 */
function evaluate(ordinals, index, R, perCard) {
  const m = ordinals.length;
  const sub = new Uint32Array(m * 2);
  for (let k = 0; k < m; k++) {
    sub[k * 2] = index[ordinals[k] * 2];
    sub[k * 2 + 1] = index[ordinals[k] * 2 + 1];
  }

  const leaks = new Map(MARGINS.map((x) => [x, 0]));
  const accepts = new Map(MARGINS.map((x) => [x, 0]));
  const leakRows = [];
  let topWrongMargin = -1;
  let trials = 0;

  for (let r = 1; r < RENDERS.length; r++) {
    for (let k = 0; k < m; k++) {
      const b = ordinals[k] * perCard + r * 2;
      const { d1, d2, at } = nearestTwo(sub, m, R[b], R[b + 1], -1);
      trials++;
      if (d1 > MAX_DISTANCE) continue;
      const margin = d2 - d1;
      const right = at === k;
      if (!right && margin > topWrongMargin) topWrongMargin = margin;
      for (const mm of MARGINS) {
        if (margin < mm) continue;
        if (right) accepts.set(mm, accepts.get(mm) + 1);
        else {
          leaks.set(mm, leaks.get(mm) + 1);
          if (mm === 8) leakRows.push({ k, r, d1, d2, at });
        }
      }
    }
  }

  // Crowding: every entry fed its own hash, nearest OTHER entry in the subset.
  const crowd = new Map(MARGINS.map((x) => [x, 0]));
  const nearestOther = new Int32Array(m);
  for (let k = 0; k < m; k++) {
    const { d1 } = nearestTwo(sub, m, sub[k * 2], sub[k * 2 + 1], k);
    nearestOther[k] = d1;
    for (const mm of MARGINS) if (d1 < mm) crowd.set(mm, crowd.get(mm) + 1);
  }

  return { m, trials, leaks, accepts, crowd, leakRows, topWrongMargin, nearestOther };
}

// ---------------------------------------------------------------------------

const { latest, cards, words: index } = readShippedIndex();
const n = cards.length;
const perCard = RENDERS.length * 2;
const { R } = readRenders(latest, n);
console.log(
  `${n.toLocaleString()} cards, index ${latest.version}, render cache verified by measure-gate-safety.mjs\n`,
);

// -- A. release-order prefixes ----------------------------------------------
//
// latest.json lists the sets in release order and cards-*.json is in the same
// order, so a prefix of sets is the index as it would have looked before those
// later sets existed. This is the closest thing to a time machine available
// without rebuilding old indexes.
const setOrder = latest.sets;
const setStart = new Map();
for (let i = 0; i < n; i++) if (!setStart.has(cards[i].setId)) setStart.set(cards[i].setId, i);

console.log("=== A. LEAK vs INDEX SIZE — first K sets in release order ===");
console.log("(every card in the prefix, all six distortions, gate maxDistance 16)\n");
const prefixRows = [];
for (const K of [20, 40, 60, 80, 100, 120, 140, 160, setOrder.length]) {
  const cut = K >= setOrder.length ? n : setStart.get(setOrder[K]);
  const ordinals = Int32Array.from({ length: cut }, (_, i) => i);
  const e = evaluate(ordinals, index, R, perCard);
  prefixRows.push({
    sets: K,
    cards: e.m,
    trials: e.trials,
    "leaks@6": e.leaks.get(6),
    "leaks@8": e.leaks.get(8),
    "leaks@10": e.leaks.get(10),
    "leaks@8 per 100k": ((e.leaks.get(8) / e.trials) * 1e5).toFixed(2),
    "worst wrong margin": e.topWrongMargin,
    "AMBIG@8": `${((e.crowd.get(8) / e.m) * 100).toFixed(1)}%`,
    "AMBIG@10": `${((e.crowd.get(10) / e.m) * 100).toFixed(1)}%`,
  });
}
console.table(prefixRows);

// -- B. random subsets, several seeds ---------------------------------------
//
// A prefix confounds size with era: the first 20 sets are all 1999-2003 art. A
// uniform subset holds the size axis alone.
console.log("\n=== B. LEAK vs INDEX SIZE — uniform random subsets, 3 seeds each ===\n");
const randRows = [];
for (const size of [1709, 3000, 5000, 8000, 12000, 16000, 20205]) {
  const per = [];
  for (const seed of [1, 2, 3]) {
    if (size === n) {
      if (seed > 1) continue;
      per.push(
        evaluate(
          Int32Array.from({ length: n }, (_, i) => i),
          index,
          R,
          perCard,
        ),
      );
      continue;
    }
    const rand = rng(seed);
    const pick = Int32Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const t = pick[i];
      pick[i] = pick[j];
      pick[j] = t;
    }
    const ordinals = pick.slice(0, size).sort();
    per.push(evaluate(ordinals, index, R, perCard));
  }
  const mean = (f) => per.reduce((a, e) => a + f(e), 0) / per.length;
  randRows.push({
    cards: size,
    seeds: per.length,
    "leaks@8 (each)": per.map((e) => e.leaks.get(8)).join("/"),
    "leaks@10 (each)": per.map((e) => e.leaks.get(10)).join("/"),
    "leaks@11 (each)": per.map((e) => e.leaks.get(11)).join("/"),
    "leaks@8 per 100k": ((mean((e) => e.leaks.get(8)) / mean((e) => e.trials)) * 1e5).toFixed(2),
    "worst wrong margin": Math.max(...per.map((e) => e.topWrongMargin)),
    "AMBIG@8": `${mean((e) => (e.crowd.get(8) / e.m) * 100).toFixed(1)}%`,
    "AMBIG@10": `${mean((e) => (e.crowd.get(10) / e.m) * 100).toFixed(1)}%`,
  });
}
console.table(randRows);

// -- C. the population a growing index keeps adding -------------------------
//
// A false accept needs a card with a rival close enough that a distortion can
// reorder the two. That population is countable without any distortion, and how
// it grows with n is what predicts the next leak.
console.log("\n=== C. THE AT-RISK POPULATION vs index size (random subsets, seed 1) ===");
console.log("cards whose nearest OTHER entry is within N bits — the fuel for a false accept\n");
const popRows = [];
for (const size of [1709, 3000, 5000, 8000, 12000, 16000, 20205]) {
  let ordinals;
  if (size === n) ordinals = Int32Array.from({ length: n }, (_, i) => i);
  else {
    const rand = rng(1);
    const pick = Int32Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const t = pick[i];
      pick[i] = pick[j];
      pick[j] = t;
    }
    ordinals = pick.slice(0, size).sort();
  }
  const sub = new Uint32Array(ordinals.length * 2);
  for (let k = 0; k < ordinals.length; k++) {
    sub[k * 2] = index[ordinals[k] * 2];
    sub[k * 2 + 1] = index[ordinals[k] * 2 + 1];
  }
  const bands = { "<4": 0, "<8": 0, "<10": 0, "<12": 0, "<16": 0 };
  for (let k = 0; k < ordinals.length; k++) {
    const { d1 } = nearestTwo(sub, ordinals.length, sub[k * 2], sub[k * 2 + 1], k);
    if (d1 < 4) bands["<4"]++;
    if (d1 < 8) bands["<8"]++;
    if (d1 < 10) bands["<10"]++;
    if (d1 < 12) bands["<12"]++;
    if (d1 < 16) bands["<16"]++;
  }
  popRows.push({
    cards: ordinals.length,
    "rival <4 bits": bands["<4"],
    "rival <8": bands["<8"],
    "rival <10": bands["<10"],
    "rival <12": bands["<12"],
    "<12 as % of index": `${((bands["<12"] / ordinals.length) * 100).toFixed(1)}%`,
  });
}
console.table(popRows);
console.log("If the last column RISES with n, crowding is superlinear: each new card is more");
console.log("likely than the last to land near something already there, so the leak grows faster");
console.log("than the catalog does.");

// -- D. how WIDE is the crop-error failure window? --------------------------
//
// `measure-gate-safety.mjs` renders exactly ONE crop error: a symmetric 3%
// over-crop. If ex3-86 and bw2-32 only fail at 3.0% and are fine at 2.5% and
// 3.5%, the leak is a knife-edge artefact of the harness and margin 8 is
// defensible. If they fail across a band of realistic detector errors, the
// leak is a property of the cards.
//
// The two cards are re-rendered at a range of crop errors — symmetric, and
// one-sided, because a quad detector is as likely to be off to one side as it
// is to be uniformly tight — hashed by the REAL perceptualHash inside real
// Chromium, and searched against the whole shipped index.
console.log("\n=== D. THE CROP-ERROR WINDOW for the two cards that leak at margin 8 ===");
const { build } = await import("esbuild");
const { chromium } = await import("@playwright/test");

function cropHarness() {
  return {
    async hashCrops(dataUrl, plan) {
      const bmp = await createImageBitmap(await (await fetch(dataUrl)).blob());
      const rect = window.PHash.artRect(245, 342);
      const out = [];
      for (const { fx, fy, ox, oy } of plan) {
        const canvas = new OffscreenCanvas(245, 342);
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        const dx = 245 * fx;
        const dy = 342 * fy;
        // Identical arithmetic to measure-gate-safety.mjs's cropError at
        // fx = fy = 0.03, ox = oy = 0 — so that row reproduces its result.
        ctx.drawImage(bmp, -dx + 245 * ox, -dy + 342 * oy, 245 + dx * 2, 342 + dy * 2);
        const img = ctx.getImageData(0, 0, 245, 342);
        const h = window.PHash.perceptualHash(img.data, 245, 342, rect);
        out.push([h[0], h[1]]);
      }
      bmp.close();
      return out;
    },
  };
}

const plan = [];
for (const f of [0, 0.01, 0.015, 0.02, 0.025, 0.03, 0.035, 0.04, 0.05, 0.06]) {
  plan.push({ fx: f, fy: f, ox: 0, oy: 0, label: `symmetric ${(f * 100).toFixed(1)}%` });
}
for (const o of [0.01, 0.02, 0.03]) {
  plan.push({ fx: 0.02, fy: 0.02, ox: o, oy: 0, label: `2% + ${(o * 100).toFixed(0)}% off to one side` });
}

const subsetPlan = JSON.parse(readFileSync("node_modules/.cache/hash-alternatives/subset.json", "utf8"));
const urlOf = new Map(subsetPlan.subset.map((c) => [c.id, c.url]));
const ordinalOf = new Map(cards.map((c, i) => [c.id, i]));

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
await page.addScriptTag({ content: `window.CH = (${cropHarness.toString()})();` });

for (const id of ["ex3-86", "bw2-32"]) {
  const res = await fetch(urlOf.get(id));
  const buf = Buffer.from(await res.arrayBuffer());
  const dataUrl = `data:${res.headers.get("content-type") ?? "image/png"};base64,${buf.toString("base64")}`;
  const hashes = await page.evaluate(async ({ src, p }) => window.CH.hashCrops(src, p), {
    src: dataUrl,
    p: plan.map(({ fx, fy, ox, oy }) => ({ fx, fy, ox, oy })),
  });
  const self = ordinalOf.get(id);
  const rows = hashes.map((h, i) => {
    const { d1, d2, at } = nearestTwo(index, n, h[0], h[1], -1);
    const dTrue = popcount(h[0] ^ index[self * 2]) + popcount(h[1] ^ index[self * 2 + 1]);
    const margin = d2 - d1;
    const right = at === self;
    const gate = (mm) => (d1 <= MAX_DISTANCE && margin >= mm ? (right ? "accept" : "WRONG") : "ask");
    return {
      crop: plan[i].label,
      "top hit": cards[at].id,
      d1,
      "runner-up": d2,
      margin,
      "true card at": dTrue,
      "@margin 8": gate(8),
      "@margin 10": gate(10),
    };
  });
  console.log(`\n${id} "${cards[self].name}" (${cards[self].setName} ${cards[self].number})`);
  console.table(rows);
}
await browser.close();
