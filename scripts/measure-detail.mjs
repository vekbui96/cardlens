/**
 * How much detail separates a card from the surface under it?
 *
 * Auto-capture needs to know whether anything is in the guide before it fires,
 * and the perceptual hash cannot tell it: the hash compares a region against its
 * own median, so a bare desk hashes to something as confident-looking as a
 * Charizard. This measures the one signal that does distinguish them —
 * greyscale standard deviation over the art window — on real card art against
 * synthetic stand-ins for an empty frame, and prints the gap so a threshold can
 * be chosen from data rather than taste.
 *
 * The negatives are SYNTHETIC, and that is the limitation to remember: a real
 * desk under real lighting is not a gradient with noise on it. They are built to
 * be generous to the negative case (a busy woodgrain, a shadowed mat) so the
 * threshold errs toward "there is a card here" rather than toward refusing to
 * scan. A missed capture is a button press; a false one is a junk row.
 *
 *   node scripts/measure-detail.mjs [setId ...]
 */

import { build } from "esbuild";
import { chromium } from "playwright";

const SETS = process.argv.slice(2).length ? process.argv.slice(2) : ["me5", "sv8pt5", "rsv10pt5"];
const PER_SET = Number(process.env.PER_SET ?? 15);
const UA = "cardlens-detail-measure/1.0";

async function fetchDataUrl(url) {
  const res = await fetch(url, { headers: { "user-agent": UA } });
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  return `data:${res.headers.get("content-type") ?? "image/png"};base64,${buf.toString("base64")}`;
}

console.log(`Collecting art from ${SETS.join(", ")} …`);
const cards = [];
for (const setId of SETS) {
  const res = await fetch(`https://api.pokemontcg.io/v2/cards?q=set.id:${setId}&pageSize=${PER_SET}`, {
    headers: { "user-agent": UA },
  });
  if (!res.ok) {
    console.log(`  ${setId}: HTTP ${res.status}, skipped`);
    continue;
  }
  const body = await res.json();
  for (const c of body.data ?? []) {
    const url = c.images?.small ?? c.images?.large;
    if (url) cards.push({ id: c.id, url });
  }
  console.log(`  ${setId}: ${body.data?.length ?? 0}`);
}

const withArt = [];
for (const c of cards) {
  const data = await fetchDataUrl(c.url);
  if (data) withArt.push({ ...c, data });
}
console.log(`${withArt.length} images downloaded\n`);

const bundle = await build({
  entryPoints: ["src/scan/phash.ts"],
  bundle: true,
  format: "iife",
  globalName: "PHash",
  write: false,
  target: "es2022",
});

const browser = await chromium.launch();
const page = await browser.newPage();
await page.addScriptTag({ content: bundle.outputFiles[0].text });

const result = await page.evaluate(async (cards) => {
  const { detail, artRect } = window.PHash;
  const W = 245;
  const H = 342;

  function imageData(paint) {
    const canvas = new OffscreenCanvas(W, H);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    paint(ctx);
    return ctx.getImageData(0, 0, W, H);
  }

  /** Sensor noise, the floor every negative sits on. */
  function noise(ctx, amount) {
    const frame = ctx.getImageData(0, 0, W, H);
    for (let i = 0; i < frame.data.length; i += 4) {
      const n = (Math.random() - 0.5) * amount;
      frame.data[i] += n;
      frame.data[i + 1] += n;
      frame.data[i + 2] += n;
    }
    ctx.putImageData(frame, 0, 0);
  }

  const negatives = {
    "flat mat": (ctx) => {
      ctx.fillStyle = "#3a3a3c";
      ctx.fillRect(0, 0, W, H);
      noise(ctx, 6);
    },
    "lit desk (gradient)": (ctx) => {
      const g = ctx.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, "#9a9088");
      g.addColorStop(1, "#4a443e");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      noise(ctx, 8);
    },
    woodgrain: (ctx) => {
      ctx.fillStyle = "#6b4f32";
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = "rgba(40,26,14,0.55)";
      for (let x = 0; x < W; x += 5) {
        ctx.lineWidth = 1 + Math.random() * 2;
        ctx.beginPath();
        ctx.moveTo(x + Math.random() * 3, 0);
        ctx.lineTo(x + Math.random() * 3, H);
        ctx.stroke();
      }
      noise(ctx, 10);
    },
    "hand over the guide": (ctx) => {
      ctx.fillStyle = "#c8a288";
      ctx.fillRect(0, 0, W, H);
      const g = ctx.createRadialGradient(W / 2, H / 2, 10, W / 2, H / 2, W);
      g.addColorStop(0, "rgba(255,255,255,0.25)");
      g.addColorStop(1, "rgba(0,0,0,0.35)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      noise(ctx, 8);
    },
  };

  const rect = artRect(W, H);
  const out = { cards: [], negatives: {} };

  for (const [name, paint] of Object.entries(negatives)) {
    const frame = imageData(paint);
    out.negatives[name] = detail(frame.data, W, H, rect);
  }

  for (const c of cards) {
    const res = await fetch(c.data);
    const bmp = await createImageBitmap(await res.blob());
    const frame = imageData((ctx) => ctx.drawImage(bmp, 0, 0, W, H));
    out.cards.push({ id: c.id, detail: detail(frame.data, W, H, rect) });
  }
  return out;
}, withArt);

await browser.close();

const values = result.cards.map((c) => c.detail).sort((a, b) => a - b);
const at = (p) => values[Math.min(values.length - 1, Math.floor(p * values.length))];
const f = (n) => n.toFixed(1);

console.log("Card art, greyscale sd over the art window");
console.log(`  n          ${values.length}`);
console.log(`  min        ${f(values[0])}   ← ${result.cards.find((c) => c.detail === values[0]).id}`);
console.log(`  p5         ${f(at(0.05))}`);
console.log(`  median     ${f(at(0.5))}`);
console.log(`  max        ${f(values[values.length - 1])}`);

console.log("\nNegatives (synthetic)");
for (const [name, v] of Object.entries(result.negatives)) console.log(`  ${name.padEnd(22)} ${f(v)}`);

const worstNegative = Math.max(...Object.values(result.negatives));
console.log(`\nGap: quietest card ${f(values[0])} vs busiest negative ${f(worstNegative)}`);
console.log(`Midpoint threshold: ${f((values[0] + worstNegative) / 2)}`);
