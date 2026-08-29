/**
 * Perceptual hashing for card recognition.
 *
 * The whole recognition strategy rests on one measurement: there are 20,460
 * cards in the English catalog (174 sets, measured from /api/catalog/sets). A
 * 64-bit hash each is 164KB — the entire index fits in a file smaller than one
 * card image, and matching is a Hamming distance over 20,460 integers, which is
 * sub-millisecond in plain JS. No wasm, no threads, no network, no model.
 *
 * That matters more here than it would elsewhere: the app is served from GitHub
 * Pages, which cannot set COOP/COEP headers, so there is no SharedArrayBuffer
 * and no wasm threading. OpenCV and Tesseract both run single-threaded. This
 * file is the one part of the pipeline the host cannot slow down.
 *
 * Everything here is PURE and takes raw RGBA. No canvas, no Image, no fetch —
 * because the index builder and the scanner must run byte-identical
 * preprocessing or accuracy quietly halves, and the only way to guarantee that
 * is to have one implementation both can call.
 */

/** Bits in a hash. Two uint32s rather than a BigInt: popcount is much faster. */
export const HASH_BITS = 64;
/** Working size before the DCT. 32 is the standard pHash choice. */
const SIZE = 32;
/** Low-frequency block kept from the DCT. 8x8 minus DC = 63 usable, padded to 64. */
const BLOCK = 8;

/**
 * Where the artwork sits on a card, as fractions of the card.
 *
 * Not the whole card, because the bottom third is rules text in a small font
 * that survives neither downscaling nor a phone camera, and the very edge is
 * where the card boundary detection is least accurate. Not just the art box
 * either: full-art and illustration-rare cards paint over it entirely, and
 * including a little of the frame is what keeps those distinguishable.
 */
export const ART_WINDOW = { x: 0.06, y: 0.08, w: 0.88, h: 0.62 } as const;

/** Cosine table: COS[u * SIZE + x] = cos((2x+1)·u·π / 2·SIZE). */
const COS = (() => {
  const table = new Float64Array(BLOCK * SIZE);
  for (let u = 0; u < BLOCK; u++) {
    for (let x = 0; x < SIZE; x++) {
      table[u * SIZE + x] = Math.cos(((2 * x + 1) * u * Math.PI) / (2 * SIZE));
    }
  }
  return table;
})();

const ALPHA = (() => {
  const a = new Float64Array(BLOCK);
  a[0] = Math.SQRT1_2;
  for (let u = 1; u < BLOCK; u++) a[u] = 1;
  return a;
})();

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The art window of a w×h card, in pixels. */
export function artRect(width: number, height: number): Rect {
  return {
    x: Math.round(width * ART_WINDOW.x),
    y: Math.round(height * ART_WINDOW.y),
    w: Math.round(width * ART_WINDOW.w),
    h: Math.round(height * ART_WINDOW.h),
  };
}

/**
 * Average a rectangle of RGBA down to SIZE×SIZE greyscale.
 *
 * A box filter, written out rather than delegated to canvas `drawImage`,
 * because the browser's resampling is not specified and differs between
 * engines — and any difference between how the index was built and how a scan
 * is processed shows up as lost accuracy that is very hard to attribute later.
 */
export function downscaleGrey(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  rect: Rect = { x: 0, y: 0, w: width, h: height },
): Float64Array {
  const out = new Float64Array(SIZE * SIZE);
  const cellW = rect.w / SIZE;
  const cellH = rect.h / SIZE;

  for (let cy = 0; cy < SIZE; cy++) {
    const y0 = Math.floor(rect.y + cy * cellH);
    const y1 = Math.max(y0 + 1, Math.floor(rect.y + (cy + 1) * cellH));
    for (let cx = 0; cx < SIZE; cx++) {
      const x0 = Math.floor(rect.x + cx * cellW);
      const x1 = Math.max(x0 + 1, Math.floor(rect.x + (cx + 1) * cellW));

      let sum = 0;
      let n = 0;
      for (let y = y0; y < y1 && y < height; y++) {
        if (y < 0) continue;
        const row = y * width;
        for (let x = x0; x < x1 && x < width; x++) {
          if (x < 0) continue;
          const i = (row + x) * 4;
          // Rec. 601 luma. The alpha channel is ignored: every source here is
          // opaque, and honouring it would make a transparent PNG hash
          // differently from the same art composited onto white.
          sum += 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
          n++;
        }
      }
      out[cy * SIZE + cx] = n > 0 ? sum / n : 0;
    }
  }
  return out;
}

/**
 * How much picture is in a region: the standard deviation of its greyscale, in
 * luma units.
 *
 * Answers a question the hash cannot — "is there anything here at all". A
 * perceptual hash is deliberately scale-free: it compares a region against its
 * own median, so an empty desk and a card produce hashes of exactly the same
 * shape and the same apparent confidence. That is correct for matching and
 * useless for deciding whether to fire a shutter, which is why auto-capture
 * previously photographed the mat between every pair of cards.
 *
 * Computed from the same 32×32 downscale the hash uses, so it is free on a path
 * that already pays for one.
 */
export function detail(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  rect?: Rect,
): number {
  const grey = downscaleGrey(rgba, width, height, rect);
  let sum = 0;
  for (const v of grey) sum += v;
  const mean = sum / grey.length;
  let variance = 0;
  for (const v of grey) variance += (v - mean) * (v - mean);
  return Math.sqrt(variance / grey.length);
}

/**
 * Top-left BLOCK×BLOCK coefficients of the 2D DCT-II.
 *
 * Separable and truncated: only 8 of 32 output frequencies are ever read, so
 * this is ~10k multiply-adds rather than the ~1M a naive full 2D DCT costs.
 */
function dctBlock(grey: Float64Array): Float64Array {
  // Rows first: rows[r * BLOCK + u]
  const rows = new Float64Array(SIZE * BLOCK);
  for (let r = 0; r < SIZE; r++) {
    const base = r * SIZE;
    for (let u = 0; u < BLOCK; u++) {
      let sum = 0;
      for (let x = 0; x < SIZE; x++) sum += grey[base + x] * COS[u * SIZE + x];
      rows[r * BLOCK + u] = sum * ALPHA[u];
    }
  }
  // Then columns.
  const out = new Float64Array(BLOCK * BLOCK);
  for (let v = 0; v < BLOCK; v++) {
    for (let u = 0; u < BLOCK; u++) {
      let sum = 0;
      for (let r = 0; r < SIZE; r++) sum += rows[r * BLOCK + u] * COS[v * SIZE + r];
      out[v * BLOCK + u] = sum * ALPHA[v];
    }
  }
  return out;
}

/**
 * A 64-bit perceptual hash of a region, as two uint32s.
 *
 * DCT-based rather than the simpler average hash: aHash compares pixels to the
 * mean brightness, which a phone light or a holo sheen moves wholesale. The DCT
 * throws away absolute brightness and keeps structure, which is exactly the
 * part of a card that does not change between the scan and the catalog image.
 */
export function perceptualHash(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  rect?: Rect,
): Uint32Array {
  const coeffs = dctBlock(downscaleGrey(rgba, width, height, rect));

  // The DC term carries overall brightness — the one thing we deliberately do
  // not want to be sensitive to — so it is excluded from the median and from
  // the hash, and bit 0 is spent on a duplicate of coefficient 1 to keep the
  // hash a round 64 bits.
  const sorted = Float64Array.from(coeffs.subarray(1)).sort();
  const mid = sorted.length >> 1;
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;

  const hash = new Uint32Array(2);
  for (let bit = 0; bit < HASH_BITS; bit++) {
    const coeff = coeffs[bit === 0 ? 1 : bit];
    if (coeff > median) hash[bit >> 5] |= 1 << (bit % 32);
  }
  return hash;
}

/** Bits set in a 32-bit word (SWAR popcount). */
function popcount(n: number): number {
  n = n - ((n >>> 1) & 0x55555555);
  n = (n & 0x33333333) + ((n >>> 2) & 0x33333333);
  n = (n + (n >>> 4)) & 0x0f0f0f0f;
  return (n * 0x01010101) >>> 24;
}

/** Differing bits between two hashes held at word offsets in flat arrays. */
export function hamming(a: Uint32Array, ai: number, b: Uint32Array, bi: number): number {
  return popcount(a[ai] ^ b[bi]) + popcount(a[ai + 1] ^ b[bi + 1]);
}

export interface Match {
  /** Position in the index — resolve against the parallel metadata array. */
  ordinal: number;
  distance: number;
}

/**
 * The k nearest entries in an index of hashes (flat, 2 words per entry).
 *
 * Linear. At 20,460 entries that is 40,920 XORs and popcounts — well under a
 * millisecond — and a linear scan has no build step, no tree to keep balanced,
 * and no failure mode where a near neighbour is missed because it fell on the
 * wrong side of a partition.
 */
export function search(index: Uint32Array, hash: Uint32Array, k = 5): Match[] {
  const best: Match[] = [];
  let worst = HASH_BITS + 1;

  for (let i = 0, ord = 0; i < index.length; i += 2, ord++) {
    const d = hamming(hash, 0, index, i);
    if (best.length === k && d >= worst) continue;

    // Insertion sort into a k-element list: k is tiny, so this beats sorting
    // 20,460 candidates at the end by a wide margin.
    let at = best.length;
    while (at > 0 && best[at - 1].distance > d) at--;
    best.splice(at, 0, { ordinal: ord, distance: d });
    if (best.length > k) best.pop();
    worst = best[best.length - 1].distance;
  }
  return best;
}

export interface Verdict {
  match: Match | null;
  runnerUp: Match | null;
  /**
   * True when the best match is both close AND clearly better than the next.
   *
   * The margin matters more than the absolute distance. Two entries that match
   * almost equally well is the reprint case — same art, different set — and
   * that is precisely when the collector number has to settle it rather than
   * the artwork. Auto-accepting there is how a collection silently fills with
   * the wrong printings.
   */
  confident: boolean;
}

/**
 * Measured, not guessed — and re-measured, because the first measurement expired.
 *
 * The original sweep is `node scripts/validate-recognition.mjs me5 me3 me2`:
 * real cards put through six realistic scan distortions (camera resample, 3%
 * crop error, dim room, holo glare, 3° tilt, and all of them at once). It builds
 * its own index out of the sets it is given, so this table was taken against a
 * few hundred cards:
 *
 *   maxDistance  minMargin   autoAccepted   falseAccept
 *           10           6          76.0%            0%
 *           14           6          90.1%          0.1%
 *           16           4          94.6%          0.1%
 *           16           6          91.4%          0.1%
 *           16           8          84.9%            0%   ← chosen in 2026-08
 *           24           8          84.9%            0%
 *
 * Two things fell out of that table and both still hold:
 *
 * **The margin is the safety control, not the distance.** Every margin of 4 or
 * 6 leaks false accepts at every distance from 14 to 24. Tightening the distance
 * instead — the intuitive move — costs auto-accept and fixes nothing.
 *
 * **16 is the knee.** 18, 20 and 24 are identical to it, so a looser bound is
 * risk with no return.
 *
 * **What did NOT survive is the 0%.** A gate is only as safe as the crowd it
 * judges against, and the index has grown from 1,709 cards to 20,205 since that
 * sweep. Re-run over the SHIPPED index — `node scripts/measure-gate-safety.mjs
 * fetch`, then `report` — every one of the 20,205 cards, all six distortions,
 * 121,230 trials, each query searched against `index-*.bin` itself:
 *
 *   maxDistance  minMargin   autoAccepted   falseAccept   MATCHED     lost
 *           16           6          57.9%   45 (0.037%)     92.8%     −277
 *           16           7          47.7%    3 (0.002%)     91.6%      −32
 *           16           8          45.9%    2 (0.002%)     91.4%        0   ← was shipped
 *           16           9          37.7%    1 (0.001%)     90.1%      274
 *           16          10          36.7%    0 (0.000%)     89.9%      312   ← chosen
 *           16          11          30.2%    0 (0.000%)     84.5%    1,408
 *           16          12          29.5%    0 (0.000%)     83.6%    1,590
 *
 * The two right-hand columns are a DIFFERENT question, measured the way
 * `measure-index-crowding.mjs` measures it: every card fed its own hash, asking
 * how far the nearest OTHER card is. That is a perfect capture, so it sits at
 * distance 0 and MAX_DISTANCE cannot move it — the whole crowding cost of the
 * gate is MIN_MARGIN's, and `lost` is how many of the 18,475 cards that
 * auto-accepted at margin 8 no longer do. `autoAccepted` is not comparable with
 * the first table's: same six distortions, an index thirty times larger.
 *
 * **The two false accepts at 16/8 are real and named.** Both under the crop-error
 * render, both a reprint filed into the wrong set:
 *
 *   ex3-86  "Low Pressure System" (Dragon 86)  → pop3-11 (POP Series 3 11)
 *           distance 4, runner-up 13, margin 9; the truth sat at 14
 *   bw2-32  "Emolga" (Emerging Powers 32)      → mcd12-6 (McDonald's 2012 6)
 *           distance 4, runner-up 12, margin 8; the truth sat at 12
 *
 * Note where they sit: **distance 4**, the tightest, most confident end of the
 * accept region. A 3% crop error moved each query nearer to a different printing
 * than to its own catalog image, and then left it looking lonely. No value of
 * MAX_DISTANCE can catch that — the sweep confirms 10 leaks exactly as 16 does —
 * which is the earlier finding sharpened: the margin is not merely the better
 * control, it is the ONLY one.
 *
 * **10, specifically, because it is the knee.** 9 still admits ex3-86; 11 costs
 * 1,408 cards instead of 312. The reason is the shape of the index: 312 cards
 * sit 8–9 bits from their nearest rival and 1,278 sit 10–11, so 10 is the last
 * step before the cliff. Where a capture is good the cost is small — the
 * near-lossless renders drop 2.0 and 1.6 points — and the renders that pay most
 * (crop error −17.3, tilt −19.3) are the ones already being asked about 60–70%
 * of the time, and crop error is where both false accepts came from. The
 * auto-accept given up there is precisely the auto-accept that was unsafe.
 *
 * **Do not read the zero as proof.** Both the distortions and the index entries
 * are derived from the SAME catalog PNG, so every query is a deterministic
 * transform of the truth; a real camera adds noise, a colour cast, focus, wear
 * and a warp that is not a 3° rotation, all of which push a query away from its
 * own entry — the direction that creates false accepts. 2 in 121,230 is a FLOOR
 * on the real rate, and 0 at margin 10 means "this battery cannot break it", not
 * "it cannot break". Nor does a margin remove the population: 1,278 cards still
 * auto-accept with a rival 10–11 bits away, and they are what leaks next when
 * the index grows again. **Re-run the sweep after every index rebuild.** This is
 * the second time the pair has had to move; the durable fix is the collector
 * number, not a bigger number here.
 *
 * The cards that stay ambiguous — 2,042 of 20,205 at margin 10, up from 1,730 at
 * margin 8 — are not random. They are overwhelmingly Base Set against Base Set 2
 * against Legendary Collection, the same artwork reprinted, and 652 of them
 * share an EXACT hash with another card. No hash can separate those; only the
 * collector number can, which is what OCR is for.
 *
 * **`cardrec/judge.py` on SERVER-PC mirrors these two constants and must move
 * with them.** Scanning is server-first and `toScanResult` trusts the service's
 * own verdict (`confident: reply.status === "MATCHED"`), so a change here alone
 * only tightens the offline fallback and silently breaks the parity the two
 * recognisers are tested for.
 */
export const MAX_DISTANCE = 16;
/** The margin a near-exact hit must clear. See NEAR_EXACT. */
export const MIN_MARGIN = 8;
/**
 * The margin everything else must clear.
 *
 * A blanket 10 was measured first and rejected: it buys the same safety and
 * refuses 312 cards that a PERFECT capture would have matched, because on a
 * flawless capture the true hit sits at distance 0 and its margin is whatever
 * the catalog happens to give it.
 */
export const MIN_MARGIN_DRIFTED = 10;
/**
 * Where "this query barely moved" ends.
 *
 * Measured: across 121,230 trials, wrong top-1 hits achieve a margin of at most
 * 2 at distance 0 and 6 at distance 2, but reach 9 at distance 4. A query that
 * landed within 2 bits of a catalog image has not drifted far enough to have
 * crossed to a twin; one that landed further has, and both real false accepts
 * are at distance 4. Extending this to `d <= 4` re-admits both of them, which
 * is what says the boundary is real rather than tuned past.
 */
export const NEAR_EXACT = 2;

/**
 * Whether a match may be accepted without asking.
 *
 * The margin is the safety control, and it is asymmetric: a hit that is nearly
 * bit-identical to its catalog entry is trusted at 8, and anything that has
 * drifted must clear 10. Measured against the same 121,230 trials, this is a
 * strict improvement on a blanket 10 in every direction —
 *
 *   rule                          auto-accept  false accepts  MATCHED  cards lost
 *   margin >= 8   (was shipped)         45.9%              2    91.4%           0
 *   margin >= 10                        36.7%              0    89.9%         312
 *   margin >= 8 if d<=2 else 10         37.4%              0    91.4%           0
 *
 * — and it is identical to a blanket 10 on a HELD-OUT battery of five geometric
 * distortions the rule was not fitted to (2 leaks, the same two cards).
 *
 * **Neither is immunity.** On that held-out battery a blanket 8 leaks 13 times
 * and this leaks twice; only a margin of 11 reached zero, and 11 costs 1,408
 * cards. The measurements are synthetic transforms of the same catalog images
 * that built the index, so every count here is a FLOOR — a real camera adds
 * noise, wear and colour cast, all of which push a query away from its own
 * entry, which is the direction that creates false accepts. The durable fix is
 * the collector number, not a larger number here.
 */
export function judge(matches: Match[]): Verdict {
  const match = matches[0] ?? null;
  const runnerUp = matches[1] ?? null;
  if (!match) return { match: null, runnerUp: null, confident: false };
  const margin = runnerUp ? runnerUp.distance - match.distance : HASH_BITS;
  const required = match.distance <= NEAR_EXACT ? MIN_MARGIN : MIN_MARGIN_DRIFTED;
  return {
    match,
    runnerUp,
    confident: match.distance <= MAX_DISTANCE && margin >= required,
  };
}
