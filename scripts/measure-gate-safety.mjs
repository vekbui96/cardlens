/**
 * Does the shipped gate (MAX_DISTANCE 16 / MIN_MARGIN 8) still false-accept
 * nothing, now that the index holds 20,205 cards instead of 1,709?
 *
 * `phash.ts` documents 0% false accepts. That figure is real but it was measured
 * by `validate-recognition.mjs`, which builds its OWN index out of the two or
 * three sets it was given — a few hundred cards. The shipped index is twelve
 * times the size it was when the number was taken, and crowding is exactly what
 * that script cannot see. `measure-hash-alternatives.mjs` noticed one false
 * accept in passing. This script exists to settle it properly.
 *
 * Three differences from every earlier measurement, all of which make it
 * stricter rather than kinder:
 *
 *  - it probes **every one of the 20,205 cards**, not a stride sample. A sample
 *    can only UNDER-count false accepts, and the question is whether the count
 *    is zero;
 *  - it searches the **shipped `index-*.bin`**, so a false accept found here is
 *    one the deployed scanner can actually produce, not one an experimental
 *    rebuild can;
 *  - it uses **all six** of `validate-recognition.mjs`'s distortions, byte for
 *    byte, so the auto-accept column means the same thing the 84.9% in
 *    `phash.ts` means and the two can be read in one table.
 *
 * Everything is hashed by the REAL `perceptualHash` inside real Chromium, the
 * same arrangement `validate-recognition.mjs` uses and for the same reason: the
 * browser's image decode and canvas resampling are the code path that runs on
 * the device, and a Node reimplementation would be measuring itself.
 *
 *   node scripts/measure-gate-safety.mjs fetch [--resume]   # ~20k images, checkpointed
 *   node scripts/measure-gate-safety.mjs report
 *
 * Working files go under `node_modules/.cache/` deliberately — it is the one
 * directory in this repo that BOTH .gitignore and .prettierignore already cover,
 * and a scratch dir anywhere else fails `format:check` in CI (see CLAUDE.md).
 *
 * Two axes are reported, because a gate has a safety number and a cost number
 * and neither alone can justify a choice:
 *
 *  - **autoAccepted / falseAccept** — `validate-recognition.mjs`'s question.
 *    Every distorted render of every card is searched against the shipped index;
 *    a trial counts as accepted only when the gate passes AND the top hit is the
 *    query card. Clean is excluded from the pool, as it is there, because a
 *    clean re-hash flatters everything.
 *  - **MATCHED / AMBIGUOUS** — `measure-index-crowding.mjs`'s question. Every
 *    card is fed its own hash and asked how far the nearest OTHER card is. A
 *    perfect capture is at distance 0, so MAX_DISTANCE cannot move this column:
 *    the entire crowding cost of tightening the gate is MIN_MARGIN's.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { build } from "esbuild";
import { chromium } from "@playwright/test";
import { MAX_DISTANCE, MIN_MARGIN, HASH_BITS } from "../src/scan/phash.ts";

const OUT_DIR = "public/card-index";
const WORK_DIR = "node_modules/.cache/gate-safety";
/** Where measure-hash-alternatives.mjs left its own features, used only to corroborate. */
const ALT_DIR = "node_modules/.cache/hash-alternatives";

const argv = process.argv.slice(2);
const MODE = argv.find((a) => !a.startsWith("--")) ?? "report";
const RESUME = argv.includes("--resume");

/**
 * The renders, in the order they are stored.
 *
 * Identical to `validate-recognition.mjs`'s SCANS — same names, same order, same
 * arithmetic — because the whole point of this script is that its auto-accept
 * column can be compared against the table already in `phash.ts`. `clean` is
 * stored first and is the parity control: re-hashed, it must equal the shipped
 * index bit for bit.
 */
const RENDERS = ["clean", "resampled", "cropError", "dim", "glare", "tilted", "everything"];

/** SWAR popcount, the same one phash.ts uses. */
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
  if (words.length !== cards.length * 2) {
    throw new Error(`${words.length / 2} hashes but ${cards.length} cards — the index is inconsistent`);
  }
  return { latest, cards, words };
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

// ---------------------------------------------------------------------------
// STAGE 1 — fetch: hash every card under every distortion, in real Chromium
// ---------------------------------------------------------------------------

/**
 * Everything that runs inside the page, as a real function rather than a string
 * so it is linted and formatted like the rest of the file.
 *
 * The distortions are copied from `validate-recognition.mjs` verbatim. They are
 * NOT re-derived or "improved" here: a distortion that differs by a pixel makes
 * every number below incomparable with the table it is meant to extend.
 */
function pageHarness() {
  function render(bmp, w, h, paint) {
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0, w, h);
    if (paint) paint(ctx, w, h);
    return ctx.getImageData(0, 0, w, h);
  }

  const SCANS = {
    clean: (bmp) => render(bmp, 245, 342),

    // Camera resolution then the perspective warp's resampling.
    resampled: (bmp) => {
      const mid = new OffscreenCanvas(480, 670);
      mid.getContext("2d").drawImage(bmp, 0, 0, 480, 670);
      return render(mid, 245, 342);
    },

    // The quad detector is never exact, and the art window is computed from the
    // detected bounds, so a 3% error moves the whole window.
    cropError: (bmp) => {
      const canvas = new OffscreenCanvas(245, 342);
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      const dx = 245 * 0.03;
      const dy = 342 * 0.03;
      ctx.drawImage(bmp, -dx, -dy, 245 + dx * 2, 342 + dy * 2);
      return ctx.getImageData(0, 0, 245, 342);
    },

    // Room light: a linear gain, which the DC term should absorb entirely.
    dim: (bmp) =>
      render(bmp, 245, 342, (ctx, w, h) => {
        ctx.globalCompositeOperation = "multiply";
        ctx.fillStyle = "rgba(0,0,0,0.35)";
        ctx.fillRect(0, 0, w, h);
      }),

    // Holo sheen / a window: a bright band that clips highlights.
    glare: (bmp) =>
      render(bmp, 245, 342, (ctx, w, h) => {
        const g = ctx.createLinearGradient(0, 0, w, h);
        g.addColorStop(0, "rgba(255,255,255,0)");
        g.addColorStop(0.45, "rgba(255,255,255,0.75)");
        g.addColorStop(0.7, "rgba(255,255,255,0)");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      }),

    // A hand is never square to the card.
    tilted: (bmp) => {
      const canvas = new OffscreenCanvas(245, 342);
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.translate(122, 171);
      ctx.rotate((3 * Math.PI) / 180);
      ctx.scale(1.02, 1);
      ctx.translate(-122, -171);
      ctx.drawImage(bmp, 0, 0, 245, 342);
      return ctx.getImageData(0, 0, 245, 342);
    },

    // Everything at once — the realistic worst case.
    everything: (bmp) => {
      const mid = new OffscreenCanvas(480, 670);
      const mctx = mid.getContext("2d");
      mctx.translate(240, 335);
      mctx.rotate((2.5 * Math.PI) / 180);
      mctx.translate(-240, -335);
      const dx = 480 * 0.025;
      const dy = 670 * 0.025;
      mctx.drawImage(bmp, -dx, -dy, 480 + dx * 2, 670 + dy * 2);
      const g = mctx.createLinearGradient(0, 0, 480, 670);
      g.addColorStop(0, "rgba(255,255,255,0)");
      g.addColorStop(0.5, "rgba(255,255,255,0.6)");
      g.addColorStop(0.8, "rgba(255,255,255,0)");
      mctx.fillStyle = g;
      mctx.fillRect(0, 0, 480, 670);
      return render(mid, 245, 342, (ctx, w, h) => {
        ctx.globalCompositeOperation = "multiply";
        ctx.fillStyle = "rgba(0,0,0,0.25)";
        ctx.fillRect(0, 0, w, h);
      });
    },
  };

  return {
    /** One card's hash under each named render, from the REAL phash.ts. */
    async hashAll(dataUrl, order) {
      const bmp = await createImageBitmap(await (await fetch(dataUrl)).blob());
      const rect = window.PHash.artRect(245, 342);
      const out = [];
      for (const name of order) {
        const img = SCANS[name](bmp);
        const h = window.PHash.perceptualHash(img.data, 245, 342, rect);
        out.push(h[0], h[1]);
      }
      bmp.close();
      return out;
    },
  };
}

/**
 * Image URLs, taken from the plan `measure-hash-alternatives.mjs` already wrote.
 *
 * That file resolved every URL through the same `/set-information` endpoint
 * `build-card-index.mjs` uses, retrying empties rather than accepting them, so
 * the bytes fetched here are the bytes that built the shipped index. Reusing it
 * also means this script needs no network access to SERVER-PC at all.
 */
function readUrls(cards) {
  const plan = JSON.parse(readFileSync(`${ALT_DIR}/subset.json`, "utf8"));
  if (plan.subset.length !== cards.length) {
    throw new Error(`${ALT_DIR}/subset.json covers ${plan.subset.length} cards, index has ${cards.length}`);
  }
  return plan.subset.map((c, i) => {
    if (c.ordinal !== i || c.id !== cards[i].id) {
      throw new Error(`subset.json row ${i} is ${c.id}, index row ${i} is ${cards[i].id} — regenerate it`);
    }
    return c.url;
  });
}

async function fetchStage() {
  const { latest, cards } = readShippedIndex();
  const urls = readUrls(cards);
  const n = cards.length;
  const perCard = RENDERS.length * 2;

  let done = 0;
  const words = new Uint32Array(n * perCard);
  const missing = new Uint8Array(n);
  if (RESUME && existsSync(`${WORK_DIR}/progress.json`)) {
    const prog = JSON.parse(readFileSync(`${WORK_DIR}/progress.json`, "utf8"));
    if (prog.version === latest.version && prog.renders.join(",") === RENDERS.join(",")) {
      const rb = readFileSync(`${WORK_DIR}/renders.u32`);
      words.set(new Uint32Array(rb.buffer, rb.byteOffset, prog.count * perCard));
      missing.set(Uint8Array.from(prog.missing ?? []), 0);
      done = prog.count;
      console.log(`Resuming from ${done.toLocaleString()} of ${n.toLocaleString()}`);
    } else {
      console.log("Checkpoint does not match this index or render list — starting over");
    }
  }

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
  await page.addScriptTag({ content: `window.HX = (${pageHarness.toString()})();` });

  mkdirSync(WORK_DIR, { recursive: true });
  const save = (count) => {
    writeFileSync(`${WORK_DIR}/renders.u32`, Buffer.from(words.buffer, 0, count * perCard * 4));
    writeFileSync(
      `${WORK_DIR}/progress.json`,
      JSON.stringify({
        version: latest.version,
        count,
        renders: RENDERS,
        missing: Array.from(missing.subarray(0, count)),
      }),
    );
  };

  const CHUNK = 60;
  const started = Date.now();
  const startedAt = done;
  for (let at = done; at < n; at += CHUNK) {
    const slice = urls.slice(at, at + CHUNK);
    const images = await mapLimit(slice, 8, async (url) => {
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const res = await fetch(url);
          if (!res.ok) throw new Error(String(res.status));
          const buf = Buffer.from(await res.arrayBuffer());
          return `data:${res.headers.get("content-type") ?? "image/png"};base64,${buf.toString("base64")}`;
        } catch {
          if (attempt === 3) return null;
          await new Promise((r) => setTimeout(r, attempt * 500));
        }
      }
      return null;
    });

    const part = await page.evaluate(
      async ({ sources, order }) => {
        const out = [];
        for (const src of sources) out.push(src ? await window.HX.hashAll(src, order) : null);
        return out;
      },
      { sources: images, order: RENDERS },
    );

    for (let k = 0; k < part.length; k++) {
      const i = at + k;
      // A card whose art will not download is marked, never dropped: dropping it
      // would shift every later card out of line with the index ordinals.
      if (!part[k]) missing[i] = 1;
      else words.set(part[k], i * perCard);
    }

    done = Math.min(at + CHUNK, n);
    if (at % (CHUNK * 20) === 0 || done === n) {
      save(done);
      const rate = (done - startedAt) / ((Date.now() - started) / 1000);
      console.log(`  ${done.toLocaleString()}/${n.toLocaleString()}  ${rate.toFixed(1)} cards/s`);
    }
  }
  save(done);
  await browser.close();
  console.log(`\nDone. ${missing.reduce((a, b) => a + b, 0)} cards without art.`);
}

// ---------------------------------------------------------------------------
// STAGE 2 — report
// ---------------------------------------------------------------------------

/**
 * Nearest and second-nearest entry to a query, and which entry the nearest is.
 *
 * The query card is NOT skipped when the query is a distorted render: it is in
 * the index, and the scanner searches the whole index. `skip` exists only for
 * the crowding pass, where a card must not be its own neighbour.
 *
 * Pruning on the partial sum is safe because Hamming distance only grows as
 * words are added, so a candidate already at or past the current runner-up can
 * neither become d1 nor lower d2.
 */
function nearestTwo(index, n, q0, q1, skip) {
  let d1 = HASH_BITS + 1;
  let d2 = HASH_BITS + 1;
  let at = -1;
  for (let j = 0, jb = 0; j < n; j++, jb += 2) {
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

/**
 * The shipped 64-bit hash rebuilt from the 12x12 luma DCT
 * `measure-hash-alternatives.mjs` cached, if that cache is present.
 *
 * Used for one thing only: to corroborate this script's renders against a
 * SEPARATELY derived pipeline. That earlier run computed its own box filter, its
 * own DCT and its own bit thresholds in a different harness; if both agree on
 * every card under three shared distortions, a bug would have to exist in both
 * in the same shape to survive.
 */
function altCorroboration(n) {
  if (!existsSync(`${ALT_DIR}/progress.json`)) return null;
  const prog = JSON.parse(readFileSync(`${ALT_DIR}/progress.json`, "utf8"));
  if (prog.count !== n) return null;
  const FEATURES_PER_RENDER = 304;
  const perCard = FEATURES_PER_RENDER * prog.renders.length;
  const fb = readFileSync(`${ALT_DIR}/features.f32`);
  const feats = new Float32Array(fb.buffer, fb.byteOffset, n * perCard);
  const out = new Map();
  for (const name of prog.renders) {
    const r = prog.renders.indexOf(name);
    const words = new Uint32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const base = i * perCard + r * FEATURES_PER_RENDER;
      const c = new Float64Array(64);
      for (let v = 0; v < 8; v++) for (let u = 0; u < 8; u++) c[v * 8 + u] = feats[base + v * 12 + u];
      const sorted = Float64Array.from(c.subarray(1)).sort();
      const mid = sorted.length >> 1;
      const m = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
      for (let bit = 0; bit < 64; bit++) {
        if (c[bit === 0 ? 1 : bit] > m) words[i * 2 + (bit >> 5)] |= 1 << (bit % 32);
      }
    }
    out.set(name, words);
  }
  return out;
}

function report() {
  const { latest, cards, words: index } = readShippedIndex();
  const n = cards.length;
  const perCard = RENDERS.length * 2;

  if (!existsSync(`${WORK_DIR}/progress.json`)) {
    throw new Error(`No render cache at ${WORK_DIR} — run: node scripts/measure-gate-safety.mjs fetch`);
  }
  const prog = JSON.parse(readFileSync(`${WORK_DIR}/progress.json`, "utf8"));
  if (prog.version !== latest.version) {
    throw new Error(`Cache is for index ${prog.version}, shipped index is ${latest.version} — re-fetch`);
  }
  if (prog.count !== n) throw new Error(`Cache holds ${prog.count} of ${n} cards — the fetch is incomplete`);
  if (prog.renders.join(",") !== RENDERS.join(",")) throw new Error("Cache render list does not match");
  const rb = readFileSync(`${WORK_DIR}/renders.u32`);
  const R = new Uint32Array(rb.buffer, rb.byteOffset, n * perCard);
  const missing = prog.missing.reduce((a, b) => a + b, 0);

  console.log(`${n.toLocaleString()} cards, index version ${latest.version}`);
  console.log(`Render cache: ${RENDERS.length} renders per card, ${missing} cards without art\n`);

  // -- PARITY --------------------------------------------------------------
  console.log("=== PARITY ===");
  let mismatched = 0;
  const drifted = [];
  for (let i = 0; i < n; i++) {
    if (prog.missing[i]) continue;
    if (R[i * perCard] !== index[i * 2] || R[i * perCard + 1] !== index[i * 2 + 1]) {
      mismatched++;
      if (drifted.length < 6) drifted.push(cards[i].id);
    }
  }
  console.log(`clean render re-hashed vs index-${latest.version}.bin: ${mismatched} of ${n} differ`);
  if (drifted.length) console.log(`  e.g. ${drifted.join(", ")}`);

  const alt = altCorroboration(n);
  if (!alt) {
    console.log("no measure-hash-alternatives cache to corroborate against (optional)");
  } else {
    for (const [name, w] of alt) {
      if (!RENDERS.includes(name)) continue;
      const r = RENDERS.indexOf(name);
      let differ = 0;
      for (let i = 0; i < n; i++) {
        if (prog.missing[i]) continue;
        if (R[i * perCard + r * 2] !== w[i * 2] || R[i * perCard + r * 2 + 1] !== w[i * 2 + 1]) differ++;
      }
      console.log(`${name.padEnd(11)} vs measure-hash-alternatives' independent pipeline: ${differ} differ`);
    }
  }
  if (mismatched || missing) {
    console.log("PARITY FAILED — everything below would be measuring this script, not the scanner.");
    process.exit(1);
  }
  console.log("PARITY OK — the harness reproduces the shipped hash for every card.\n");

  // -- (1) crowding: the COST axis -----------------------------------------
  //
  // Every card fed its own hash, exactly as measure-index-crowding.mjs does it.
  const nearestOther = new Int32Array(n);
  const nearestOtherAt = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const { d1, at } = nearestTwo(index, n, index[i * 2], index[i * 2 + 1], i);
    nearestOther[i] = d1;
    nearestOtherAt[i] = at;
  }
  const matchedAt = (minMargin) => {
    let m = 0;
    for (let i = 0; i < n; i++) if (nearestOther[i] >= minMargin) m++;
    return m;
  };
  const baseMatched = matchedAt(MIN_MARGIN);
  console.log(
    `Crowding at the shipped margin ${MIN_MARGIN}: MATCHED ${baseMatched.toLocaleString()} ` +
      `(${((baseMatched / n) * 100).toFixed(1)}%), AMBIGUOUS ${(n - baseMatched).toLocaleString()} ` +
      `(${(((n - baseMatched) / n) * 100).toFixed(1)}%)\n`,
  );

  // -- (2) distorted queries: the SAFETY axis ------------------------------
  //
  // A card queried with its own hash sits at distance 0 and always ranks first,
  // so the crowding pass structurally cannot produce a false accept. Here the
  // query is a distorted render searched against the shipped index of clean art,
  // which is exactly how the scanner works.
  const probes = RENDERS.map((name, r) => ({ name, r })).filter((e) => e.name !== "clean");
  const d1s = new Int32Array(probes.length * n);
  const d2s = new Int32Array(d1s.length);
  const hitAt = new Int32Array(d1s.length);
  for (let e = 0; e < probes.length; e++) {
    const started = Date.now();
    for (let i = 0; i < n; i++) {
      const b = i * perCard + probes[e].r * 2;
      const hit = nearestTwo(index, n, R[b], R[b + 1], -1);
      d1s[e * n + i] = hit.d1;
      d2s[e * n + i] = hit.d2;
      hitAt[e * n + i] = hit.at;
    }
    console.log(`  probed ${probes[e].name.padEnd(11)} ${((Date.now() - started) / 1000).toFixed(1)}s`);
  }
  const trials = probes.length * n;

  function judgeAll(maxDistance, minMargin) {
    let accepted = 0;
    let wrong = 0;
    const wrongRows = [];
    for (let e = 0; e < probes.length; e++) {
      for (let i = 0; i < n; i++) {
        const at = e * n + i;
        const d1 = d1s[at];
        if (d1 > maxDistance || d2s[at] - d1 < minMargin) continue;
        if (hitAt[at] === i) accepted++;
        else {
          wrong++;
          wrongRows.push({ e, i, d1, d2: d2s[at], hit: hitAt[at] });
        }
      }
    }
    return { accepted, wrong, wrongRows };
  }

  // -- the reproduction ----------------------------------------------------
  console.log(`\n=== THE SHIPPED GATE (${MAX_DISTANCE}/${MIN_MARGIN}), all ${n.toLocaleString()} cards ===`);
  const perRender = [];
  for (let e = 0; e < probes.length; e++) {
    let accepted = 0;
    const bad = [];
    for (let i = 0; i < n; i++) {
      const at = e * n + i;
      const d1 = d1s[at];
      if (d1 > MAX_DISTANCE || d2s[at] - d1 < MIN_MARGIN) continue;
      if (hitAt[at] === i) accepted++;
      else bad.push(cards[i].id);
    }
    perRender.push({
      render: probes[e].name,
      autoAccepted: `${((accepted / n) * 100).toFixed(1)}%`,
      WRONG: bad.length,
      examples: bad.slice(0, 5).join(", "),
    });
  }
  console.table(perRender);

  const shippedRun = judgeAll(MAX_DISTANCE, MIN_MARGIN);
  console.log(`FALSE ACCEPTS at ${MAX_DISTANCE}/${MIN_MARGIN}: ${shippedRun.wrong} of ${trials} trials`);
  for (const w of shippedRun.wrongRows) {
    const q = cards[w.i];
    const h = cards[w.hit];
    const b = w.i * perCard + probes[w.e].r * 2;
    const dTrue = popcount(R[b] ^ index[w.i * 2]) + popcount(R[b + 1] ^ index[w.i * 2 + 1]);
    console.log(`\n  ${q.id} "${q.name}" (${q.setName} ${q.number}) under ${probes[w.e].name}`);
    console.log(`    filed as ${h.id} "${h.name}" (${h.setName} ${h.number})`);
    console.log(`    distance ${w.d1}, runner-up ${w.d2}, margin ${w.d2 - w.d1}`);
    console.log(`    the RIGHT answer sat ${dTrue} bits away — further than the wrong one`);
    console.log(
      `    on a clean capture: ${nearestOther[w.i]} bits from ${cards[nearestOtherAt[w.i]]?.id}, ` +
        `${nearestOther[w.i] >= MIN_MARGIN ? "MATCHED" : "AMBIGUOUS"} in the crowding pass`,
    );
    const all = [];
    for (let j = 0; j < n; j++) {
      all.push({ j, d: popcount(R[b] ^ index[j * 2]) + popcount(R[b + 1] ^ index[j * 2 + 1]) });
    }
    all.sort((a, c) => a.d - c.d);
    console.log(
      `    nearest five: ${all
        .slice(0, 5)
        .map((s) => `${cards[s.j].id}@${s.d}`)
        .join("  ")}`,
    );
  }

  // -- (3) the trade -------------------------------------------------------
  console.log("\n=== GATE SWEEP ===");
  console.log(
    `autoAccepted / falseAccept: ${trials.toLocaleString()} trials ` +
      `(${n.toLocaleString()} cards x ${probes.length} distortions), validate-recognition.mjs methodology.`,
  );
  console.log(
    `MATCHED / lost: measure-index-crowding.mjs methodology over ${n.toLocaleString()} self-queries. ` +
      `Baseline ${baseMatched.toLocaleString()} MATCHED at margin ${MIN_MARGIN}.`,
  );
  const rows = [];
  for (const maxD of [10, 16, 24]) {
    for (const minM of [4, 5, 6, 7, 8, 9, 10, 11, 12, 14]) {
      const r = judgeAll(maxD, minM);
      const matched = matchedAt(minM);
      rows.push({
        maxDistance: maxD,
        minMargin: minM,
        autoAccepted: `${((r.accepted / trials) * 100).toFixed(1)}%`,
        falseAccept: `${((r.wrong / trials) * 100).toFixed(3)}%`,
        wrongCards: r.wrong,
        MATCHED: `${((matched / n) * 100).toFixed(1)}%`,
        lostVsShipped: baseMatched - matched,
      });
    }
  }
  console.table(rows);
  console.log("maxDistance does not move MATCHED: a self-query is at distance 0, so only the margin");
  console.log("can make a perfect capture ambiguous. The whole crowding cost is MIN_MARGIN's.");

  // -- (4) how close is the next false accept? ------------------------------
  //
  // A gate that reaches zero because the worst leak sat one bit under it is not
  // safe, it is lucky. The margin actually achieved by every WRONG top-1 hit is
  // the distribution that decides how much headroom a chosen margin really has.
  console.log("\n=== HEADROOM: margin achieved by wrong top-1 hits, within MAX_DISTANCE ===");
  const wrongMargins = [];
  for (let e = 0; e < probes.length; e++) {
    for (let i = 0; i < n; i++) {
      const at = e * n + i;
      if (hitAt[at] === i || d1s[at] > MAX_DISTANCE) continue;
      wrongMargins.push(d2s[at] - d1s[at]);
    }
  }
  wrongMargins.sort((a, b) => b - a);
  const hist = new Map();
  for (const m of wrongMargins) hist.set(m, (hist.get(m) ?? 0) + 1);
  console.log(`${wrongMargins.length.toLocaleString()} trials where the top hit is the WRONG card`);
  console.log("  margin  trials   (higher margin = closer to being auto-accepted)");
  for (const m of [...hist.keys()].sort((a, b) => b - a).slice(0, 12)) {
    console.log(`  ${String(m).padStart(6)}  ${String(hist.get(m)).padStart(6)}`);
  }

  // -- (4b) what a candidate margin costs, per render ------------------------
  //
  // The pooled auto-accept rate hides which distortion pays. Two of the six
  // renders are near-lossless and track the crowding number; the other four are
  // where the scanner already asks most of the time, so a margin that looks
  // expensive pooled can be cheap where it matters.
  const CANDIDATE_MARGIN = 10;
  console.log(`\n=== PER RENDER: margin ${MIN_MARGIN} against margin ${CANDIDATE_MARGIN} ===`);
  const compare = [];
  for (let e = 0; e < probes.length; e++) {
    const cell = (minM) => {
      let ok = 0;
      let bad = 0;
      for (let i = 0; i < n; i++) {
        const at = e * n + i;
        if (d1s[at] > MAX_DISTANCE || d2s[at] - d1s[at] < minM) continue;
        if (hitAt[at] === i) ok++;
        else bad++;
      }
      return { ok, bad };
    };
    const a = cell(MIN_MARGIN);
    const b = cell(CANDIDATE_MARGIN);
    compare.push({
      render: probes[e].name,
      [`accept @${MIN_MARGIN}`]: `${((a.ok / n) * 100).toFixed(1)}%`,
      [`WRONG @${MIN_MARGIN}`]: a.bad,
      [`accept @${CANDIDATE_MARGIN}`]: `${((b.ok / n) * 100).toFixed(1)}%`,
      [`WRONG @${CANDIDATE_MARGIN}`]: b.bad,
      cost: `${(((a.ok - b.ok) / n) * 100).toFixed(1)}pt`,
    });
  }
  console.table(compare);

  // -- (5) the population a margin is actually protecting --------------------
  //
  // A false accept needs a card whose nearest index neighbour is close enough
  // that a distortion can reorder the two. That population is visible without
  // any distortion at all: it is the cards sitting just ABOVE the margin, which
  // auto-accept today and have a rival within a few bits. A margin does not
  // remove that population, it only moves the line through it — which is the
  // honest reason a swept gate is evidence of a leak found, not of safety.
  console.log("\n=== The population at risk: how far is each card's nearest neighbour? ===");
  const bands = [
    [0, 1],
    [1, 4],
    [4, 8],
    [8, 10],
    [10, 12],
    [12, 16],
    [16, 65],
  ];
  for (const [lo, hi] of bands) {
    let count = 0;
    for (let i = 0; i < n; i++) if (nearestOther[i] >= lo && nearestOther[i] < hi) count++;
    const label = hi === lo + 1 ? `exactly ${lo}` : `${lo}-${hi - 1} bits`;
    console.log(
      `  ${label.padEnd(14)} ${String(count).padStart(6)}  ` +
        `${((count / n) * 100).toFixed(1)}%${lo >= MIN_MARGIN && lo < 12 ? "   <- auto-accepts today, with a rival within 12 bits" : ""}`,
    );
  }
}

if (MODE === "fetch") await fetchStage();
else if (MODE === "report") report();
else throw new Error(`unknown mode ${MODE} — use fetch | report`);
