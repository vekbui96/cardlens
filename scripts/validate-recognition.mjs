/**
 * Does artwork hashing actually recognise cards?
 *
 * This is the measurement the whole scanner design rests on, and it is worth
 * running before any UI exists: if artwork hashing does not identify a card
 * from a phone-quality capture, the pipeline needs an entirely different core
 * and everything built on top would have to be thrown away.
 *
 * It runs in real Chromium (via the Playwright already in devDependencies)
 * rather than in Node, because the browser's image decode and canvas are the
 * code path that will actually run. Images are fetched in Node and handed to
 * the page as data URLs: a cross-origin image drawn to a canvas taints it and
 * getImageData throws, and that is a wall, not a warning.
 *
 *   node scripts/validate-recognition.mjs [setId...]
 */
import { build } from "esbuild";
import { chromium } from "@playwright/test";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);

const SETS = process.argv.slice(2).length ? process.argv.slice(2) : ["me5", "me3", "me2"];
/**
 * NordVPN on this laptop blocks Tailscale, so ts.net resolves to an
 * unreachable tailnet IP. curl's --resolve fixes that; Node's fetch has no
 * equivalent, and setting a Host header does NOT set the TLS SNI, so the
 * funnel drops the connection before the handshake finishes.
 */
const FUNNEL_IP = "199.38.181.54";
const HOST = "server-pc.tail0e4194.ts.net:8443";

async function getJson(path) {
  const { stdout } = await execFile(
    "curl",
    ["-s", "-m", "90", "--resolve", `${HOST}:${FUNNEL_IP}`, `https://${HOST}/api${path}`],
    { maxBuffer: 256 * 1024 * 1024 },
  );
  return JSON.parse(stdout);
}

async function fetchDataUrl(url) {
  const res = await fetch(url);
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  const type = res.headers.get("content-type") ?? "image/jpeg";
  return `data:${type};base64,${buf.toString("base64")}`;
}

/** Modest concurrency: this is someone else's CDN. */
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

console.log(`Collecting cards from ${SETS.join(", ")} …`);
const cards = [];
for (const setId of SETS) {
  const info = await getJson(`/set-information/${setId}`);
  for (const c of info?.cards?.data ?? []) {
    const url = c.images?.small ?? c.images?.large;
    if (url) cards.push({ id: c.id, name: c.name, setId, url });
  }
}
console.log(`  ${cards.length} cards with art`);

console.log("Downloading art …");
const withArt = (await mapLimit(cards, 8, async (c) => ({ ...c, data: await fetchDataUrl(c.url) }))).filter(
  (c) => c.data,
);
console.log(`  ${withArt.length} downloaded`);

const bundle = await build({
  entryPoints: ["src/scan/phash.ts"],
  bundle: true,
  format: "iife",
  globalName: "PHash",
  write: false,
  target: "es2022",
});
const phashSource = bundle.outputFiles[0].text;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.addScriptTag({ content: phashSource });

const result = await page.evaluate(async (cards) => {
  const { perceptualHash, artRect, search, judge } = window.PHash;

  async function bitmap(dataUrl) {
    const res = await fetch(dataUrl);
    return createImageBitmap(await res.blob());
  }

  /** Draw a bitmap at a size, returning ImageData. */
  function render(bmp, w, h, paint) {
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0, w, h);
    if (paint) paint(ctx, w, h);
    return ctx.getImageData(0, 0, w, h);
  }

  // --- Build the index, exactly as the nightly job would ------------------
  const index = new Uint32Array(cards.length * 2);
  const bitmaps = [];
  for (let i = 0; i < cards.length; i++) {
    const bmp = await bitmap(cards[i].data);
    bitmaps.push(bmp);
    const img = render(bmp, 245, 342);
    const h = perceptualHash(img.data, 245, 342, artRect(245, 342));
    index[i * 2] = h[0];
    index[i * 2 + 1] = h[1];
  }

  /**
   * A capture, as a phone would produce it. Each distortion is something the
   * real pipeline genuinely does to the image before it reaches the hash.
   */
  const SCANS = {
    clean: (bmp) => render(bmp, 245, 342),

    // Camera resolution then the perspective warp's resampling.
    resampled: (bmp) => {
      const mid = new OffscreenCanvas(480, 670);
      mid.getContext("2d").drawImage(bmp, 0, 0, 480, 670);
      return render(mid, 245, 342);
    },

    // The quad detector is never exact. This is the single most important
    // distortion in the list: the art window is computed from detected bounds,
    // so a 3% error moves the whole window.
    cropError: (bmp) => {
      const canvas = new OffscreenCanvas(245, 342);
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      const dx = 245 * 0.03,
        dy = 342 * 0.03;
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
      const dx = 480 * 0.025,
        dy = 670 * 0.025;
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

  const report = {};
  for (const [name, distort] of Object.entries(SCANS)) {
    let top1 = 0,
      top3 = 0,
      confidentRight = 0,
      confidentWrong = 0,
      unsure = 0,
      distSum = 0;

    for (let i = 0; i < bitmaps.length; i++) {
      const img = distort(bitmaps[i]);
      const hash = perceptualHash(img.data, 245, 342, artRect(245, 342));
      const hits = search(index, hash, 3);
      const verdict = judge(hits);

      if (hits[0]?.ordinal === i) top1++;
      if (hits.some((h) => h.ordinal === i)) top3++;
      distSum += hits[0]?.distance ?? 64;
      if (verdict.confident) {
        if (verdict.match.ordinal === i) confidentRight++;
        else confidentWrong++;
      } else unsure++;
    }

    const n = bitmaps.length;
    report[name] = {
      top1: +((top1 / n) * 100).toFixed(1),
      top3: +((top3 / n) * 100).toFixed(1),
      meanDistance: +(distSum / n).toFixed(2),
      autoAccepted: +((confidentRight / n) * 100).toFixed(1),
      falseAccept: +((confidentWrong / n) * 100).toFixed(1),
      askedUser: +((unsure / n) * 100).toFixed(1),
    };
  }

  /**
   * Threshold sweep.
   *
   * MAX_DISTANCE and MIN_MARGIN decide how often the user is interrupted, and
   * guessing them is how a scanner ends up either asking about everything or
   * quietly filing the wrong card. Auto-accept rate is the UX; false accept is
   * the one that corrupts a collection, so it is the constraint, not the goal.
   */
  const sweep = [];
  for (const maxD of [10, 14, 16, 18, 20, 24]) {
    for (const minM of [4, 6, 8, 10]) {
      let accepted = 0,
        wrong = 0,
        asked = 0,
        n = 0;
      for (const [name, distort] of Object.entries(SCANS)) {
        if (name === "clean") continue; // a clean re-hash flatters everything
        for (let i = 0; i < bitmaps.length; i++) {
          const img = distort(bitmaps[i]);
          const hits = search(index, perceptualHash(img.data, 245, 342, artRect(245, 342)), 3);
          n++;
          const d1 = hits[0]?.distance ?? 64;
          const margin = hits[1] ? hits[1].distance - d1 : 64;
          if (d1 <= maxD && margin >= minM) {
            if (hits[0].ordinal === i) accepted++;
            else wrong++;
          } else asked++;
        }
      }
      sweep.push({
        maxDistance: maxD,
        minMargin: minM,
        autoAccepted: +((accepted / n) * 100).toFixed(1),
        falseAccept: +((wrong / n) * 100).toFixed(1),
        askedUser: +((asked / n) * 100).toFixed(1),
      });
    }
  }

  // Impostor distances: every card against every OTHER card. This is what
  // decides whether the thresholds survive an index of 20,460 rather than the
  // few hundred measured here.
  let impostorMin = 64;
  const buckets = new Array(65).fill(0);
  for (let i = 0; i < cards.length; i++) {
    for (let j = i + 1; j < cards.length; j++) {
      const d =
        ((x) => x)(0) +
        (function () {
          let a = index[i * 2] ^ index[j * 2];
          let b = index[i * 2 + 1] ^ index[j * 2 + 1];
          const pc = (n) => {
            n = n - ((n >>> 1) & 0x55555555);
            n = (n & 0x33333333) + ((n >>> 2) & 0x33333333);
            n = (n + (n >>> 4)) & 0x0f0f0f0f;
            return (n * 0x01010101) >>> 24;
          };
          return pc(a) + pc(b);
        })();
      buckets[d]++;
      if (d < impostorMin) impostorMin = d;
    }
  }

  return { report, sweep, impostorMin, buckets, pairs: (cards.length * (cards.length - 1)) / 2 };
}, withArt);

await browser.close();

console.log(`\nIndex: ${withArt.length} cards from ${SETS.join(", ")}\n`);
console.table(result.report);

console.log("\nThreshold sweep (all distorted scans pooled):");
console.table(result.sweep);

const under = (t) => result.buckets.slice(0, t + 1).reduce((a, b) => a + b, 0);
console.log(`\nImpostor pairs: ${result.pairs.toLocaleString()}`);
console.log(`  closest unrelated pair: ${result.impostorMin} bits`);
console.log(`  pairs within MAX_DISTANCE(10): ${under(10)}`);
console.log(`  pairs within 16 bits:          ${under(16)}`);
