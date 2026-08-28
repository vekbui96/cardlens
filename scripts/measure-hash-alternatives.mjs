/**
 * Can a BETTER HASH close the scanner's ambiguity gap, or is OCR the only way?
 *
 * `measure-index-crowding.mjs` says the shipped 64-bit greyscale hash leaves
 * 1,730 of 20,205 cards (8.6%) AMBIGUOUS at MAX_DISTANCE 16 / MIN_MARGIN 8, with
 * 0 WRONG. Only 652 of those are exact ties. The other 1,078 sit 2-7 bits from
 * their nearest neighbour — close enough to spoil the margin, far enough that
 * they are NOT the same picture. "No hash can touch them" is therefore false for
 * 62% of the gap, and that claim is what OCR's whole business case rests on.
 *
 * This script settles it by measurement: it recomputes the SHIPPED hash first to
 * prove the harness is honest, then measures four alternatives against the same
 * gate semantics.
 *
 * It was meant to fetch only the ambiguous cards and their competitors. The plan
 * stage says that is the whole catalog. Measured on the shipped index — cards
 * within R bits of SOME ambiguous card:
 *
 *   R=16   10,354      R=20   19,913      R=24   20,205      R=32   20,205
 *
 * That is a finding in itself, and it is the first thing that argues against a
 * bigger hash: 8.6% of the catalog is ambiguous not because a few reprints sit
 * on top of each other, but because at 64 bits the whole space is one
 * neighbourhood. So the run downloads all 20,205, and no result below carries a
 * subset caveat.
 *
 * Four stages, because the second downloads twenty thousand images and must
 * survive being interrupted:
 *
 *   node scripts/measure-hash-alternatives.mjs plan   [--radius 24]
 *   node scripts/measure-hash-alternatives.mjs fetch  [--resume]
 *   node scripts/measure-hash-alternatives.mjs measure
 *   node scripts/measure-hash-alternatives.mjs bench
 *
 * Working files go under node_modules/.cache/ deliberately: they are tens of
 * megabytes of intermediate floats, and that directory is the only place in this
 * repo that BOTH .gitignore and .prettierignore already cover. A scratch dir
 * anywhere else fails `format:check` in CI (see CLAUDE.md).
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { build } from "esbuild";
import { chromium } from "@playwright/test";
import { MAX_DISTANCE, MIN_MARGIN, HASH_BITS } from "../src/scan/phash.ts";

const execFile = promisify(execFileCb);

const OUT_DIR = "public/card-index";
const WORK_DIR = "node_modules/.cache/hash-alternatives";
const HOST = "server-pc.tail0e4194.ts.net:8443";
const FUNNEL_IP = "199.38.181.54";

const argv = process.argv.slice(2);
const MODE = argv.find((a) => !a.startsWith("--")) ?? "plan";
const RESUME = argv.includes("--resume");

/**
 * How far from an ambiguous card we bother fetching competitors.
 *
 * The measurement only ever sees the cards it fetched, so a competitor left out
 * is a competitor that cannot spoil a margin — which flatters every variant.
 * Two bounds decide how far is far enough:
 *
 * For any variant that APPENDS bits to the shipped 64 (the chroma ones), the
 * distance can only grow, so a card already 24 bits away in greyscale can never
 * come within a scaled gate's margin. That case is provably safe at any radius
 * at or above the scaled margin.
 *
 * For the 128-bit greyscale variant there is no such guarantee — it re-derives
 * its median over a different coefficient set, so a bit that was set can clear.
 * 24 is roughly 1.5x the shipped MAX_DISTANCE of 16, and it turned out to select
 * the entire catalog anyway, so the knob is kept only to document the reasoning
 * and to let a smaller run be forced for a quick check.
 */
const RADIUS = Number(argv.find((a) => a.startsWith("--radius="))?.split("=")[1] ?? 24);

/** SWAR popcount, same one phash.ts uses. */
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
  return { latest, cards, words, bytes: bin.byteLength };
}

/**
 * The funnel drops connections; a transport failure is not an answer.
 * Lifted from build-card-index.mjs, which learned this at set 91 of 168.
 */
async function getJson(path, attempts = 4) {
  for (let attempt = 1; ; attempt++) {
    try {
      const { stdout } = await execFile(
        "curl",
        ["-s", "-m", "120", "--resolve", `${HOST}:${FUNNEL_IP}`, `https://${HOST}/api${path}`],
        { maxBuffer: 512 * 1024 * 1024 },
      );
      return JSON.parse(stdout);
    } catch (err) {
      if (attempt >= attempts) throw err;
      await new Promise((r) => setTimeout(r, attempt * 3000));
    }
  }
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
// STAGE 1 — plan: who is ambiguous, and who is crowding them
// ---------------------------------------------------------------------------

async function plan() {
  const { latest, cards, words } = readShippedIndex();
  const n = cards.length;
  console.log(`Shipped index: ${n.toLocaleString()} cards, version ${latest.version}`);

  // One O(n^2) pass collects both facts at once: each card's nearest OTHER card
  // (which decides ambiguity, exactly as measure-index-crowding.mjs does it) and
  // every card inside RADIUS of an ambiguous one.
  const nearest = new Int32Array(n).fill(HASH_BITS + 1);
  const ambiguous = [];
  const exactTie = new Uint8Array(n);

  for (let i = 0; i < n; i++) {
    const a0 = words[i * 2];
    const a1 = words[i * 2 + 1];
    let best = HASH_BITS + 1;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const d = popcount(a0 ^ words[j * 2]) + popcount(a1 ^ words[j * 2 + 1]);
      if (d < best) best = d;
      if (best === 0) break;
    }
    nearest[i] = best;
    if (best === 0) exactTie[i] = 1;
    if (best < MIN_MARGIN) ambiguous.push(i);
  }

  console.log(`AMBIGUOUS (nearest other < MIN_MARGIN ${MIN_MARGIN}): ${ambiguous.length.toLocaleString()}`);
  console.log(
    `  of which exact ties (0 bits): ${ambiguous.filter((i) => exactTie[i]).length.toLocaleString()}`,
  );

  // Neighbourhood sizes at several radii, so the choice of RADIUS is a measured
  // trade rather than a guess about download volume.
  const keep = new Uint8Array(n);
  const sizes = new Map([16, 20, 24, 32].map((r) => [r, 0]));
  for (const i of ambiguous) {
    const a0 = words[i * 2];
    const a1 = words[i * 2 + 1];
    keep[i] = 1;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const d = popcount(a0 ^ words[j * 2]) + popcount(a1 ^ words[j * 2 + 1]);
      if (d <= RADIUS) keep[j] = 1;
    }
  }
  // Counting each radius separately would be four more O(n * |ambiguous|)
  // passes; instead count once per radius over the same loop shape but only for
  // reporting, which is cheap because it reuses `keep` for the chosen radius.
  for (const r of sizes.keys()) {
    const mark = new Uint8Array(n);
    for (const i of ambiguous) {
      const a0 = words[i * 2];
      const a1 = words[i * 2 + 1];
      mark[i] = 1;
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const d = popcount(a0 ^ words[j * 2]) + popcount(a1 ^ words[j * 2 + 1]);
        if (d <= r) mark[j] = 1;
      }
    }
    sizes.set(
      r,
      mark.reduce((a, b) => a + b, 0),
    );
  }
  console.log("\nSubset size by radius (ambiguous cards plus every competitor within R bits):");
  for (const [r, size] of sizes) console.log(`  R=${String(r).padStart(2)}  ${size.toLocaleString()} cards`);

  const subsetOrdinals = [];
  for (let i = 0; i < n; i++) if (keep[i]) subsetOrdinals.push(i);
  console.log(`\nChosen R=${RADIUS}: ${subsetOrdinals.length.toLocaleString()} cards to fetch`);

  // Image URLs. Taken from the same /set-information endpoint build-card-index
  // uses, so the bytes hashed here are the bytes that built the shipped index.
  // The derived images.pokemontcg.io path is only a fallback for a set the
  // server cannot answer for — it is the documented URL shape, but a set whose
  // catalog entry points somewhere else would hash differently and that is
  // precisely the kind of drift the parity check exists to catch.
  const setIds = [...new Set(subsetOrdinals.map((i) => cards[i].setId))];
  console.log(`Resolving image URLs across ${setIds.length} sets…`);
  const urlBySet = new Map();
  await mapLimit(setIds, 4, async (setId) => {
    // An empty set is a FAILURE, not an answer — pokemontcg.io fails ~25% of the
    // time in bursts, and the first run of this stage accepted the empties and
    // silently fell back to a derived URL for 1,968 cards. Same retry
    // build-card-index.mjs uses, and for the same reason.
    let byId = new Map();
    for (let attempt = 1; attempt <= 4; attempt++) {
      const info = await getJson(`/set-information/${setId}`);
      byId = new Map();
      for (const c of info?.cards?.data ?? []) {
        const url = c.images?.small ?? c.images?.large;
        if (url) byId.set(c.id, url);
      }
      if (byId.size > 0) break;
      await new Promise((r) => setTimeout(r, attempt * 3000));
    }
    urlBySet.set(setId, byId);
  });

  let derived = 0;
  const subset = subsetOrdinals.map((i) => {
    const c = cards[i];
    let url = urlBySet.get(c.setId)?.get(c.id);
    if (!url) {
      url = `https://images.pokemontcg.io/${c.setId}/${c.number}.png`;
      derived++;
    }
    return {
      ordinal: i,
      id: c.id,
      name: c.name,
      number: c.number,
      setId: c.setId,
      setName: c.setName,
      ambiguous: nearest[i] < MIN_MARGIN,
      exactTie: exactTie[i] === 1,
      nearestBits: nearest[i],
      url,
    };
  });
  console.log(`  ${subset.length - derived} URLs from the catalog, ${derived} derived`);

  mkdirSync(WORK_DIR, { recursive: true });
  writeFileSync(
    `${WORK_DIR}/subset.json`,
    JSON.stringify({ version: latest.version, radius: RADIUS, totalCards: n, subset }),
  );
  console.log(`\nWrote ${WORK_DIR}/subset.json — now run: node scripts/measure-hash-alternatives.mjs fetch`);
}

// ---------------------------------------------------------------------------
// STAGE 2 — fetch: download the subset and extract raw features in Chromium
// ---------------------------------------------------------------------------

/**
 * Per render we store RAW FLOATS, not finished hashes.
 *
 * Every variant below is some thresholding of the same DCT coefficients and
 * chroma means, so storing the coefficients means a new variant — or a swept
 * constant — costs a re-run of the measure stage rather than another few
 * thousand image downloads. That mattered in practice: the chroma deadband
 * DEAD_BAND started as a guess and was only grounded once the distribution of
 * |Cb - 128| could be read off the stored data.
 *
 *   [  0..143]  luma DCT, 12x12 block, row-major (u + v*12)
 *   [144..207]  Cb DCT, 8x8 block
 *   [208..271]  Cr DCT, 8x8 block
 *   [272..287]  Cb mean per cell of a 4x4 grid
 *   [288..303]  Cr mean per cell of a 4x4 grid
 */
const FEATURES_PER_RENDER = 304;
/**
 * clean is the parity control. The other three are the distortions
 * validate-recognition.mjs already established as the ones that matter — the
 * crop error above all, because the art window is derived from detected card
 * bounds and a 3% error moves the whole window.
 *
 * They exist here for ONE reason: a self-query can never produce a false accept
 * (a card's own hash is at distance 0 and always ranks first), so the perfect-
 * capture measurement cannot fail any variant on the axis that matters. Only a
 * distorted query can.
 */
const RENDERS = ["clean", "cropError", "glare", "everything"];
const FEATURES_PER_CARD = FEATURES_PER_RENDER * RENDERS.length;

/**
 * Everything that runs inside Chromium, as a real function rather than a string
 * so it is linted and formatted like the rest of the file. Installed once with
 * addScriptTag and then called per chunk.
 */
function pageHarness() {
  const SIZE = 32;

  /**
   * Box-filter a rectangle down to SIZE x SIZE in Y, Cb and Cr at once.
   *
   * The luma arithmetic is copied line for line from phash.ts `downscaleGrey`,
   * including the floor/clamp on cell bounds, because the whole experiment is
   * worthless if the control does not reproduce the shipped hash. Averaging luma
   * over a box equals the luma of the averaged RGB (both are linear in RGB), so
   * this plane is bit-identical to the shipped one rather than merely close.
   *
   * Cb/Cr are full-range Rec. 601, the same primaries the luma weights come
   * from — mixing JPEG chroma with a different luma definition would put the
   * three planes in different colour spaces for no reason.
   */
  function downscalePlanes(rgba, width, height, rect) {
    const y = new Float64Array(SIZE * SIZE);
    const cb = new Float64Array(SIZE * SIZE);
    const cr = new Float64Array(SIZE * SIZE);
    const cellW = rect.w / SIZE;
    const cellH = rect.h / SIZE;

    for (let cy = 0; cy < SIZE; cy++) {
      const y0 = Math.floor(rect.y + cy * cellH);
      const y1 = Math.max(y0 + 1, Math.floor(rect.y + (cy + 1) * cellH));
      for (let cx = 0; cx < SIZE; cx++) {
        const x0 = Math.floor(rect.x + cx * cellW);
        const x1 = Math.max(x0 + 1, Math.floor(rect.x + (cx + 1) * cellW));
        let sy = 0;
        let sb = 0;
        let sr = 0;
        let n = 0;
        for (let py = y0; py < y1 && py < height; py++) {
          if (py < 0) continue;
          const row = py * width;
          for (let px = x0; px < x1 && px < width; px++) {
            if (px < 0) continue;
            const i = (row + px) * 4;
            const R = rgba[i];
            const G = rgba[i + 1];
            const B = rgba[i + 2];
            sy += 0.299 * R + 0.587 * G + 0.114 * B;
            sb += 128 - 0.168736 * R - 0.331264 * G + 0.5 * B;
            sr += 128 + 0.5 * R - 0.418688 * G - 0.081312 * B;
            n++;
          }
        }
        const at = cy * SIZE + cx;
        y[at] = n > 0 ? sy / n : 0;
        cb[at] = n > 0 ? sb / n : 128;
        cr[at] = n > 0 ? sr / n : 128;
      }
    }
    return { y, cb, cr };
  }

  /** Cosine table for a BLOCK-wide truncated DCT-II over SIZE samples. */
  function cosTable(block) {
    const t = new Float64Array(block * SIZE);
    for (let u = 0; u < block; u++) {
      for (let x = 0; x < SIZE; x++) {
        t[u * SIZE + x] = Math.cos(((2 * x + 1) * u * Math.PI) / (2 * SIZE));
      }
    }
    return t;
  }
  function alphaTable(block) {
    const a = new Float64Array(block);
    a[0] = Math.SQRT1_2;
    for (let u = 1; u < block; u++) a[u] = 1;
    return a;
  }

  const COS = { 8: cosTable(8), 12: cosTable(12) };
  const ALPHA = { 8: alphaTable(8), 12: alphaTable(12) };

  /**
   * Top-left block x block coefficients of the 2D DCT-II — phash.ts `dctBlock`
   * with the block size lifted out as a parameter. Separable and truncated, so
   * a 12-wide block costs half again what an 8-wide one does, not four times.
   *
   * Because each coefficient is computed independently, the 8x8 block is exactly
   * the top-left 8x8 of the 12x12 one. That is what lets a single stored 12x12
   * serve both the 64-bit control and the 128-bit variant.
   */
  function dct(plane, block) {
    const cos = COS[block];
    const alpha = ALPHA[block];
    const rows = new Float64Array(SIZE * block);
    for (let r = 0; r < SIZE; r++) {
      const base = r * SIZE;
      for (let u = 0; u < block; u++) {
        let sum = 0;
        for (let x = 0; x < SIZE; x++) sum += plane[base + x] * cos[u * SIZE + x];
        rows[r * block + u] = sum * alpha[u];
      }
    }
    const out = new Float64Array(block * block);
    for (let v = 0; v < block; v++) {
      for (let u = 0; u < block; u++) {
        let sum = 0;
        for (let r = 0; r < SIZE; r++) sum += rows[r * block + u] * cos[v * SIZE + r];
        out[v * block + u] = sum * alpha[v];
      }
    }
    return out;
  }

  /** Mean of each cell of a 4x4 grid over a 32x32 plane — 8x8 pixels per cell. */
  function grid4(plane) {
    const out = new Float64Array(16);
    for (let gy = 0; gy < 4; gy++) {
      for (let gx = 0; gx < 4; gx++) {
        let sum = 0;
        for (let y = gy * 8; y < gy * 8 + 8; y++) {
          for (let x = gx * 8; x < gx * 8 + 8; x++) sum += plane[y * SIZE + x];
        }
        out[gy * 4 + gx] = sum / 64;
      }
    }
    return out;
  }

  function features(imageData, rect) {
    const planes = downscalePlanes(imageData.data, imageData.width, imageData.height, rect);
    const out = new Float64Array(304);
    out.set(dct(planes.y, 12), 0);
    out.set(dct(planes.cb, 8), 144);
    out.set(dct(planes.cr, 8), 208);
    out.set(grid4(planes.cb), 272);
    out.set(grid4(planes.cr), 288);
    return out;
  }

  function render(bmp, w, h, paint) {
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0, w, h);
    if (paint) paint(ctx, w, h);
    return ctx.getImageData(0, 0, w, h);
  }

  /** Verbatim from validate-recognition.mjs, so the two scripts agree on what a
   * realistic capture looks like. */
  const RENDERS = {
    clean: (bmp) => render(bmp, 245, 342),
    cropError: (bmp) => {
      const canvas = new OffscreenCanvas(245, 342);
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      const dx = 245 * 0.03;
      const dy = 342 * 0.03;
      ctx.drawImage(bmp, -dx, -dy, 245 + dx * 2, 342 + dy * 2);
      return ctx.getImageData(0, 0, 245, 342);
    },
    glare: (bmp) =>
      render(bmp, 245, 342, (ctx, w, h) => {
        const g = ctx.createLinearGradient(0, 0, w, h);
        g.addColorStop(0, "rgba(255,255,255,0)");
        g.addColorStop(0.45, "rgba(255,255,255,0.75)");
        g.addColorStop(0.7, "rgba(255,255,255,0)");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      }),
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
    downscalePlanes,
    features,
    RENDERS,
    /**
     * Feature vectors for one image, plus the SHIPPED hash of its clean render
     * taken from the real phash.ts — not a reimplementation. Parity has to be
     * against the code that is deployed or it proves nothing.
     */
    async extract(dataUrl, order) {
      const bmp = await createImageBitmap(await (await fetch(dataUrl)).blob());
      const rect = window.PHash.artRect(245, 342);
      const feats = new Float64Array(304 * order.length);
      let shipped = null;
      let greyPlaneMatches = true;
      for (let i = 0; i < order.length; i++) {
        const img = RENDERS[order[i]](bmp);
        feats.set(features(img, rect), i * 304);
        if (order[i] === "clean") {
          shipped = window.PHash.perceptualHash(img.data, 245, 342, rect);
          // Cross-check the plane, not just the hash: if the box filter here
          // drifted from phash.ts, every variant would be measuring a slightly
          // different picture and the 64-bit control would hide it behind the
          // median threshold.
          const mine = downscalePlanes(img.data, 245, 342, rect).y;
          const theirs = window.PHash.downscaleGrey(img.data, 245, 342, rect);
          for (let k = 0; k < mine.length; k++) {
            if (Math.abs(mine[k] - theirs[k]) > 1e-9) greyPlaneMatches = false;
          }
        }
      }
      bmp.close();
      return { feats: Array.from(feats), shipped: [shipped[0], shipped[1]], greyPlaneMatches };
    },
  };
}

/**
 * Everything hashed so far, written whole.
 *
 * Three whole-catalog runs of build-card-index.mjs have been stopped part-way
 * and each threw away everything it had done, so this one checkpoints too. The
 * count in progress.json is the join: features.f32 and shipped.u32 are truncated
 * to it, and `fetch --resume` reads exactly that many cards back.
 */
function checkpoint(feats, shipped, count, planFile, subset, planeMismatches) {
  writeFileSync(`${WORK_DIR}/features.f32`, Buffer.from(feats.buffer, 0, count * FEATURES_PER_CARD * 4));
  writeFileSync(`${WORK_DIR}/shipped.u32`, Buffer.from(shipped.buffer, 0, count * 2 * 4));
  writeFileSync(`${WORK_DIR}/subset.json`, JSON.stringify({ ...planFile, subset }));
  writeFileSync(
    `${WORK_DIR}/progress.json`,
    JSON.stringify({ version: planFile.version, count, planeMismatches, renders: RENDERS }),
  );
}

async function fetchStage() {
  const planFile = JSON.parse(readFileSync(`${WORK_DIR}/subset.json`, "utf8"));
  const subset = planFile.subset;

  let done = 0;
  let feats = new Float32Array(subset.length * FEATURES_PER_CARD);
  let shipped = new Uint32Array(subset.length * 2);
  let planeMismatches = 0;
  if (RESUME && existsSync(`${WORK_DIR}/progress.json`)) {
    const prog = JSON.parse(readFileSync(`${WORK_DIR}/progress.json`, "utf8"));
    if (prog.version === planFile.version && prog.count <= subset.length) {
      const fb = readFileSync(`${WORK_DIR}/features.f32`);
      const sb = readFileSync(`${WORK_DIR}/shipped.u32`);
      feats.set(new Float32Array(fb.buffer, fb.byteOffset, prog.count * FEATURES_PER_CARD));
      shipped.set(new Uint32Array(sb.buffer, sb.byteOffset, prog.count * 2));
      done = prog.count;
      planeMismatches = prog.planeMismatches ?? 0;
      console.log(`Resuming from ${done.toLocaleString()} of ${subset.length.toLocaleString()} cards`);
    } else {
      console.log("Checkpoint does not match this plan — starting over");
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

  const CHUNK = 60;
  const started = Date.now();
  const startedAt = done;
  for (let at = done; at < subset.length; at += CHUNK) {
    const slice = subset.slice(at, at + CHUNK);
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

    const part = await page.evaluate(
      async ({ sources, order }) => {
        const out = [];
        for (const src of sources) {
          out.push(src ? await window.HX.extract(src, order) : null);
        }
        return out;
      },
      { sources: images, order: RENDERS },
    );

    for (let k = 0; k < part.length; k++) {
      const idx = at + k;
      if (!part[k]) {
        // A card whose art will not download is left as all-zero features and
        // marked, rather than dropped: dropping it would shift every later card
        // in the flat arrays out of line with subset.json.
        subset[idx].missing = true;
        continue;
      }
      feats.set(part[k].feats, idx * FEATURES_PER_CARD);
      shipped[idx * 2] = part[k].shipped[0];
      shipped[idx * 2 + 1] = part[k].shipped[1];
      if (!part[k].greyPlaneMatches) planeMismatches++;
    }

    done = Math.min(at + CHUNK, subset.length);
    // The feature blob is 1,216 floats per card — 98MB across the whole catalog
    // — and it is rewritten whole, so checkpointing every chunk would spend more
    // time on disk than on hashing. Every tenth chunk caps the loss at ten
    // minutes of downloading, which is the trade build-card-index makes per set.
    if (at % (CHUNK * 10) === 0 || done === subset.length) {
      checkpoint(feats, shipped, done, planFile, subset, planeMismatches);
      const rate = (done - startedAt) / ((Date.now() - started) / 1000);
      console.log(`  ${done.toLocaleString()}/${subset.length.toLocaleString()}  ${rate.toFixed(1)} cards/s`);
    }
  }
  checkpoint(feats, shipped, done, planFile, subset, planeMismatches);
  await browser.close();
  console.log(`\nDone. greyscale-plane mismatches vs phash.ts: ${planeMismatches}`);
}

// ---------------------------------------------------------------------------
// STAGE 3 — measure
// ---------------------------------------------------------------------------

/**
 * Chroma deadband, in Cb/Cr units either side of neutral 128.
 *
 * A chroma bit thresholded against the card's OWN median is a coin flip on a
 * near-greyscale card — half the bits flip on noise, which adds distance between
 * a card and its own capture. Thresholding against absolute neutral fixes that
 * but puts the boundary exactly where an uncoloured cell sits. So each cell gets
 * TWO bits, a thermometer code with a deadband: (v > 128-D, v > 128+D). A
 * neutral cell is stably (1,0) and has to move D units to change anything;
 * strongly blue is (1,1); strongly yellow (0,0).
 *
 * D = 8 is grounded in the measured distribution — the measure stage prints the
 * spread of |Cb-128| and |Cr-128| over the fetched subset, and 8 sits near the
 * bottom decile, so it discards the cells that carry no colour and keeps the
 * rest.
 */
const DEAD_BAND = 8;

/** Indices into a stored feature vector. */
const F = { yDct: 0, cbDct: 144, crDct: 208, cbGrid: 272, crGrid: 288 };

function median(values) {
  const sorted = Float64Array.from(values).sort();
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function setBit(words, bit) {
  words[bit >> 5] |= 1 << (bit % 32);
}

/**
 * The shipped 64-bit hash, rebuilt from the stored 12x12 luma DCT.
 *
 * Reads the top-left 8x8 in row-major order, drops the DC term from both the
 * median and the hash, and spends bit 0 on a duplicate of coefficient 1 — all
 * exactly as phash.ts does. Any deviation here shows up as a parity failure.
 */
function bitsGrey64(f, base) {
  const c = new Float64Array(64);
  for (let v = 0; v < 8; v++) for (let u = 0; u < 8; u++) c[v * 8 + u] = f[base + F.yDct + v * 12 + u];
  const m = median(c.subarray(1));
  const words = new Uint32Array(2);
  for (let bit = 0; bit < 64; bit++) if (c[bit === 0 ? 1 : bit] > m) setBit(words, bit);
  return words;
}

/**
 * 128 bits of luma, from the SAME 32x32 downscale.
 *
 * Two ways to double the bits were available and only one is a fair test. A
 * finer GRID (48x48 or 64x64 before the DCT) changes what the hash looks at;
 * more COEFFICIENTS changes only how finely it describes what it already looks
 * at. Keeping SIZE at 32 isolates the bit count, which is the claim under test.
 * 32 samples support harmonics to u=16 by Nyquist, so a 12-wide block is real
 * signal rather than interpolation noise.
 *
 * 12x12 gives 144 coefficients; the DC term is dropped for the same reason as
 * before, and the 128 kept are the 128 LOWEST-FREQUENCY of the remaining 143,
 * ordered by u+v. Row-major would have spent bits on the 12th horizontal
 * harmonic while skipping the 3rd vertical one, which is not "finer", just
 * lopsided.
 */
const LOW_FREQ_128 = (() => {
  const idx = [];
  for (let v = 0; v < 12; v++)
    for (let u = 0; u < 12; u++) if (u || v) idx.push({ at: v * 12 + u, f: u + v, u });
  idx.sort((a, b) => a.f - b.f || a.u - b.u);
  return Int32Array.from(idx.slice(0, 128).map((e) => e.at));
})();

function bitsGrey128(f, base) {
  const c = new Float64Array(128);
  for (let i = 0; i < 128; i++) c[i] = f[base + F.yDct + LOW_FREQ_128[i]];
  const m = median(c);
  const words = new Uint32Array(4);
  for (let bit = 0; bit < 128; bit++) if (c[bit] > m) setBit(words, bit);
  return words;
}

/**
 * 64 bits of chroma: a 4x4 grid, Cb and Cr, two thermometer bits per cell.
 *
 * Coarse on purpose. The job is not to describe the colour, it is to separate
 * two cards whose luma structure is identical — a recoloured reprint, a
 * different type frame, a gold border. Those differ over the WHOLE card, so a
 * 4x4 grid catches them; a finer grid would only add bits that move together.
 */
function bitsChroma64(f, base, dead = DEAD_BAND) {
  const words = new Uint32Array(2);
  let bit = 0;
  for (const plane of [F.cbGrid, F.crGrid]) {
    for (let i = 0; i < 16; i++) {
      const v = f[base + plane + i];
      if (v > 128 - dead) setBit(words, bit);
      bit++;
      if (v > 128 + dead) setBit(words, bit);
      bit++;
    }
  }
  return words;
}

/**
 * 128 bits of chroma, the expensive way: the shipped 64-bit DCT recipe applied
 * to Cb and to Cr separately, median and all.
 *
 * Included as an upper bound rather than a proposal. It is the most information
 * a hash of this shape can extract from colour, so if it does not close the gap,
 * nothing cheaper will either.
 */
function bitsChromaDct128(f, base) {
  const words = new Uint32Array(4);
  let bit = 0;
  for (const plane of [F.cbDct, F.crDct]) {
    const c = new Float64Array(64);
    for (let i = 0; i < 64; i++) c[i] = f[base + plane + i];
    const m = median(c.subarray(1));
    for (let i = 0; i < 64; i++) {
      if (c[i === 0 ? 1 : i] > m) setBit(words, bit);
      bit++;
    }
  }
  return words;
}

/**
 * One card's features with a global illuminant shift applied to chroma only.
 *
 * The 4x4 grid means move by delta directly. In the DCT, adding a constant to
 * every one of the 32x32 samples adds to the (0,0) coefficient alone — every
 * other basis function has cosine terms that sum to zero over the block — and
 * with this normalisation that increment is alpha0^2 * 1024 * delta = 512*delta.
 * Luma is untouched, which is the point: it isolates what colour costs.
 */
function tintChroma(feats, base, delta) {
  const out = new Float64Array(FEATURES_PER_RENDER);
  for (let i = 0; i < FEATURES_PER_RENDER; i++) out[i] = feats[base + i];
  out[F.cbDct] += 512 * delta;
  out[F.crDct] += 512 * delta;
  for (let i = 0; i < 16; i++) {
    out[F.cbGrid + i] += delta;
    out[F.crGrid + i] += delta;
  }
  return out;
}

function concat(...parts) {
  const total = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint32Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/**
 * The variants under test.
 *
 * `bits` is the code length; the gate is scaled from the shipped 16/8 by the
 * same factor. That is the conservative reading of "adjusted proportionally":
 * impostor distances grow like the code length, but their spread only grows like
 * its square root, so a proportional margin is RELATIVELY tighter at 128 bits
 * (16 bits is 2.8 standard deviations of a 128-bit impostor distribution, where
 * 8 bits is 2.0 at 64). Any variant that wins under this scaling wins under a
 * looser one too.
 */
const VARIANTS = [
  { key: "a", name: "grey64 (shipped control)", bits: 64, of: (f, b) => bitsGrey64(f, b) },
  { key: "b", name: "grey128 (12x12 DCT)", bits: 128, of: (f, b) => bitsGrey128(f, b) },
  {
    key: "c",
    name: "grey64 + chroma64 grid",
    bits: 128,
    of: (f, b) => concat(bitsGrey64(f, b), bitsChroma64(f, b)),
  },
  {
    key: "d",
    name: "grey128 + chroma64 grid",
    bits: 192,
    of: (f, b) => concat(bitsGrey128(f, b), bitsChroma64(f, b)),
  },
  {
    key: "e",
    name: "grey64 + chromaDCT128",
    bits: 192,
    of: (f, b) => concat(bitsGrey64(f, b), bitsChromaDct128(f, b)),
  },
];

function gateFor(bits) {
  const scale = bits / HASH_BITS;
  return { maxDistance: Math.round(MAX_DISTANCE * scale), minMargin: Math.round(MIN_MARGIN * scale) };
}

/**
 * Nearest and second-nearest entry to a query, and where the nearest sits.
 *
 * The inner loop prunes on a partial sum: Hamming distance only grows as words
 * are added, so a candidate already past the current runner-up can be abandoned
 * mid-word. At 20,205 entries and six words that turns a 2.4-billion-popcount
 * pass into one that finishes in seconds, and it changes no answer — the pruned
 * candidates are exactly the ones that could not have become d1 or d2.
 */
function nearestTwo(index, n, words, query, qBase, skip) {
  let d1 = words * 32 + 1;
  let d2 = d1;
  let at = -1;
  for (let j = 0, jb = 0; j < n; j++, jb += words) {
    if (j === skip) continue;
    let d = 0;
    for (let w = 0; w < words; w++) {
      d += popcount(query[qBase + w] ^ index[jb + w]);
      if (d >= d2) break;
    }
    if (d < d1) {
      d2 = d1;
      d1 = d;
      at = j;
    } else if (d < d2) d2 = d;
  }
  return { d1, d2, at };
}

function measure() {
  const planFile = JSON.parse(readFileSync(`${WORK_DIR}/subset.json`, "utf8"));
  const prog = JSON.parse(readFileSync(`${WORK_DIR}/progress.json`, "utf8"));
  const subset = planFile.subset.slice(0, prog.count);
  const fb = readFileSync(`${WORK_DIR}/features.f32`);
  const feats = new Float32Array(fb.buffer, fb.byteOffset, prog.count * FEATURES_PER_CARD);
  const sb = readFileSync(`${WORK_DIR}/shipped.u32`);
  const shipped = new Uint32Array(sb.buffer, sb.byteOffset, prog.count * 2);
  const { cards, words: indexWords, bytes: shippedBytes } = readShippedIndex();

  const usable = subset.map((c, i) => ({ ...c, at: i })).filter((c) => !c.missing);
  const n = usable.length;
  console.log(`Subset: ${subset.length.toLocaleString()} planned, ${n.toLocaleString()} with art`);
  console.log(`  ambiguous in subset: ${usable.filter((c) => c.ambiguous).length.toLocaleString()}`);
  console.log(`  exact ties in subset: ${usable.filter((c) => c.exactTie).length.toLocaleString()}`);

  // -- PARITY ---------------------------------------------------------------
  // Two independent checks, because they fail for different reasons and a single
  // number could not tell them apart.
  console.log("\n=== PARITY ===");
  console.log(`greyscale plane vs phash.ts downscaleGrey: ${prog.planeMismatches} mismatching cards`);

  let phashVsShipped = 0;
  let mineVsPhash = 0;
  const drifted = [];
  for (const c of usable) {
    const s0 = shipped[c.at * 2];
    const s1 = shipped[c.at * 2 + 1];
    if (s0 !== indexWords[c.ordinal * 2] || s1 !== indexWords[c.ordinal * 2 + 1]) {
      phashVsShipped++;
      if (drifted.length < 8) {
        const d = popcount(s0 ^ indexWords[c.ordinal * 2]) + popcount(s1 ^ indexWords[c.ordinal * 2 + 1]);
        drifted.push(`${c.id} (${d} bits)`);
      }
    }
    const mine = bitsGrey64(feats, c.at * FEATURES_PER_CARD);
    if (mine[0] !== s0 || mine[1] !== s1) mineVsPhash++;
  }
  console.log(`this script's grey64 vs phash.ts perceptualHash: ${mineVsPhash} of ${n} differ`);
  console.log(
    `phash.ts recomputed vs shipped index-${planFile.version}.bin: ${phashVsShipped} of ${n} differ`,
  );
  if (drifted.length) console.log(`  e.g. ${drifted.join(", ")}`);
  const parityOk = mineVsPhash === 0 && prog.planeMismatches === 0;
  console.log(parityOk ? "PARITY OK — the harness reproduces the shipped hash." : "PARITY FAILED.");
  if (!parityOk) {
    console.log("Everything below would be measuring this script's bug. Stopping.");
    return;
  }

  // -- chroma spread, which is what grounds DEAD_BAND ------------------------
  const devs = [];
  for (const c of usable) {
    const b = c.at * FEATURES_PER_CARD;
    for (let i = 0; i < 16; i++) {
      devs.push(Math.abs(feats[b + F.cbGrid + i] - 128), Math.abs(feats[b + F.crGrid + i] - 128));
    }
  }
  devs.sort((x, y) => x - y);
  const q = (p) => devs[Math.floor(devs.length * p)].toFixed(1);
  console.log(`\nchroma |v-128| over ${devs.length.toLocaleString()} cells:`);
  console.log(`  p10 ${q(0.1)}   p25 ${q(0.25)}   median ${q(0.5)}   p75 ${q(0.75)}   p90 ${q(0.9)}`);
  console.log(`  DEAD_BAND is ${DEAD_BAND}`);

  // Each card's nearest OTHER card under the SHIPPED hash, as the baseline the
  // `reordered` column compares against. Over the whole index, not the subset,
  // because a variant that moves a card onto a neighbour outside the subset is
  // exactly the case worth spotting.
  const shippedNearest = new Int32Array(cards.length).fill(-1);
  for (let i = 0; i < cards.length; i++) {
    const { at } = nearestTwo(indexWords, cards.length, 2, indexWords, i * 2, i);
    shippedNearest[i] = at;
  }

  // -- who gets a distorted query -------------------------------------------
  // Every ambiguous card, because those are the ones a variant claims to fix and
  // therefore the ones most likely to be fixed WRONGLY, plus a stride sample of
  // the rest as a control. A full distorted pass would be 20,205 queries x three
  // distortions x 20,205 entries x five variants — six billion comparisons for a
  // rate that a 2,000-card control estimates to within a few tenths of a point.
  const CONTROL_SAMPLE = 2000;
  const probes = [];
  const controls = [];
  for (let i = 0; i < n; i++) (usable[i].ambiguous ? probes : controls).push(i);
  const stride = Math.max(1, Math.floor(controls.length / CONTROL_SAMPLE));
  for (let i = 0; i < controls.length; i += stride) probes.push(controls[i]);
  console.log(
    `\ndistorted probes: ${probes.length.toLocaleString()} cards ` +
      `(${(probes.length - Math.ceil(controls.length / stride)).toLocaleString()} ambiguous + ` +
      `${Math.ceil(controls.length / stride).toLocaleString()} control) x ${RENDERS.length - 1} distortions`,
  );

  // -- per-variant: gather the raw distances, judge later --------------------
  //
  // Nothing here applies a threshold. Each variant produces two arrays — the
  // nearest OTHER card for every card (crowding) and (d1, d2, correct) for every
  // distorted probe — and the gate is swept over those afterwards.
  //
  // That ordering is not tidiness. The proportional gate is not a neutral
  // yardstick: a variant that APPENDS bits can only increase distances, so
  // scaling MIN_MARGIN from 8 to 16 alongside it demands the new bits contribute
  // 8 bits of separation before the variant merely breaks even. Measured on a
  // 3,060-card partial run, that alone made variant (c) look like it BROKE 147
  // previously-matched cards while resolving 75 — an artifact of the yardstick,
  // not of the hash. Sweeping recovers the honest comparison: hold false accepts
  // at zero, then ask which variant accepts the most.
  const collected = [];
  for (const variant of VARIANTS) {
    const words = variant.bits / 32;
    const index = new Uint32Array(n * words);
    for (let i = 0; i < n; i++) index.set(variant.of(feats, usable[i].at * FEATURES_PER_CARD), i * words);

    // (1) Perfect-capture crowding, the same question measure-index-crowding
    // asks: how far is the nearest OTHER card?
    const nearest = new Int32Array(n);
    const nearestAt = new Int32Array(n).fill(-1);
    let reordered = 0;
    for (let i = 0; i < n; i++) {
      const { d1, at } = nearestTwo(index, n, words, index, i * words, i);
      nearest[i] = d1;
      nearestAt[i] = at;
      // Did the variant hand this card a DIFFERENT nearest neighbour than the
      // shipped hash did? A variant that only stretches the existing distances
      // scores near zero here; one that genuinely re-describes the artwork does
      // not. It separates "more bits, same picture" from "more picture".
      if (at >= 0 && usable[at].ordinal !== shippedNearest[usable[i].ordinal]) reordered++;
    }

    // (2) Distorted queries — the ONLY place a false accept can happen. A card
    // queried with its own hash sits at distance 0 and always ranks first, so a
    // perfect-capture measurement structurally cannot fail any variant on the
    // axis that matters. Here the query is a distorted render and the index is
    // built from clean ones, exactly as the scanner works.
    // The clean render is probed too, at render 0. It is EXCLUDED from every
    // pooled figure — a clean re-hash flatters everything, as
    // validate-recognition.mjs notes — and kept only as a calibration row: it
    // must reproduce measure-index-crowding.mjs's 91.4% for the control, and if
    // it does not, this harness disagrees with the one already trusted.
    const probeD1 = new Int32Array(probes.length * RENDERS.length);
    const probeD2 = new Int32Array(probeD1.length);
    const probeOk = new Uint8Array(probeD1.length);
    const probeRender = new Uint8Array(probeD1.length);
    let at = 0;
    for (let r = 0; r < RENDERS.length; r++) {
      for (const i of probes) {
        const q2 = variant.of(feats, usable[i].at * FEATURES_PER_CARD + r * FEATURES_PER_RENDER);
        const hit = nearestTwo(index, n, words, q2, 0, -1);
        probeD1[at] = hit.d1;
        probeD2[at] = hit.d2;
        probeOk[at] = hit.at === i ? 1 : 0;
        probeRender[at] = r;
        at++;
      }
    }
    collected.push({ variant, nearest, nearestAt, probeD1, probeD2, probeOk, probeRender, reordered });
  }

  /** Crowding outcome for one variant at one margin. */
  function crowdingAt(c, minMargin) {
    let resolved = 0;
    let tiesResolved = 0;
    let tiesTotal = 0;
    let broke = 0;
    let controlTotal = 0;
    let ambiguousTotal = 0;
    for (let i = 0; i < n; i++) {
      const ok = c.nearest[i] >= minMargin;
      if (usable[i].ambiguous) {
        ambiguousTotal++;
        if (ok) resolved++;
        if (usable[i].exactTie) {
          tiesTotal++;
          if (ok) tiesResolved++;
        }
      } else {
        controlTotal++;
        if (!ok) broke++;
      }
    }
    return { resolved, ambiguousTotal, tiesResolved, tiesTotal, broke, controlTotal };
  }

  /** Distorted-query outcome for one variant at one gate. */
  function distortAt(c, maxDistance, minMargin) {
    let accepted = 0;
    let wrong = 0;
    let trials = 0;
    for (let i = 0; i < c.probeD1.length; i++) {
      if (c.probeRender[i] === 0) continue; // clean is calibration, not evidence
      trials++;
      if (c.probeD1[i] <= maxDistance && c.probeD2[i] - c.probeD1[i] >= minMargin) {
        if (c.probeOk[i]) accepted++;
        else wrong++;
      }
    }
    return { accepted, wrong, trials, asked: trials - accepted - wrong };
  }

  // -- headline table, at the proportional gate ------------------------------
  console.log("\n=== VARIANTS at the proportionally scaled gate ===");
  console.log("gate = MAX_DISTANCE 16 / MIN_MARGIN 8 scaled by bits/64.");
  console.table(
    collected.map((c) => {
      const gate = gateFor(c.variant.bits);
      const cr = crowdingAt(c, gate.minMargin);
      const di = distortAt(c, gate.maxDistance, gate.minMargin);
      return {
        variant: `${c.variant.key}. ${c.variant.name}`,
        bits: c.variant.bits,
        gate: `${gate.maxDistance}/${gate.minMargin}`,
        resolved: `${cr.resolved}/${cr.ambiguousTotal}`,
        ties: `${cr.tiesResolved}/${cr.tiesTotal}`,
        brokeMatched: `${cr.broke}/${cr.controlTotal}`,
        distortAccept: `${((di.accepted / di.trials) * 100).toFixed(1)}%`,
        distortWRONG: di.wrong,
        indexBytes: (cards.length * c.variant.bits) / 8,
        reordered: c.reordered,
      };
    }),
  );

  // -- the honest comparison: equal safety, then compare -------------------
  //
  // phash.ts chose 16/8 by sweeping and taking the loosest pair that leaked no
  // false accepts. Same rule here, per variant: sweep, keep only the pairs with
  // ZERO false accepts, and report the one that accepts the most. A variant that
  // cannot reach zero at any setting is disqualified outright — CLAUDE.md is
  // explicit that a false accept silently files the wrong card and nobody ever
  // notices, so it is a constraint, not a term in a score.
  const MARGINS = [4, 6, 8, 10, 12, 14, 16, 20, 24, 28, 32, 40, 48];
  const DISTANCES = [8, 12, 16, 20, 24, 32, 40, 48, 64];
  console.log("\n=== VARIANTS at each one's own zero-false-accept optimum ===");
  const best = [];
  for (const c of collected) {
    let pick = null;
    for (const maxD of DISTANCES) {
      if (maxD > c.variant.bits / 2) continue;
      for (const minM of MARGINS) {
        if (minM > c.variant.bits / 4) continue;
        const di = distortAt(c, maxD, minM);
        if (di.wrong > 0) continue;
        if (!pick || di.accepted > pick.di.accepted) pick = { maxD, minM, di };
      }
    }
    if (!pick) {
      best.push({ variant: `${c.variant.key}. ${c.variant.name}`, gate: "NONE — leaks at every setting" });
      continue;
    }
    const cr = crowdingAt(c, pick.minM);
    // How sharp is the cliff? One margin step looser is the setting a reader
    // would reach for to buy more auto-accept; if it leaks badly, the chosen
    // point is a knife edge and the argmax above is fitted to this sample's
    // noise rather than to a property of the hash.
    const looser = MARGINS[MARGINS.indexOf(pick.minM) - 1];
    const oneStepLooser =
      looser === undefined
        ? "n/a"
        : (() => {
            const di = distortAt(c, pick.maxD, looser);
            return `${looser}: +${((di.accepted / di.trials) * 100 - (pick.di.accepted / pick.di.trials) * 100).toFixed(1)}pt, ${di.wrong} wrong`;
          })();
    best.push({
      variant: `${c.variant.key}. ${c.variant.name}`,
      bits: c.variant.bits,
      gate: `${pick.maxD}/${pick.minM}`,
      resolved: `${cr.resolved}/${cr.ambiguousTotal}`,
      ties: `${cr.tiesResolved}/${cr.tiesTotal}`,
      brokeMatched: `${cr.broke}/${cr.controlTotal}`,
      ambiguousNow: `${((1 - (cr.resolved + cr.controlTotal - cr.broke) / n) * 100).toFixed(1)}%`,
      distortAccept: `${((pick.di.accepted / pick.di.trials) * 100).toFixed(1)}%`,
      distortWRONG: pick.di.wrong,
      oneStepLooser,
      indexBytes: (cards.length * c.variant.bits) / 8,
    });
  }
  console.table(best);

  // -- where the control leaks, and how badly ------------------------------
  // The shipped 16/8 pair was measured at 1,709 cards and reported 0% false
  // accepts. Whether it still holds at 20,205 is worth knowing on its own.
  console.log("\n=== The shipped gate (16/8) per render, control hash ===");
  console.log("clean is the calibration row: it should reproduce measure-index-crowding.mjs.");
  const control = collected[0];
  const perRender = [];
  for (let r = 0; r < RENDERS.length; r++) {
    let accepted = 0;
    let wrong = 0;
    let trials = 0;
    const examples = [];
    for (let i = 0; i < control.probeD1.length; i++) {
      if (control.probeRender[i] !== r) continue;
      trials++;
      if (control.probeD1[i] <= MAX_DISTANCE && control.probeD2[i] - control.probeD1[i] >= MIN_MARGIN) {
        if (control.probeOk[i]) accepted++;
        else {
          wrong++;
          const q = usable[probes[i % probes.length]];
          if (examples.length < 3) examples.push(q.id);
        }
      }
    }
    perRender.push({
      render: RENDERS[r],
      accepted: `${((accepted / trials) * 100).toFixed(1)}%`,
      WRONG: wrong,
      examples: examples.join(", "),
    });
  }
  console.table(perRender);

  // -- white balance, the distortion this battery does NOT contain -----------
  //
  // The six distortions inherited from validate-recognition.mjs all leave colour
  // roughly alone: glare is white, dim is neutral, the rest are geometric. So the
  // whole chroma case above is measured under a camera that never gets the white
  // point wrong, which no real camera manages. A tungsten room or an LED desk
  // lamp shifts Cb and Cr bodily, and the chroma variants are 50-67% chroma bits.
  //
  // That is simulated here on the STORED features rather than by re-fetching
  // twenty thousand images, because an illuminant shift is to first order an
  // additive offset on Cb and Cr. Two consequences fall straight out of the
  // arithmetic and are then confirmed numerically:
  //
  //  - the 4x4 grid thresholds against ABSOLUTE neutral, so an offset walks every
  //    cell across its thresholds at once. Fragile by construction.
  //  - the chroma DCT puts a constant offset entirely into the DC coefficient,
  //    which bitsChromaDct128 already excludes. Invariant by construction.
  //
  // The measurement is how many bits move, averaged over the catalog. A variant
  // whose hash moves further under a tint than a real reprint sits away is not a
  // variant, it is a new failure mode.
  console.log("\n=== White-balance sensitivity: bits flipped by a chroma-only tint ===");
  const wbRows = [];
  for (const c of collected) {
    const row = { variant: `${c.variant.key}. ${c.variant.name}`, bits: c.variant.bits };
    for (const delta of [-8, -4, 4, 8]) {
      let flipped = 0;
      // A stride sample: bit-flip counts are extremely low variance and the full
      // catalog would cost five more passes over 98MB of floats for no precision.
      let seen = 0;
      for (let i = 0; i < n; i += 20) {
        const base = usable[i].at * FEATURES_PER_CARD;
        const plain = c.variant.of(feats, base);
        const tinted = c.variant.of(tintChroma(feats, base, delta), 0);
        for (let w = 0; w < plain.length; w++) flipped += popcount(plain[w] ^ tinted[w]);
        seen++;
      }
      row[`${delta > 0 ? "+" : ""}${delta}`] = (flipped / seen).toFixed(2);
    }
    wbRows.push(row);
  }
  console.table(wbRows);
  console.log("Mean bits flipped by a global Cb/Cr shift. Compare against each variant's own margin:");
  for (const c of collected) {
    console.log(`  ${c.variant.key}: minMargin ${gateFor(c.variant.bits).minMargin}`);
  }

  // -- what survives, and is it OCR-able? -----------------------------------
  //
  // The point of a better hash was to shrink OCR's target. Whether that helps
  // depends on WHAT is left, not just how much. A collector number separates two
  // cards only when they are different printings of the same card — the reprint
  // case. Two genuinely different cards that happen to hash alike would not be
  // separated by a number either, and would need something else entirely.
  //
  // So each surviving pair is classified by whether the two cards share a name.
  console.log("\n=== What stays ambiguous, and whether a collector number would settle it ===");
  const survivors = [];
  for (const c of collected) {
    const gate = gateFor(c.variant.bits);
    let sameName = 0;
    let sameNameSameNumber = 0;
    let differentName = 0;
    for (let i = 0; i < n; i++) {
      if (c.nearest[i] >= gate.minMargin || c.nearestAt[i] < 0) continue;
      const a = usable[i];
      const b = usable[c.nearestAt[i]];
      if (a.name !== b.name) differentName++;
      else if (a.number === b.number && a.setId !== b.setId) sameNameSameNumber++;
      else sameName++;
    }
    survivors.push({
      variant: `${c.variant.key}. ${c.variant.name}`,
      gate: `${gate.maxDistance}/${gate.minMargin}`,
      total: sameName + sameNameSameNumber + differentName,
      "same name, different number": sameName,
      "same name AND same number": sameNameSameNumber,
      "different name": differentName,
    });
  }
  console.table(survivors);
  console.log("same name, different number — a collector number settles it. This is OCR's target.");
  console.log("same name AND same number — the number does NOT settle it; the set total might.");
  console.log("different name — neither the number nor the name is the problem; the hash is.");

  console.log(
    `\nShipped index today: ${shippedBytes.toLocaleString()} bytes for ${cards.length.toLocaleString()} cards.`,
  );
  console.log(
    "resolved: of the cards AMBIGUOUS under the shipped 64-bit hash, how many now clear the margin.",
  );
  console.log("ties: of those, the exact (0-bit) ties.");
  console.log("brokeMatched: cards MATCHED at 64 bits that the variant makes ambiguous.");
  console.log("ambiguousNow: the whole-catalog ambiguity rate under the variant — 8.6% is today's.");
  console.log(`distortAccept / distortWRONG: ${probes.length} probes x ${RENDERS.length - 1} distortions.`);
}

// ---------------------------------------------------------------------------
// STAGE 4 — bench: what does each variant cost per frame?
// ---------------------------------------------------------------------------

async function bench() {
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

  // Timed on synthetic noise at the real capture size, so the cost measured is
  // the arithmetic and not an image decode the scanner has already paid for.
  const result = await page.evaluate(() => {
    const W = 245;
    const H = 342;
    const data = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = (i * 37) % 256;
      data[i + 1] = (i * 91) % 256;
      data[i + 2] = (i * 17) % 256;
      data[i + 3] = 255;
    }
    const rect = window.PHash.artRect(W, H);
    const img = { data, width: W, height: H };
    const N = 300;

    function time(fn) {
      fn();
      const t0 = performance.now();
      for (let i = 0; i < N; i++) fn();
      return (performance.now() - t0) / N;
    }

    return {
      shipped64: time(() => window.PHash.perceptualHash(data, W, H, rect)),
      // The full three-plane extraction: one downscale over Y/Cb/Cr, a 12x12
      // luma DCT and two 8x8 chroma DCTs. Every variant here is a subset of it,
      // so this is the ceiling on what any of them costs.
      allPlanesAndDcts: time(() => window.HX.features(img, rect)),
      downscale3: time(() => window.HX.downscalePlanes(data, W, H, rect)),
    };
  });
  await browser.close();

  console.log("Per-frame hash cost (ms, mean of 300 on synthetic 245x342):");
  for (const [k, v] of Object.entries(result)) console.log(`  ${k.padEnd(20)} ${v.toFixed(3)} ms`);
}

if (MODE === "plan") await plan();
else if (MODE === "fetch") await fetchStage();
else if (MODE === "measure") measure();
else if (MODE === "bench") await bench();
else throw new Error(`unknown mode ${MODE} — use plan | fetch | measure | bench`);
