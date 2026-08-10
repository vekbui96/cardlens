/**
 * What does growing the index cost?
 *
 * `validate-recognition.mjs` builds its own index from the sets it was given, so
 * it measures the HASH under distortion and is blind to the one thing that
 * changes when the catalog goes from 1,709 cards to 20,205: how crowded the
 * space is. Twelve times the cards means twelve times the chances that some
 * unrelated printing sits close enough to the one in front of the camera to
 * spoil its margin.
 *
 * This reads the shipped index and feeds every card its own hash — a perfect
 * capture, no camera, no lighting. That makes every number here a CEILING, not
 * a forecast. What it isolates is exactly the crowding: a card that cannot be
 * told from its neighbours on a flawless capture will never be told from them
 * on a real one.
 *
 *   node scripts/measure-index-crowding.mjs
 */

import { readFileSync } from "node:fs";
import { MAX_DISTANCE, MIN_MARGIN } from "../src/scan/phash.ts";

const OUT_DIR = "public/card-index";
const latest = JSON.parse(readFileSync(`${OUT_DIR}/latest.json`, "utf8"));
const cards = JSON.parse(readFileSync(`${OUT_DIR}/cards-${latest.version}.json`, "utf8"));
const bin = readFileSync(`${OUT_DIR}/index-${latest.version}.bin`);
const words = new Uint32Array(bin.buffer, bin.byteOffset, bin.byteLength / 4);

if (words.length !== cards.length * 2) {
  throw new Error(`${words.length / 2} hashes but ${cards.length} cards — the index is inconsistent`);
}
console.log(`${cards.length.toLocaleString()} cards, version ${latest.version}\n`);

function popcount(v) {
  v = v - ((v >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

const n = cards.length;
let matched = 0;
let ambiguous = 0;
let wrong = 0;
let exactTies = 0;
const worst = [];

for (let i = 0; i < n; i++) {
  const a0 = words[i * 2];
  const a1 = words[i * 2 + 1];

  // Nearest and second-nearest OTHER card. The card itself is always at 0, so
  // what decides its fate is the gap to whatever is next.
  let best = 65;
  let second = 65;
  let bestAt = -1;
  for (let j = 0; j < n; j++) {
    if (j === i) continue;
    const d = popcount(a0 ^ words[j * 2]) + popcount(a1 ^ words[j * 2 + 1]);
    if (d < best) {
      second = best;
      best = d;
      bestAt = j;
    } else if (d < second) {
      second = d;
    }
  }

  if (best === 0) exactTies++;
  // The capture is the card itself, so distance 0 and the runner-up is `best`.
  const confident = 0 <= MAX_DISTANCE && best >= MIN_MARGIN;
  if (confident) matched++;
  else ambiguous++;
  // A misfile would mean something ranked ABOVE an exact self-match, which the
  // hash makes impossible — counted anyway, because an assumption worth
  // relying on is worth asserting.
  if (best < 0) wrong++;

  if (best < MIN_MARGIN)
    worst.push({ id: cards[i].id, name: cards[i].name, to: cards[bestAt]?.id, bits: best });
}

const pct = (x) => ((x / n) * 100).toFixed(1);
console.log(`MATCHED    ${matched.toLocaleString().padStart(7)}  ${pct(matched)}%`);
console.log(
  `AMBIGUOUS  ${ambiguous.toLocaleString().padStart(7)}  ${pct(ambiguous)}%   ← needs a human or OCR`,
);
console.log(`WRONG      ${wrong.toLocaleString().padStart(7)}  ${pct(wrong)}%`);
console.log(`\nexact ties (distance 0 to another card): ${exactTies.toLocaleString()}`);

console.log(`\nGate: maxDistance ${MAX_DISTANCE}, minMargin ${MIN_MARGIN}`);
console.log("\nA sample of what cannot be separated:");
for (const w of worst.slice(0, 12)) {
  console.log(`  ${w.id.padEnd(14)} ${String(w.name).slice(0, 22).padEnd(24)} ${w.bits} bits from ${w.to}`);
}
